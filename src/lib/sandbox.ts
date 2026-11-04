/**
 * Vercel Sandbox management library
 *
 * Architecture:
 * - ONE shared named Debian 11 Sandbox for all authenticated users.
 * - Sandbox is persistent: filesystem survives stop/resume via snapshots.
 * - Each user gets their own independent shell process (PTY) via WebSocket.
 * - The shared filesystem means all users see the same files.
 *
 * Important Vercel Sandbox constraints (documented here, not invented):
 * - ENTRYPOINT and CMD are NOT executed in custom images.
 * - Processes must be started via runCommand() after sandbox creation.
 * - Sandboxes stop after their timeout expires.
 * - Running processes do NOT survive a stop/resume — services must be restarted.
 * - Filesystem IS persisted via automatic snapshots on stop.
 */

import { Sandbox } from "@vercel/sandbox";
import { getTursoClient } from "./turso";

const SANDBOX_NAME =
  process.env.SANDBOX_NAME || "debian-shared-terminal";
const SANDBOX_IMAGE =
  process.env.SANDBOX_IMAGE || "debian-11-terminal:latest";

// Sandbox timeout: 2 hours of inactivity before auto-stop
const SANDBOX_TIMEOUT_MS = 2 * 60 * 60 * 1000;

// Port for the terminal WebSocket server inside the sandbox
export const TERMINAL_PORT = 7681;

// In-memory lock to prevent concurrent sandbox initialization in the same process.
// For distributed environments, Turso acts as the coordination layer.
let initializationInProgress = false;
let sharedSandbox: Sandbox | null = null;

export interface SandboxStatus {
  name: string;
  status: "running" | "stopped" | "starting" | "unknown";
  terminalUrl?: string;
  lastStartedAt?: number;
}

/**
 * Update sandbox status in Turso.
 */
async function updateSandboxStatus(
  status: string,
  extras?: { lastStartedAt?: number; lastStoppedAt?: number }
): Promise<void> {
  try {
    const db = getTursoClient();
    await db.execute({
      sql: `UPDATE sandbox_metadata
            SET status = ?,
                ${extras?.lastStartedAt ? "last_started_at = ?," : ""}
                ${extras?.lastStoppedAt ? "last_stopped_at = ?," : ""}
                updated_at = unixepoch()
            WHERE id = 'shared'`,
      args: [
        status,
        ...(extras?.lastStartedAt ? [extras.lastStartedAt] : []),
        ...(extras?.lastStoppedAt ? [extras.lastStoppedAt] : []),
      ],
    });
  } catch (err) {
    console.error("[sandbox] Failed to update sandbox status in Turso:", err);
  }
}

/**
 * Run initialization commands inside the sandbox after creation or resume.
 * This sets up:
 * - Root password (from DEBIAN_ROOT_PASSWORD env var)
 * - ttyd terminal server (if installed in the image) or node-pty via ws
 *
 * Note: We use ttyd as the terminal server because it:
 * 1. Provides real PTY sessions over WebSocket out of the box
 * 2. Supports multiple independent sessions per connection
 * 3. Is easy to install in Debian
 */
async function initializeSandbox(sandbox: Sandbox): Promise<void> {
  console.log("[sandbox] Running initialization commands...");

  const rootPassword = process.env.DEBIAN_ROOT_PASSWORD || "changeme";

  // Set root password
  try {
    const result = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", `echo "root:${rootPassword}" | chpasswd`],
      sudo: true,
    });
    const stderr = result.stderr ? await result.stderr() : "";
    if (stderr) console.log("[sandbox] chpasswd stderr:", stderr);
    console.log("[sandbox] ✓ Root password set");
  } catch (err) {
    console.error("[sandbox] Failed to set root password:", err);
  }

  // Install ttyd if not present (ttyd provides WebSocket terminal)
  try {
    console.log("[sandbox] Checking for ttyd...");
    const checkResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "which ttyd || echo NOT_FOUND"],
    });
    const checkStdout = checkResult.stdout ? await checkResult.stdout() : "";

    if (checkStdout.includes("NOT_FOUND")) {
      console.log("[sandbox] Installing ttyd...");
      // Install ttyd from GitHub releases (pre-built binary for Debian)
      await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-c",
          [
            "curl -sSL https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64",
            "-o /usr/local/bin/ttyd",
            "&& chmod +x /usr/local/bin/ttyd",
            "&& echo 'ttyd installed'",
          ].join(" "),
        ],
        sudo: true,
      });
      console.log("[sandbox] ✓ ttyd installed");
    } else {
      console.log("[sandbox] ✓ ttyd already available");
    }
  } catch (err) {
    console.error("[sandbox] ttyd installation failed:", err);
  }

  // Start ttyd in background (listening on 0.0.0.0 so it's accessible via port exposure)
  try {
    console.log("[sandbox] Starting ttyd terminal server...");
    // Kill any existing ttyd
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "pkill -f ttyd || true"],
      sudo: true,
    });

    // Start ttyd: wraps bash, allows multiple clients, listens on TERMINAL_PORT
    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `nohup ttyd \
          --port ${TERMINAL_PORT} \
          --interface 0.0.0.0 \
          --writable \
          --client-option enableZmodem=false \
          bash -l \
          > /tmp/ttyd.log 2>&1 &
        echo "ttyd pid: $!"`,
      ],
      sudo: true,
      detached: true,
    });

    // Wait for ttyd to start
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log(`[sandbox] ✓ ttyd started on port ${TERMINAL_PORT}`);
  } catch (err) {
    console.error("[sandbox] Failed to start ttyd:", err);
  }
}

/**
 * Get or create the shared Debian sandbox.
 * Uses getOrCreate for idempotency — safe to call concurrently.
 *
 * The in-process lock prevents duplicate initialization within a single
 * serverless function invocation.
 */
export async function getOrCreateSharedSandbox(): Promise<Sandbox> {
  // Return cached instance if healthy
  if (sharedSandbox) {
    return sharedSandbox;
  }

  // Prevent duplicate initialization within the same process
  if (initializationInProgress) {
    // Wait for in-progress initialization
    let waited = 0;
    while (initializationInProgress && waited < 30000) {
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    if (sharedSandbox) return sharedSandbox;
  }

  initializationInProgress = true;

  try {
    console.log(
      `[sandbox] Getting or creating sandbox: ${SANDBOX_NAME}`
    );
    await updateSandboxStatus("starting");

    const sandbox = await Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      image: SANDBOX_IMAGE,
      ports: [TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT_MS,

      // onCreate: runs ONCE when the sandbox is first created (not on resume)
      onCreate: async (sbx) => {
        console.log("[sandbox] 🆕 New sandbox created — running onCreate...");
        await initializeSandbox(sbx);
      },

      // onResume: runs every time the sandbox is resumed from a stopped state
      onResume: async (sbx) => {
        console.log("[sandbox] ♻️  Sandbox resumed — running onResume...");
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
    await updateSandboxStatus("unknown");
    throw err;
  } finally {
    initializationInProgress = false;
  }
}

/**
 * Get the public WebSocket URL for the terminal.
 * ttyd exposes a WebSocket at ws://<domain>/ws
 */
export async function getTerminalUrl(): Promise<string> {
  const sandbox = await getOrCreateSharedSandbox();
  const domain = sandbox.domain(TERMINAL_PORT);
  // ttyd WebSocket endpoint
  return `wss://${domain}/ws`;
}

/**
 * Get the public HTTP URL for the sandbox terminal.
 */
export async function getTerminalHttpUrl(): Promise<string> {
  const sandbox = await getOrCreateSharedSandbox();
  const domain = sandbox.domain(TERMINAL_PORT);
  return `https://${domain}`;
}

/**
 * Get current sandbox status from Turso.
 */
export async function getSandboxStatus(): Promise<SandboxStatus> {
  try {
    const db = getTursoClient();
    const result = await db.execute({
      sql: `SELECT sandbox_name, status, last_started_at FROM sandbox_metadata WHERE id = 'shared'`,
      args: [],
    });

    if (result.rows.length === 0) {
      return { name: SANDBOX_NAME, status: "unknown" };
    }

    const row = result.rows[0];
    return {
      name: String(row.sandbox_name),
      status: String(row.status) as SandboxStatus["status"],
      lastStartedAt: row.last_started_at
        ? Number(row.last_started_at)
        : undefined,
    };
  } catch {
    return { name: SANDBOX_NAME, status: "unknown" };
  }
}

/**
 * Invalidate the in-process sandbox cache.
 * Call this if you suspect the sandbox is no longer running.
 */
export function invalidateSandboxCache(): void {
  sharedSandbox = null;
}
