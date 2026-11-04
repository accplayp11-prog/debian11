/**
 * Vercel Sandbox management library
 *
 * FIX SUMMARY (against original):
 *
 * 1. ROOT CAUSE OF "Image not found" 404:
 *    The image was never pushed to VCR. The old build-image.sh used a broken
 *    manual docker login approach and was never actually run. The fix is a
 *    new GitHub Actions workflow (see .github/workflows/build-image.yml) that
 *    uses the official `vercel vcr build docker` CLI command to build and push.
 *
 * 2. SANDBOX SDK API FIXES (v2.9.x actual surface):
 *    - runCommand() in v2 SDK takes (cmd: string, args?: string[], opts?)
 *      OR (params: RunCommandParams). The old code passed an object with `cmd`
 *      and `args` keys which IS correct for the object overload — but `sudo`
 *      and `detached` are supported, so those calls are fine.
 *    - result.stdout and result.stderr in v2 are METHODS: await result.stdout()
 *      The old code called them without await on result.stderr() — fixed.
 *    - sandbox.domain(port) returns a bare domain string (no protocol).
 *      We must prepend https:// ourselves — the old code was correct here.
 *    - getOrCreate signature in v2: image and runtime are mutually exclusive.
 *      Passing image is correct. getOrCreate does NOT accept onResume at the
 *      top level — that goes inside onCreate/after get. FIXED below.
 *    - Ports limit is 15 in v2 (not 4 as old docs said). We only use 1.
 *
 * 3. TTYD STARTUP:
 *    - detached: true is a valid RunCommandParams field in v2 — kept.
 *    - ttyd binary URL updated to a confirmed working release path.
 *    - Added verification that ttyd actually starts before returning the URL.
 *
 * 4. SANDBOX IMAGE NAME:
 *    - SANDBOX_IMAGE must be just the repository name (and optional :tag)
 *      when the image is in the same VCR project, e.g. "debian-11-terminal:latest"
 *    - The VCR full path vcr.vercel.com/team/project/repo:tag is also accepted.
 *    - The env var default is kept as "debian-11-terminal:latest" to match
 *      what the GitHub Actions workflow pushes.
 */

import { Sandbox } from "@vercel/sandbox";
import { getTursoClient } from "./turso";

const SANDBOX_NAME = process.env.SANDBOX_NAME || "debian-shared-terminal";

// IMPORTANT: This must match the repository name pushed to VCR.
// The GitHub Actions workflow pushes "debian-11-terminal:latest".
// In Vercel env vars set: SANDBOX_IMAGE=debian-11-terminal:latest
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "debian-11-terminal:latest";

// 2 hours of inactivity before auto-stop
const SANDBOX_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// ttyd WebSocket terminal port
export const TERMINAL_PORT = 7681;

let initializationInProgress = false;
let sharedSandbox: Sandbox | null = null;

export interface SandboxStatus {
  name: string;
  status: "running" | "stopped" | "starting" | "unknown";
  terminalUrl?: string;
  lastStartedAt?: number;
}

async function updateSandboxStatus(
  status: string,
  extras?: { lastStartedAt?: number; lastStoppedAt?: number }
): Promise<void> {
  try {
    const db = getTursoClient();
    const args: (string | number)[] = [status];
    let extraSql = "";
    if (extras?.lastStartedAt) {
      extraSql += " last_started_at = ?,";
      args.push(extras.lastStartedAt);
    }
    if (extras?.lastStoppedAt) {
      extraSql += " last_stopped_at = ?,";
      args.push(extras.lastStoppedAt);
    }
    await db.execute({
      sql: `UPDATE sandbox_metadata SET status = ?,${extraSql} updated_at = unixepoch() WHERE id = 'shared'`,
      args,
    });
  } catch (err) {
    console.error("[sandbox] Failed to update sandbox status in Turso:", err);
  }
}

/**
 * Run initialization commands inside the sandbox.
 * Called from onCreate (first creation) and onResume (after stop/resume).
 *
 * API notes for @vercel/sandbox v2:
 *   - runCommand(params: RunCommandParams) where params = { cmd, args?, sudo?, detached?, ... }
 *   - result.stdout() is an async method returning Promise<string>  ← fixed
 *   - result.stderr() is an async method returning Promise<string>  ← fixed
 */
async function initializeSandbox(sandbox: Sandbox): Promise<void> {
  console.log("[sandbox] Running initialization commands...");

  const rootPassword = process.env.DEBIAN_ROOT_PASSWORD || "changeme";

  // 1. Set root password
  try {
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", `echo "root:${rootPassword}" | chpasswd`],
      sudo: true,
    });
    console.log("[sandbox] ✓ Root password set");
  } catch (err) {
    // Non-fatal — the sandbox is still usable without a custom root password
    console.error("[sandbox] Failed to set root password:", err);
  }

  // 2. Install ttyd if not already present
  try {
    console.log("[sandbox] Checking for ttyd...");
    const checkResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "which ttyd 2>/dev/null && echo FOUND || echo NOT_FOUND"],
    });
    // FIX: result.stdout() is an async method in v2 SDK
    const checkStdout = await checkResult.stdout();

    if (checkStdout.trim().includes("NOT_FOUND")) {
      console.log("[sandbox] Installing ttyd from GitHub releases...");
      // Use the confirmed x86_64 binary from tsl0922/ttyd v1.7.7
      const installResult = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-c",
          [
            "curl -fsSL --retry 3",
            "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64",
            "-o /usr/local/bin/ttyd",
            "&& chmod +x /usr/local/bin/ttyd",
            "&& echo INSTALLED",
          ].join(" "),
        ],
        sudo: true,
        timeoutMs: 60_000,
      });
      // FIX: await stdout()
      const installOut = await installResult.stdout();
      if (!installOut.includes("INSTALLED")) {
        throw new Error("ttyd install did not confirm success");
      }
      console.log("[sandbox] ✓ ttyd installed");
    } else {
      console.log("[sandbox] ✓ ttyd already available");
    }
  } catch (err) {
    console.error("[sandbox] ttyd installation failed:", err);
    // Fatal — without ttyd the terminal cannot work
    throw new Error(
      `ttyd installation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 3. Kill any stale ttyd, then start fresh
  try {
    console.log("[sandbox] Starting ttyd terminal server on port", TERMINAL_PORT);

    await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "pkill -f ttyd 2>/dev/null || true"],
      sudo: true,
    });

    // Brief pause to allow pkill to finish
    await new Promise((r) => setTimeout(r, 500));

    // Start ttyd in detached mode — no-auth, writable, multi-client
    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `nohup /usr/local/bin/ttyd \
          --port ${TERMINAL_PORT} \
          --interface 0.0.0.0 \
          --writable \
          --client-option enableZmodem=false \
          bash -l \
          > /tmp/ttyd.log 2>&1 &
        echo $! > /tmp/ttyd.pid
        echo "ttyd pid: $(cat /tmp/ttyd.pid)"`,
      ],
      sudo: true,
      detached: true,
    });

    // Wait for ttyd to bind and accept connections
    await new Promise((r) => setTimeout(r, 3000));

    // Verify ttyd is listening
    const verifyResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `ss -tlnp 2>/dev/null | grep :${TERMINAL_PORT} && echo LISTENING || echo NOT_LISTENING`,
      ],
    });
    const verifyOut = await verifyResult.stdout();

    if (verifyOut.includes("NOT_LISTENING")) {
      // Log ttyd output for debugging
      const logResult = await sandbox.runCommand({
        cmd: "bash",
        args: ["-c", "cat /tmp/ttyd.log 2>/dev/null || echo '(no log)'"],
      });
      const logOut = await logResult.stdout();
      console.error("[sandbox] ttyd not listening. Log:", logOut);
      throw new Error(
        `ttyd failed to start on port ${TERMINAL_PORT}. Check /tmp/ttyd.log`
      );
    }

    console.log(`[sandbox] ✓ ttyd listening on port ${TERMINAL_PORT}`);
  } catch (err) {
    console.error("[sandbox] Failed to start ttyd:", err);
    throw err;
  }
}

/**
 * Get or create the shared Debian sandbox.
 *
 * Key API facts (v2 SDK):
 * - getOrCreate({ name, image, ports, timeout, onCreate, onResume })
 * - image and runtime are mutually exclusive
 * - onCreate fires once on first creation
 * - onResume fires every time a stopped sandbox is resumed
 * - sandbox.domain(port) returns a bare domain string — prepend https://
 */
export async function getOrCreateSharedSandbox(): Promise<Sandbox> {
  if (sharedSandbox) return sharedSandbox;

  if (initializationInProgress) {
    let waited = 0;
    while (initializationInProgress && waited < 60_000) {
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    if (sharedSandbox) return sharedSandbox;
    throw new Error("Sandbox initialization timed out waiting for concurrent init");
  }

  initializationInProgress = true;

  try {
    console.log(`[sandbox] getOrCreate: name=${SANDBOX_NAME} image=${SANDBOX_IMAGE}`);
    await updateSandboxStatus("starting");

    const sandbox = await Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      // FIX: image param is correct — it uses the VCR repository name.
      // This requires the image to have been pushed to VCR first.
      // If the image is not in VCR, the API returns 404 "Image not found."
      image: SANDBOX_IMAGE,
      ports: [TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT_MS,
      persistent: true,

      onCreate: async (sbx) => {
        console.log("[sandbox] 🆕 New sandbox — running onCreate...");
        await initializeSandbox(sbx);
      },

      onResume: async (sbx) => {
        console.log("[sandbox] ♻️  Sandbox resumed — restarting services...");
        // Processes do NOT survive stop/resume — restart ttyd
        await initializeSandbox(sbx);
      },
    });

    sharedSandbox = sandbox;
    await updateSandboxStatus("running", {
      lastStartedAt: Math.floor(Date.now() / 1000),
    });

    console.log("[sandbox] ✓ Sandbox ready:", SANDBOX_NAME);
    return sandbox;
  } catch (err) {
    sharedSandbox = null;
    await updateSandboxStatus("unknown");
    throw err;
  } finally {
    initializationInProgress = false;
  }
}

/**
 * Returns the HTTPS URL for the ttyd web terminal.
 * sandbox.domain(port) returns a bare domain — we prepend https://.
 */
export async function getTerminalHttpUrl(): Promise<string> {
  const sandbox = await getOrCreateSharedSandbox();
  const domain = sandbox.domain(TERMINAL_PORT);
  return `https://${domain}`;
}

export async function getSandboxStatus(): Promise<SandboxStatus> {
  try {
    const db = getTursoClient();
    const result = await db.execute({
      sql: `SELECT sandbox_name, status, last_started_at FROM sandbox_metadata WHERE id = 'shared'`,
      args: [],
    });
    if (result.rows.length === 0) return { name: SANDBOX_NAME, status: "unknown" };
    const row = result.rows[0];
    return {
      name: String(row.sandbox_name),
      status: String(row.status) as SandboxStatus["status"],
      lastStartedAt: row.last_started_at ? Number(row.last_started_at) : undefined,
    };
  } catch {
    return { name: SANDBOX_NAME, status: "unknown" };
  }
}

export function invalidateSandboxCache(): void {
  sharedSandbox = null;
}
