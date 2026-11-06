
import { Sandbox } from "@vercel/sandbox";
import { getTursoClient } from "./turso";

const SANDBOX_NAME =
  process.env.SANDBOX_NAME || "debian-shared-terminal";

const SANDBOX_IMAGE =
  process.env.SANDBOX_IMAGE ||
  "debian-11-terminal:latest";

// Vercel Hobby maximum sandbox timeout: 45 minutes.
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000;

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
  extras?: {
    lastStartedAt?: number;
    lastStoppedAt?: number;
  }
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
      sql: `UPDATE sandbox_metadata
            SET status = ?,${extraSql}
            updated_at = unixepoch()
            WHERE id = 'shared'`,
      args,
    });
  } catch (err) {
    console.error(
      "[sandbox] Failed to update Turso status:",
      err
    );
  }
}

/**
 * Start ttyd inside the Debian sandbox.
 * Called on first creation and every session resume.
 */
async function initializeSandbox(
  sandbox: Sandbox
): Promise<void> {
  console.log("[sandbox] Initializing Debian terminal...");

  const rootPassword =
    process.env.DEBIAN_ROOT_PASSWORD || "changeme";

  // Set root password.
  try {
    const passwordResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `echo "root:${rootPassword}" | chpasswd`,
      ],
      sudo: true,
    });

    if (passwordResult.exitCode !== 0) {
      console.error("[sandbox] Root password setup failed");
    } else {
      console.log("[sandbox] Root password configured");
    }
  } catch (err) {
    console.error(
      "[sandbox] Root password setup error:",
      err
    );
  }

  // Check ttyd installation.
  const checkResult = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      "command -v ttyd >/dev/null 2>&1 && echo FOUND || echo NOT_FOUND",
    ],
  });

  const checkOutput = await checkResult.stdout();

  // Install ttyd if missing.
  if (checkOutput.includes("NOT_FOUND")) {
    console.log("[sandbox] Installing ttyd...");

    const installResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        [
          "curl -fsSL --retry 5",
          "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64",
          "-o /usr/local/bin/ttyd",
          "&& chmod 0755 /usr/local/bin/ttyd",
        ].join(" "),
      ],
      sudo: true,
      timeoutMs: 60000,
    });

    if (installResult.exitCode !== 0) {
      const error = await installResult.stderr();
      throw new Error(`ttyd installation failed: ${error}`);
    }

    console.log("[sandbox] ttyd installed");
  } else {
    console.log("[sandbox] ttyd already installed");
  }

  // Stop any previous ttyd process.
  await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      "pkill -x ttyd 2>/dev/null || true",
    ],
    sudo: true,
  });

  await new Promise((resolve) =>
    setTimeout(resolve, 500)
  );

  // Start ttyd.
  console.log(
    `[sandbox] Starting ttyd on port ${TERMINAL_PORT}...`
  );

  const startResult = await sandbox.runCommand({
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
      echo "ttyd started"`,
    ],
    sudo: true,
    detached: true,
  });

  if (startResult.exitCode !== 0) {
    const error = await startResult.stderr();
    throw new Error(`Failed to launch ttyd: ${error}`);
  }

  // Wait for ttyd to become ready.
  let listening = false;

  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) =>
      setTimeout(resolve, 1000)
    );

    const verifyResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `ss -tln 2>/dev/null | grep -q ':${TERMINAL_PORT} ' && echo READY || echo WAITING`,
      ],
    });

    const verifyOutput = await verifyResult.stdout();

    if (verifyOutput.includes("READY")) {
      listening = true;
      break;
    }
  }

  if (!listening) {
    const logResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        "cat /tmp/ttyd.log 2>/dev/null || echo 'No ttyd log found'",
      ],
    });

    const logOutput = await logResult.stdout();

    console.error(
      "[sandbox] ttyd failed to listen:",
      logOutput
    );

    throw new Error(
      `ttyd is not listening on port ${TERMINAL_PORT}`
    );
  }

  console.log(
    `[sandbox] ttyd is listening on port ${TERMINAL_PORT}`
  );
}

/**
 * Get or create the shared persistent Debian sandbox.
 */
export async function getOrCreateSharedSandbox(): Promise<Sandbox> {
  if (sharedSandbox) {
    return sharedSandbox;
  }

  if (initializationInProgress) {
    let waited = 0;

    while (
      initializationInProgress &&
      waited < 60000
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );

      waited += 500;
    }

    if (sharedSandbox) {
      return sharedSandbox;
    }

    throw new Error(
      "Sandbox initialization timed out"
    );
  }

  initializationInProgress = true;

  try {
    console.log(
      `[sandbox] Getting sandbox: ${SANDBOX_NAME}`
    );

    console.log(
      `[sandbox] Image: ${SANDBOX_IMAGE}`
    );

    await updateSandboxStatus("starting");

    const sandbox = await Sandbox.getOrCreate({
      name: SANDBOX_NAME,
      image: SANDBOX_IMAGE,
      ports: [TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT_MS,
      persistent: true,

      // Resume an existing stopped sandbox immediately.
      resume: true,

      // Runs on first creation.
      onCreate: async (sbx) => {
        console.log("[sandbox] New sandbox created");
        await initializeSandbox(sbx);
      },

      // Runs whenever an existing sandbox resumes.
      onResume: async (sbx) => {
        console.log("[sandbox] Sandbox resumed");
        await initializeSandbox(sbx);
      },
    });

    sharedSandbox = sandbox;

    await updateSandboxStatus("running", {
      lastStartedAt: Math.floor(
        Date.now() / 1000
      ),
    });

    console.log("[sandbox] Sandbox ready");

    return sandbox;
  } catch (err) {
    sharedSandbox = null;

    await updateSandboxStatus("unknown");

    console.error(
      "[sandbox] Sandbox initialization failed:",
      err
    );

    throw err;
  } finally {
    initializationInProgress = false;
  }
}

/**
 * Return a valid HTTPS URL for the ttyd terminal.
 */
export async function getTerminalHttpUrl(): Promise<string> {
  const sandbox = await getOrCreateSharedSandbox();

  const rawDomain = String(
    sandbox.domain(TERMINAL_PORT)
  ).trim();

  // Remove any existing or duplicated protocol.
  const hostname = rawDomain
    .replace(/^(https?:\/\/)+/i, "")
    .replace(/\/+$/, "");

  if (!hostname) {
    throw new Error(
      "Vercel Sandbox returned an empty terminal domain"
    );
  }

  const terminalUrl = `https://${hostname}`;

  console.log(
    "[sandbox] Terminal URL:",
    terminalUrl
  );

  return terminalUrl;
}

/**
 * Read sandbox status from Turso.
 */
export async function getSandboxStatus(): Promise<SandboxStatus> {
  try {
    const db = getTursoClient();

    const result = await db.execute({
      sql: `
        SELECT sandbox_name, status, last_started_at
        FROM sandbox_metadata
        WHERE id = 'shared'
      `,
      args: [],
    });

    if (result.rows.length === 0) {
      return {
        name: SANDBOX_NAME,
        status: "unknown",
      };
    }

    const row = result.rows[0];

    return {
      name: String(row.sandbox_name),
      status: String(row.status) as SandboxStatus["status"],
      lastStartedAt: row.last_started_at
        ? Number(row.last_started_at)
        : undefined,
    };
  } catch (err) {
    console.error(
      "[sandbox] Failed to read status:",
      err
    );

    return {
      name: SANDBOX_NAME,
      status: "unknown",
    };
  }
}

/**
 * Clear the in-memory sandbox reference.
 */
export function invalidateSandboxCache(): void {
  sharedSandbox = null;
}

