
/**
 * Sandbox library — per-user Vercel Sandbox management
 *
 * Key design decisions:
 * - Each user gets a unique, named, persistent Sandbox.
 * - Sandbox names are deterministic: `dwt-<userId-prefix>` so we never create duplicates.
 * - ttyd is started/restarted on every session creation or resume.
 * - The in-memory cache is per-process (Vercel serverless).
 *   The database is the source of truth for persistent state.
 * - On Vercel Hobby, Sandboxes stop after 45 minutes. The supervisor resumes them.
 */

import { Sandbox } from "@vercel/sandbox";
import { getTursoClient } from "./turso";
import { randomUUID } from "crypto";

export const TERMINAL_PORT = 7681;

// In-memory cache: maps userId -> Sandbox instance
const sandboxCache = new Map<string, Sandbox>();
const initInProgress = new Set<string>();

const SANDBOX_IMAGE =
  process.env.SANDBOX_IMAGE || "debian-11-terminal:latest";

// Vercel Hobby maximum session timeout: 45 minutes
const SANDBOX_TIMEOUT_MS = 45 * 60 * 1000;

export interface SandboxInfo {
  sandboxName: string;
  status: "running" | "stopped" | "starting" | "unknown";
  terminalUrl?: string;
  lastStartedAt?: number;
  lastHeartbeatAt?: number;
}

export interface ManagedProcess {
  id: string;
  userId: string;
  name: string;
  command: string;
  workingDir: string;
  restartPolicy: "always" | "on-failure" | "never";
  logFile?: string;
  status: "running" | "stopped" | "failed" | "starting";
  pid?: number;
  failureCount: number;
  maxFailures: number;
  createdAt: number;
  lastStartedAt?: number;
  lastError?: string;
  isInteractive: boolean;
}

/** Derive a stable, unique sandbox name for a user. */
export function userSandboxName(userId: string): string {
  const short = userId.replace(/-/g, "").substring(0, 16);
  return `dwt-${short}`;
}

/** Ensure the user_sandboxes DB row exists. */
async function ensureUserSandboxRow(userId: string): Promise<void> {
  const db = getTursoClient();
  const name = userSandboxName(userId);

  await db.execute({
    sql: `INSERT OR IGNORE INTO user_sandboxes
            (id, user_id, sandbox_name, status, ttyd_port, image, created_at, updated_at)
          VALUES (?, ?, ?, 'unknown', ?, ?, unixepoch(), unixepoch())`,
    args: [randomUUID(), userId, name, TERMINAL_PORT, SANDBOX_IMAGE],
  });
}

/** Update sandbox DB status row. */
async function setSandboxStatus(
  userId: string,
  status: string,
  extras?: {
    lastStartedAt?: number;
    terminalUrl?: string;
    lastHeartbeatAt?: number;
  }
): Promise<void> {
  try {
    const db = getTursoClient();
    let extraSql = "";
    const args: (string | number | null)[] = [status];

    if (extras?.lastStartedAt !== undefined) {
      extraSql += ", last_started_at = ?";
      args.push(extras.lastStartedAt);
    }

    if (extras?.terminalUrl !== undefined) {
      extraSql += ", terminal_url = ?";
      args.push(extras.terminalUrl);
    }

    if (extras?.lastHeartbeatAt !== undefined) {
      extraSql += ", last_heartbeat_at = ?";
      args.push(extras.lastHeartbeatAt);
    }

    args.push(userId);

    await db.execute({
      sql: `UPDATE user_sandboxes
              SET status = ?, updated_at = unixepoch()${extraSql}
              WHERE user_id = ?`,
      args,
    });
  } catch (err) {
    console.error("[sandbox] Failed to update sandbox status:", err);
  }
}

/** Install ttyd if needed and start it, waiting until it listens. */
async function startTtyd(
  sandbox: Sandbox,
  port: number
): Promise<void> {
  console.log("[sandbox] Setting up ttyd...");

  // Kill any existing instance.
  // Commands run directly without sudo to avoid hostname resolution errors.
  await sandbox.runCommand({
    cmd: "bash",
    args: ["-c", "pkill -x ttyd 2>/dev/null || true"],
  });

  await new Promise((r) => setTimeout(r, 400));

  // Check installation.
  const checkResult = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      "command -v ttyd >/dev/null 2>&1 && echo FOUND || echo NOT_FOUND",
    ],
  });

  const checkOut = await checkResult.stdout();

  if (checkOut.includes("NOT_FOUND")) {
    console.log("[sandbox] Installing ttyd...");

    const installResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        "curl -fsSL --retry 5 https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 -o /usr/local/bin/ttyd && chmod 0755 /usr/local/bin/ttyd",
      ],
      timeoutMs: 90000,
    });

    if (installResult.exitCode !== 0) {
      const err = await installResult.stderr();
      throw new Error(`ttyd installation failed: ${err}`);
    }
  }

  // Start ttyd (detached).
  const startResult = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-c",
      `nohup /usr/local/bin/ttyd --port ${port} --interface 0.0.0.0 --writable --client-option enableZmodem=false bash -l > /tmp/ttyd.log 2>&1 & echo $! > /tmp/ttyd.pid && echo "started"`,
    ],
    detached: true,
  });

  if (startResult.exitCode !== 0) {
    const err = await startResult.stderr();
    throw new Error(`Failed to launch ttyd: ${err}`);
  }

  // Poll until ready.
  let ready = false;

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));

    const v = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-c",
        `ss -tln 2>/dev/null | grep -q ':${port} ' && echo READY || echo WAITING`,
      ],
    });

    if ((await v.stdout()).includes("READY")) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    const logResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "cat /tmp/ttyd.log 2>/dev/null || echo 'no log'"],
    });

    throw new Error(`ttyd not ready. Log: ${await logResult.stdout()}`);
  }

  console.log(`[sandbox] ttyd listening on port ${port}`);
}

/** Get or create a Sandbox for the specified user. */
export async function getOrCreateUserSandbox(
  userId: string
): Promise<Sandbox> {
  const cached = sandboxCache.get(userId);
  if (cached) return cached;

  if (initInProgress.has(userId)) {
    let waited = 0;

    while (initInProgress.has(userId) && waited < 90000) {
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }

    const c = sandboxCache.get(userId);
    if (c) return c;

    throw new Error("Sandbox initialization timed out");
  }

  initInProgress.add(userId);

  try {
    await ensureUserSandboxRow(userId);

    const sandboxName = userSandboxName(userId);
    console.log(`[sandbox] Initializing sandbox: ${sandboxName}`);

    await setSandboxStatus(userId, "starting");

    const sandbox = await Sandbox.getOrCreate({
      name: sandboxName,
      image: SANDBOX_IMAGE,
      ports: [TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT_MS,
      persistent: true,
      resume: true,

      onCreate: async (sbx) => {
        console.log(`[sandbox] onCreate: ${sandboxName}`);
        await startTtyd(sbx, TERMINAL_PORT);
      },

      onResume: async (sbx) => {
        console.log(`[sandbox] onResume: ${sandboxName}`);
        await startTtyd(sbx, TERMINAL_PORT);
      },
    });

    sandboxCache.set(userId, sandbox);

    const rawDomain = String(
      sandbox.domain(TERMINAL_PORT)
    ).trim();

    const hostname = rawDomain
      .replace(/^(https?:\/\/)+/i, "")
      .replace(/\/+$/, "");

    const terminalUrl = `https://${hostname}`;
    const now = Math.floor(Date.now() / 1000);

    await setSandboxStatus(userId, "running", {
      lastStartedAt: now,
      terminalUrl,
      lastHeartbeatAt: now,
    });

    console.log(`[sandbox] Ready: ${terminalUrl}`);

    return sandbox;
  } catch (err) {
    sandboxCache.delete(userId);
    await setSandboxStatus(userId, "unknown");
    throw err;
  } finally {
    initInProgress.delete(userId);
  }
}

/** Get the terminal URL for a user (starts sandbox if needed). */
export async function getUserTerminalUrl(
  userId: string
): Promise<string> {
  const sandbox = await getOrCreateUserSandbox(userId);

  const rawDomain = String(
    sandbox.domain(TERMINAL_PORT)
  ).trim();

  const hostname = rawDomain
    .replace(/^(https?:\/\/)+/i, "")
    .replace(/\/+$/, "");

  if (!hostname) {
    throw new Error("Sandbox returned empty terminal domain");
  }

  return `https://${hostname}`;
}

/** Read sandbox info from the DB without starting anything. */
export async function getUserSandboxInfo(
  userId: string
): Promise<SandboxInfo> {
  try {
    await ensureUserSandboxRow(userId);

    const db = getTursoClient();

    const result = await db.execute({
      sql: `SELECT sandbox_name, status, last_started_at, last_heartbeat_at, terminal_url
              FROM user_sandboxes WHERE user_id = ?`,
      args: [userId],
    });

    if (result.rows.length === 0) {
      return {
        sandboxName: userSandboxName(userId),
        status: "unknown",
      };
    }

    const row = result.rows[0];

    return {
      sandboxName: String(row.sandbox_name),
      status: String(row.status) as SandboxInfo["status"],
      terminalUrl: row.terminal_url
        ? String(row.terminal_url)
        : undefined,
      lastStartedAt: row.last_started_at
        ? Number(row.last_started_at)
        : undefined,
      lastHeartbeatAt: row.last_heartbeat_at
        ? Number(row.last_heartbeat_at)
        : undefined,
    };
  } catch (err) {
    console.error("[sandbox] getSandboxInfo error:", err);

    return {
      sandboxName: userSandboxName(userId),
      status: "unknown",
    };
  }
}

/** Remove sandbox from in-memory cache (force re-init next request). */
export function invalidateUserSandboxCache(userId: string): void {
  sandboxCache.delete(userId);
}

// =============================================================================
// Managed Process Manager
// =============================================================================

export async function registerManagedProcess(
  userId: string,
  opts: {
    name: string;
    command: string;
    workingDir?: string;
    restartPolicy?: "always" | "on-failure" | "never";
    logFile?: string;
    maxFailures?: number;
    isInteractive?: boolean;
  }
): Promise<string> {
  const db = getTursoClient();
  const id = randomUUID();

  const logFile =
    opts.logFile || `/tmp/proc-${id.substring(0, 8)}.log`;

  await db.execute({
    sql: `INSERT INTO managed_processes
            (id, user_id, name, command, working_dir, restart_policy, log_file,
             status, failure_count, max_failures, is_interactive, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'stopped', 0, ?, ?, unixepoch(), unixepoch())`,
    args: [
      id,
      userId,
      opts.name,
      opts.command,
      opts.workingDir ?? "/root",
      opts.restartPolicy ?? "on-failure",
      logFile,
      opts.maxFailures ?? 5,
      opts.isInteractive ? 1 : 0,
    ],
  });

  return id;
}

export async function listManagedProcesses(
  userId: string
): Promise<ManagedProcess[]> {
  const db = getTursoClient();

  const result = await db.execute({
    sql: `SELECT id, user_id, name, command, working_dir, restart_policy,
                 log_file, status, pid, failure_count, max_failures,
                 created_at, last_started_at, last_error, is_interactive
            FROM managed_processes WHERE user_id = ? ORDER BY created_at ASC`,
    args: [userId],
  });

  return result.rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    command: String(r.command),
    workingDir: String(r.working_dir),
    restartPolicy: String(r.restart_policy) as ManagedProcess["restartPolicy"],
    logFile: r.log_file ? String(r.log_file) : undefined,
    status: String(r.status) as ManagedProcess["status"],
    pid: r.pid ? Number(r.pid) : undefined,
    failureCount: Number(r.failure_count),
    maxFailures: Number(r.max_failures),
    createdAt: Number(r.created_at),
    lastStartedAt: r.last_started_at
      ? Number(r.last_started_at)
      : undefined,
    lastError: r.last_error
      ? String(r.last_error)
      : undefined,
    isInteractive: Boolean(r.is_interactive),
  }));
}

export async function startManagedProcess(
  userId: string,
  processId: string
): Promise<{ success: boolean; error?: string }> {
  const db = getTursoClient();

  const result = await db.execute({
    sql: "SELECT * FROM managed_processes WHERE id = ? AND user_id = ?",
    args: [processId, userId],
  });

  if (result.rows.length === 0) {
    return { success: false, error: "Process not found" };
  }

  const proc = result.rows[0];

  if (Boolean(proc.is_interactive)) {
    return {
      success: false,
      error: "Interactive processes cannot be auto-started",
    };
  }

  try {
    const sandbox = await getOrCreateUserSandbox(userId);

    const command = String(proc.command);
    const workingDir = String(proc.working_dir);
    const logFile = String(proc.log_file);

    // Check if already running.
    if (proc.pid) {
      const checkResult = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-c",
          `kill -0 ${proc.pid} 2>/dev/null && echo RUNNING || echo DEAD`,
        ],
      });

      if ((await checkResult.stdout()).includes("RUNNING")) {
        return { success: true };
      }
    }

    const startCmd =
      `cd "${workingDir}" && nohup bash -c ${JSON.stringify(command)} >> "${logFile}" 2>&1 & echo $!`;

    const startResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", startCmd],
      detached: true,
    });

    const pidStr = (await startResult.stdout()).trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      throw new Error(`Bad PID from start: ${pidStr}`);
    }

    await db.execute({
      sql: `UPDATE managed_processes
              SET status = 'running', pid = ?, last_started_at = unixepoch(),
                  last_error = NULL, updated_at = unixepoch()
              WHERE id = ?`,
      args: [pid, processId],
    });

    return { success: true };
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : String(err);

    await db.execute({
      sql: `UPDATE managed_processes
              SET status = 'failed', last_error = ?,
                  failure_count = failure_count + 1, updated_at = unixepoch()
              WHERE id = ?`,
      args: [errMsg.substring(0, 500), processId],
    });

    return { success: false, error: errMsg };
  }
}

export async function stopManagedProcess(
  userId: string,
  processId: string
): Promise<{ success: boolean; error?: string }> {
  const db = getTursoClient();

  const result = await db.execute({
    sql: "SELECT pid FROM managed_processes WHERE id = ? AND user_id = ?",
    args: [processId, userId],
  });

  if (result.rows.length === 0) {
    return { success: false, error: "Process not found" };
  }

  try {
    const pid = result.rows[0].pid;

    if (pid) {
      const sandbox = sandboxCache.get(userId);

      if (sandbox) {
        await sandbox.runCommand({
          cmd: "bash",
          args: [
            "-c",
            `kill -TERM ${pid} 2>/dev/null || true; sleep 2; kill -9 ${pid} 2>/dev/null || true`,
          ],
        });
      }
    }

    await db.execute({
      sql: `UPDATE managed_processes
              SET status = 'stopped', pid = NULL, last_stopped_at = unixepoch(),
                  updated_at = unixepoch()
              WHERE id = ?`,
      args: [processId],
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteManagedProcess(
  userId: string,
  processId: string
): Promise<boolean> {
  await stopManagedProcess(userId, processId);

  const db = getTursoClient();

  const result = await db.execute({
    sql: "DELETE FROM managed_processes WHERE id = ? AND user_id = ?",
    args: [processId, userId],
  });

  return (result.rowsAffected ?? 0) > 0;
}

export async function recoverManagedProcesses(
  userId: string
): Promise<{ restarted: number; failed: number; details: string[] }> {
  const processes = await listManagedProcesses(userId);

  const details: string[] = [];
  let restarted = 0;
  let failed = 0;

  for (const proc of processes) {
    if (proc.isInteractive || proc.restartPolicy === "never") {
      continue;
    }

    if (proc.failureCount >= proc.maxFailures) {
      details.push(
        `SKIP ${proc.name}: max failures (${proc.failureCount}/${proc.maxFailures})`
      );
      continue;
    }

    // Exponential backoff between restarts.
    if (proc.failureCount > 0) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(1000 * 2 ** proc.failureCount, 30000)
        )
      );
    }

    const result = await startManagedProcess(userId, proc.id);

    if (result.success) {
      restarted++;
      details.push(`STARTED ${proc.name}`);
    } else {
      failed++;
      details.push(`FAILED ${proc.name}: ${result.error}`);
    }
  }

  return { restarted, failed, details };
}

// Legacy compat
export async function getSandboxStatus() {
  return { name: "shared", status: "unknown" as const };
}

export function invalidateSandboxCache() {
  sandboxCache.clear();
}

