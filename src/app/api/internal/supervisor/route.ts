/**
 * POST /api/internal/supervisor
 *
 * Secure supervisor endpoint called by an external scheduler (e.g. cron-job.org).
 * Authenticates via SUPERVISOR_SECRET header, then:
 *   1. Acquires a DB lock to prevent duplicate runs.
 *   2. Finds all users whose sandbox has not been heartbeat-updated recently.
 *   3. Resumes each expired sandbox and restarts eligible managed processes.
 *   4. Records heartbeat + recovery events in the DB.
 *   5. Releases the lock.
 *
 * IMPORTANT platform limits:
 * - Vercel Hobby Sandbox sessions expire after 45 minutes of inactivity.
 * - Resuming a sandbox starts a new session but preserves the filesystem.
 * - Running processes do NOT survive between sessions; they must be restarted.
 * - There is no way to truly "keep alive" a session beyond 45 minutes on Hobby.
 * - This supervisor provides automatic recovery, not uninterrupted execution.
 *
 * External scheduler: cron-job.org (free), configured to call this endpoint
 * every 10 minutes with the SUPERVISOR_SECRET in the Authorization header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getTursoClient } from "@/lib/turso";
import {
  getOrCreateUserSandbox,
  recoverManagedProcesses,
  invalidateUserSandboxCache,
} from "@/lib/sandbox";
import { randomUUID } from "crypto";
import { timingSafeEqual, createHmac } from "crypto";

// Lock TTL: 8 minutes (must be < scheduler interval to avoid permanent deadlock)
const LOCK_TTL_SECONDS = 8 * 60;

// Heartbeat threshold: resume sandboxes last seen > 40 minutes ago
// (Sandbox session is 45min; we try to recover before users notice)
const HEARTBEAT_STALE_SECONDS = 40 * 60;

/** Constant-time secret comparison to prevent timing attacks. */
function secretMatches(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(createHmac("sha256", "dwt").update(provided).digest("hex"));
    const b = Buffer.from(createHmac("sha256", "dwt").update(expected).digest("hex"));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Acquire the supervisor DB lock. Returns true if acquired. */
async function acquireLock(requestId: string): Promise<boolean> {
  const db = getTursoClient();
  const now = Math.floor(Date.now() / 1000);
  const expires = now + LOCK_TTL_SECONDS;

  try {
    // Only acquire if no lock or existing lock has expired
    const result = await db.execute({
      sql: `UPDATE supervisor_lock
              SET locked_at = ?, lock_expires_at = ?, locked_by = ?
              WHERE id = 'global'
                AND (locked_at IS NULL OR lock_expires_at < ?)`,
      args: [now, expires, requestId, now],
    });

    return (result.rowsAffected ?? 0) > 0;
  } catch (err) {
    console.error("[supervisor] Lock acquisition error:", err);
    return false;
  }
}

/** Release the supervisor DB lock. */
async function releaseLock(requestId: string): Promise<void> {
  try {
    const db = getTursoClient();
    await db.execute({
      sql: `UPDATE supervisor_lock
              SET locked_at = NULL, lock_expires_at = NULL, locked_by = NULL
              WHERE id = 'global' AND locked_by = ?`,
      args: [requestId],
    });
  } catch (err) {
    console.error("[supervisor] Lock release error:", err);
  }
}

/** Record a supervisor heartbeat in the DB. */
async function recordHeartbeat(
  action: string,
  result: unknown,
  durationMs: number,
  error?: string,
  userId?: string
): Promise<void> {
  try {
    const db = getTursoClient();
    await db.execute({
      sql: `INSERT INTO supervisor_heartbeats
              (id, ran_at, action, sandbox_user_id, result, duration_ms, error)
            VALUES (?, unixepoch(), ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        action,
        userId ?? null,
        JSON.stringify(result),
        durationMs,
        error ?? null,
      ],
    });
  } catch (err) {
    console.error("[supervisor] Failed to record heartbeat:", err);
  }
}

/** Record a recovery event in the DB. */
async function recordRecoveryEvent(opts: {
  userId?: string;
  sandboxName: string;
  trigger: string;
  startedAt: number;
  success: boolean;
  processesRestarted: number;
  processesFailed: number;
  error?: string;
  details?: string;
}): Promise<void> {
  try {
    const db = getTursoClient();
    await db.execute({
      sql: `INSERT INTO recovery_events
              (id, user_id, sandbox_name, trigger, started_at, completed_at,
               success, processes_restarted, processes_failed, error, details)
            VALUES (?, ?, ?, ?, ?, unixepoch(), ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        opts.userId ?? null,
        opts.sandboxName,
        opts.trigger,
        opts.startedAt,
        opts.success ? 1 : 0,
        opts.processesRestarted,
        opts.processesFailed,
        opts.error ?? null,
        opts.details ?? null,
      ],
    });
  } catch (err) {
    console.error("[supervisor] Failed to record recovery event:", err);
  }
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const requestId = randomUUID();

  // ── 1. Authenticate ───────────────────────────────────────────────────────
  const supervisorSecret = process.env.SUPERVISOR_SECRET;
  if (!supervisorSecret) {
    console.error("[supervisor] SUPERVISOR_SECRET is not configured");
    return NextResponse.json(
      { error: "Supervisor not configured" },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const providedSecret = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!providedSecret || !secretMatches(providedSecret, supervisorSecret)) {
    // Log without revealing the secret
    console.warn("[supervisor] Unauthorized request from:", req.headers.get("x-forwarded-for") ?? "unknown");
    await recordHeartbeat("auth-failure", { ip: req.headers.get("x-forwarded-for") }, Date.now() - start);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 2. Acquire lock ───────────────────────────────────────────────────────
  const acquired = await acquireLock(requestId);
  if (!acquired) {
    console.log("[supervisor] Another supervisor run is in progress, skipping.");
    await recordHeartbeat("skip", { reason: "locked" }, Date.now() - start);
    return NextResponse.json({
      action: "skip",
      reason: "Another supervisor run is in progress",
      requestId,
    });
  }

  const recoveryResults: Array<{
    userId: string;
    sandboxName: string;
    action: string;
    processesRestarted: number;
    processesFailed: number;
    error?: string;
  }> = [];

  try {
    const db = getTursoClient();
    const now = Math.floor(Date.now() / 1000);
    const staleThreshold = now - HEARTBEAT_STALE_SECONDS;

    // ── 3. Find users with stale or unknown sandboxes ─────────────────────
    const staleResult = await db.execute({
      sql: `SELECT us.user_id, us.sandbox_name, us.status, us.last_heartbeat_at,
                   u.username, u.is_active
              FROM user_sandboxes us
              JOIN users u ON us.user_id = u.id
              WHERE u.is_active = 1
                AND (
                  us.last_heartbeat_at IS NULL
                  OR us.last_heartbeat_at < ?
                  OR us.status = 'unknown'
                )
              ORDER BY us.last_heartbeat_at ASC NULLS FIRST
              LIMIT 10`,
      args: [staleThreshold],
    });

    console.log(
      `[supervisor] Found ${staleResult.rows.length} sandboxes to check`
    );

    // ── 4. Recover each stale sandbox ─────────────────────────────────────
    for (const row of staleResult.rows) {
      const userId = String(row.user_id);
      const sandboxName = String(row.sandbox_name);
      const sandboxStart = Date.now();

      console.log(`[supervisor] Recovering sandbox for user ${userId} (${sandboxName})`);

      // Invalidate in-memory cache so we force a fresh getOrCreate
      invalidateUserSandboxCache(userId);

      let processesRestarted = 0;
      let processesFailed = 0;
      let recoveryError: string | undefined;
      let recoveryDetails: string | undefined;

      try {
        // Resume (or create) the sandbox — this starts ttyd
        await getOrCreateUserSandbox(userId);

        // Restart managed processes
        const procResult = await recoverManagedProcesses(userId);
        processesRestarted = procResult.restarted;
        processesFailed = procResult.failed;
        recoveryDetails = procResult.details.join("; ");

        // Update heartbeat timestamp
        await db.execute({
          sql: `UPDATE user_sandboxes
                  SET last_heartbeat_at = ?, updated_at = unixepoch()
                  WHERE user_id = ?`,
          args: [now, userId],
        });

        recoveryResults.push({
          userId,
          sandboxName,
          action: "recovered",
          processesRestarted,
          processesFailed,
        });

        await recordRecoveryEvent({
          userId,
          sandboxName,
          trigger: "supervisor",
          startedAt: Math.floor(sandboxStart / 1000),
          success: true,
          processesRestarted,
          processesFailed,
          details: recoveryDetails,
        });

        console.log(
          `[supervisor] ✓ Recovered ${sandboxName}: ${processesRestarted} processes restarted`
        );
      } catch (err) {
        recoveryError = err instanceof Error ? err.message : String(err);
        console.error(
          `[supervisor] ✗ Failed to recover ${sandboxName}:`,
          recoveryError
        );

        recoveryResults.push({
          userId,
          sandboxName,
          action: "error",
          processesRestarted: 0,
          processesFailed: 0,
          error: recoveryError,
        });

        await recordRecoveryEvent({
          userId,
          sandboxName,
          trigger: "supervisor",
          startedAt: Math.floor(sandboxStart / 1000),
          success: false,
          processesRestarted: 0,
          processesFailed: 0,
          error: recoveryError,
        });
      }
    }

    const duration = Date.now() - start;
    const summary = {
      action: "check",
      sandboxesChecked: staleResult.rows.length,
      recoveryResults,
      durationMs: duration,
      requestId,
    };

    await recordHeartbeat("check", summary, duration);

    return NextResponse.json(summary);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Don't expose internal error details
    console.error("[supervisor] Supervisor error:", errMsg);
    const duration = Date.now() - start;
    await recordHeartbeat("error", { sandboxesChecked: 0 }, duration, errMsg);
    return NextResponse.json(
      { error: "Supervisor error", requestId },
      { status: 500 }
    );
  } finally {
    await releaseLock(requestId);
  }
}

// Block all other HTTP methods
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
