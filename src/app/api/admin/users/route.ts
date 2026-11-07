/**
 * GET  /api/admin/users  — List all users (admin only)
 * POST /api/admin/users  — Create a new user (admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { getTursoClient } from "@/lib/turso";
import { writeAuditLog } from "@/lib/auth";
import { sanitizeString } from "@/lib/security";
import * as argon2 from "argon2";
import { randomUUID } from "crypto";
import { userSandboxName } from "@/lib/sandbox";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  const db = getTursoClient();

  const result = await db.execute({
    sql: `SELECT u.id, u.username, u.email, u.is_active, u.is_admin,
                 u.created_at, u.last_login_at,
                 us.status as sandbox_status, us.last_heartbeat_at,
                 (SELECT COUNT(*) FROM managed_processes mp WHERE mp.user_id = u.id) as process_count
            FROM users u
            LEFT JOIN user_sandboxes us ON us.user_id = u.id
            ORDER BY u.created_at DESC`,
    args: [],
  });

  const users = result.rows.map((r) => ({
    id: String(r.id),
    username: String(r.username),
    email: r.email ? String(r.email) : null,
    isActive: Boolean(r.is_active),
    isAdmin: Boolean(r.is_admin),
    createdAt: Number(r.created_at),
    lastLoginAt: r.last_login_at ? Number(r.last_login_at) : null,
    sandboxStatus: r.sandbox_status ? String(r.sandbox_status) : "none",
    lastHeartbeatAt: r.last_heartbeat_at ? Number(r.last_heartbeat_at) : null,
    processCount: Number(r.process_count ?? 0),
  }));

  await writeAuditLog({
    userId: session!.userId,
    action: "admin.users.list",
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (error) return error;

  let body: {
    username?: string;
    password?: string;
    email?: string;
    isAdmin?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const username = sanitizeString(String(body.username || ""), 64).toLowerCase();
  const password = String(body.password || "");
  const email = body.email ? sanitizeString(String(body.email), 128) : null;
  const isAdmin = Boolean(body.isAdmin);

  if (!username || username.length < 2) {
    return NextResponse.json({ error: "Username must be at least 2 characters" }, { status: 400 });
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return NextResponse.json({ error: "Username may only contain letters, numbers, _ and -" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (password.length > 256) {
    return NextResponse.json({ error: "Password too long" }, { status: 400 });
  }

  const db = getTursoClient();

  // Check uniqueness
  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE username = ?",
    args: [username],
  });
  if (existing.rows.length > 0) {
    return NextResponse.json({ error: "Username already exists" }, { status: 409 });
  }

  // Hash password
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const userId = randomUUID();

  await db.execute({
    sql: `INSERT INTO users (id, username, email, password_hash, is_active, is_admin, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, unixepoch(), unixepoch())`,
    args: [userId, username, email, passwordHash, isAdmin ? 1 : 0],
  });

  // Pre-create sandbox row
  const sandboxName = userSandboxName(userId);
  await db.execute({
    sql: `INSERT OR IGNORE INTO user_sandboxes
            (id, user_id, sandbox_name, status, ttyd_port, created_at, updated_at)
          VALUES (?, ?, ?, 'unknown', 7681, unixepoch(), unixepoch())`,
    args: [randomUUID(), userId, sandboxName],
  });

  await writeAuditLog({
    userId: session!.userId,
    action: "admin.users.create",
    resource: userId,
    details: `Created user: ${username}`,
    ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  });

  return NextResponse.json({ success: true, userId, username }, { status: 201 });
}
