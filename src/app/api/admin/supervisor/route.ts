/**
 * GET /api/admin/supervisor — Get supervisor heartbeats and recovery events (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { getTursoClient } from "@/lib/turso";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const db = getTursoClient();

  const heartbeatsResult = await db.execute({
    sql: `SELECT id, ran_at, action, result, duration_ms, error
            FROM supervisor_heartbeats
            ORDER BY ran_at DESC
            LIMIT 50`,
    args: [],
  });

  const recoveryResult = await db.execute({
    sql: `SELECT re.id, re.user_id, u.username, re.sandbox_name, re.trigger,
                 re.started_at, re.completed_at, re.success,
                 re.processes_restarted, re.processes_failed, re.error
            FROM recovery_events re
            LEFT JOIN users u ON re.user_id = u.id
            ORDER BY re.started_at DESC
            LIMIT 100`,
    args: [],
  });

  // Get lock status
  const lockResult = await db.execute({
    sql: "SELECT locked_at, lock_expires_at, locked_by FROM supervisor_lock WHERE id = 'global'",
    args: [],
  });

  const lockRow = lockResult.rows[0];
  const now = Math.floor(Date.now() / 1000);
  const isLocked = lockRow?.locked_at !== null &&
    lockRow?.lock_expires_at !== null &&
    Number(lockRow.lock_expires_at) > now;

  return NextResponse.json({
    lock: {
      isLocked,
      lockedAt: lockRow?.locked_at ? Number(lockRow.locked_at) : null,
      lockExpiresAt: lockRow?.lock_expires_at ? Number(lockRow.lock_expires_at) : null,
      lockedBy: lockRow?.locked_by ? String(lockRow.locked_by) : null,
    },
    heartbeats: heartbeatsResult.rows.map((r) => ({
      id: String(r.id),
      ranAt: Number(r.ran_at),
      action: String(r.action),
      result: r.result ? (() => { try { return JSON.parse(String(r.result)); } catch { return String(r.result); } })() : null,
      durationMs: r.duration_ms ? Number(r.duration_ms) : null,
      error: r.error ? String(r.error) : null,
    })),
    recoveryEvents: recoveryResult.rows.map((r) => ({
      id: String(r.id),
      userId: r.user_id ? String(r.user_id) : null,
      username: r.username ? String(r.username) : null,
      sandboxName: String(r.sandbox_name),
      trigger: String(r.trigger),
      startedAt: Number(r.started_at),
      completedAt: r.completed_at ? Number(r.completed_at) : null,
      success: Boolean(r.success),
      processesRestarted: Number(r.processes_restarted),
      processesFailed: Number(r.processes_failed),
      error: r.error ? String(r.error) : null,
    })),
  });
}
