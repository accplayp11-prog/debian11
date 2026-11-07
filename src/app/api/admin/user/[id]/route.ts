/**
 * GET    /api/admin/user/[id]  — Get user details
 * PATCH  /api/admin/user/[id]  — Update user (disable/enable, reset password, change role)
 * DELETE /api/admin/user/[id]  — Delete user and their sandbox/processes
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { getTursoClient } from "@/lib/turso";
import { writeAuditLog } from "@/lib/auth";
import { sanitizeString } from "@/lib/security";
import * as argon2 from "argon2";
import { invalidateUserSandboxCache } from "@/lib/sandbox";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const { id: targetUserId } = await params;
  const db = getTursoClient();

  const userResult = await db.execute({
    sql: `SELECT u.id, u.username, u.email, u.is_active, u.is_admin,
                 u.created_at, u.last_login_at, u.updated_at,
                 us.sandbox_name, us.status as sandbox_status,
                 us.last_started_at, us.last_heartbeat_at
            FROM users u
            LEFT JOIN user_sandboxes us ON us.user_id = u.id
            WHERE u.id = ?`,
    args: [targetUserId],
  });

  if (userResult.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const u = userResult.rows[0];

  // Get process stats
  const procResult = await db.execute({
    sql: `SELECT status, COUNT(*) as count FROM managed_processes WHERE user_id = ? GROUP BY status`,
    args: [targetUserId],
  });

  const processCounts: Record<string, number> = {};
  for (const row of procResult.rows) {
    processCounts[String(row.status)] = Number(row.count);
  }

  // Get recent recovery events
  const recoveryResult = await db.execute({
    sql: `SELECT id, trigger, started_at, success, processes_restarted, error
            FROM recovery_events WHERE user_id = ?
            ORDER BY started_at DESC LIMIT 10`,
    args: [targetUserId],
  });

  return NextResponse.json({
    user: {
      id: String(u.id),
      username: String(u.username),
      email: u.email ? String(u.email) : null,
      isActive: Boolean(u.is_active),
      isAdmin: Boolean(u.is_admin),
      createdAt: Number(u.created_at),
      lastLoginAt: u.last_login_at ? Number(u.last_login_at) : null,
      updatedAt: Number(u.updated_at),
      sandbox: {
        name: u.sandbox_name ? String(u.sandbox_name) : null,
        status: u.sandbox_status ? String(u.sandbox_status) : "none",
        lastStartedAt: u.last_started_at ? Number(u.last_started_at) : null,
        lastHeartbeatAt: u.last_heartbeat_at ? Number(u.last_heartbeat_at) : null,
      },
      processCounts,
    },
    recentRecoveryEvents: recoveryResult.rows.map((r) => ({
      id: String(r.id),
      trigger: String(r.trigger),
      startedAt: Number(r.started_at),
      success: Boolean(r.success),
      processesRestarted: Number(r.processes_restarted),
      error: r.error ? String(r.error) : null,
    })),
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const { id: targetUserId } = await params;

  let body: {
    isActive?: boolean;
    isAdmin?: boolean;
    newPassword?: string;
    email?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getTursoClient();

  // Verify user exists
  const existing = await db.execute({
    sql: "SELECT id, username, is_admin FROM users WHERE id = ?",
    args: [targetUserId],
  });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const targetUser = existing.rows[0];

  // Prevent admin from demoting/disabling themselves
  if (targetUserId === session!.userId) {
    if (body.isActive === false) {
      return NextResponse.json({ error: "You cannot disable your own account" }, { status: 400 });
    }
    if (body.isAdmin === false) {
      return NextResponse.json({ error: "You cannot remove your own admin role" }, { status: 400 });
    }
  }

  const updates: string[] = ["updated_at = unixepoch()"];
  const args: (string | number | null)[] = [];

  if (body.isActive !== undefined) {
    updates.push("is_active = ?");
    args.push(body.isActive ? 1 : 0);
  }

  if (body.isAdmin !== undefined) {
    updates.push("is_admin = ?");
    args.push(body.isAdmin ? 1 : 0);
  }

  if (body.email !== undefined) {
    updates.push("email = ?");
    args.push(body.email ? sanitizeString(String(body.email), 128) : null);
  }

  if (body.newPassword) {
    if (body.newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });
    }
    const newHash = await argon2.hash(body.newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    updates.push("password_hash = ?");
    args.push(newHash);

    // Invalidate all sessions for this user
    await db.execute({
      sql: "UPDATE sessions SET is_active = 0 WHERE user_id = ?",
      args: [targetUserId],
    });
  }

  args.push(targetUserId);

  await db.execute({
    sql: `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  // If disabling, also invalidate sandbox cache
  if (body.isActive === false) {
    invalidateUserSandboxCache(targetUserId);
    await db.execute({
      sql: "UPDATE sessions SET is_active = 0 WHERE user_id = ?",
      args: [targetUserId],
    });
  }

  await writeAuditLog({
    userId: session!.userId,
    action: "admin.users.update",
    resource: targetUserId,
    details: `Updated user ${String(targetUser.username)}: ${Object.keys(body).filter(k => k !== "newPassword").join(", ")}${body.newPassword ? ", password" : ""}`,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const { id: targetUserId } = await params;

  if (targetUserId === session!.userId) {
    return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
  }

  const db = getTursoClient();

  const existing = await db.execute({
    sql: "SELECT username FROM users WHERE id = ?",
    args: [targetUserId],
  });
  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const username = String(existing.rows[0].username);

  // Invalidate sandbox cache first
  invalidateUserSandboxCache(targetUserId);

  // Delete user (cascades to sessions, sandboxes, processes via FK)
  await db.execute({
    sql: "DELETE FROM users WHERE id = ?",
    args: [targetUserId],
  });

  await writeAuditLog({
    userId: session!.userId,
    action: "admin.users.delete",
    resource: targetUserId,
    details: `Deleted user: ${username}`,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  });

  return NextResponse.json({ success: true });
}
