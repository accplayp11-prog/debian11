/**
 * Authentication library
 * Handles: login, logout, session management, rate limiting, audit logging
 */

import * as argon2 from "argon2";
import { randomUUID, createHash } from "crypto";
import { getTursoClient } from "./turso";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

// Session cookie name
export const SESSION_COOKIE = "dwt_session";

// Session duration: 24 hours
const SESSION_DURATION_SECONDS = 24 * 60 * 60;

// Rate limiting: max 5 failed attempts per 15 minutes per IP
const MAX_FAILED_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  isActive: boolean;
}

export interface Session {
  id: string;
  userId: string;
  username: string;
  isAdmin: boolean;
  expiresAt: number;
}

/**
 * Hash a session token for secure storage.
 * We store hashed tokens — never raw tokens — in the database.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Check if an IP address has exceeded the failed login rate limit.
 */
export async function isRateLimited(ipAddress: string): Promise<boolean> {
  const db = getTursoClient();
  const windowStart = Math.floor(Date.now() / 1000) - RATE_LIMIT_WINDOW_SECONDS;

  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM login_attempts
          WHERE ip_address = ? AND success = 0 AND attempted_at > ?`,
    args: [ipAddress, windowStart],
  });

  const count = Number(result.rows[0]?.count ?? 0);
  return count >= MAX_FAILED_ATTEMPTS;
}

/**
 * Record a login attempt in the database.
 */
async function recordLoginAttempt(
  username: string,
  ipAddress: string,
  success: boolean
): Promise<void> {
  const db = getTursoClient();
  await db.execute({
    sql: `INSERT INTO login_attempts (id, username, ip_address, success, attempted_at)
          VALUES (?, ?, ?, ?, unixepoch())`,
    args: [randomUUID(), username, ipAddress, success ? 1 : 0],
  });
}

/**
 * Write an audit log entry.
 */
export async function writeAuditLog(params: {
  userId?: string;
  action: string;
  resource?: string;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    const db = getTursoClient();
    await db.execute({
      sql: `INSERT INTO audit_logs (id, user_id, action, resource, details, ip_address, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
      args: [
        randomUUID(),
        params.userId ?? null,
        params.action,
        params.resource ?? null,
        params.details ?? null,
        params.ipAddress ?? null,
        params.userAgent ?? null,
      ],
    });
  } catch {
    // Audit log failures should not break the application
    console.error("[audit] Failed to write audit log:", params);
  }
}

/**
 * Attempt to authenticate a user with username and password.
 * Returns a session token on success, or throws on failure.
 */
export async function login(
  username: string,
  password: string,
  ipAddress: string,
  userAgent: string
): Promise<string> {
  const db = getTursoClient();

  // Rate limit check
  if (await isRateLimited(ipAddress)) {
    throw new Error(
      "Too many failed login attempts. Please wait 15 minutes before trying again."
    );
  }

  // Look up user
  const userResult = await db.execute({
    sql: `SELECT id, username, password_hash, is_active, is_admin
          FROM users WHERE username = ? AND is_active = 1`,
    args: [username],
  });

  if (userResult.rows.length === 0) {
    // Record failed attempt (even for non-existent users to prevent enumeration timing)
    await recordLoginAttempt(username, ipAddress, false);
    await writeAuditLog({
      action: "login.failed",
      details: `Unknown user: ${username}`,
      ipAddress,
      userAgent,
    });
    throw new Error("Invalid username or password.");
  }

  const userRow = userResult.rows[0];
  const passwordHash = String(userRow.password_hash);

  // Verify password
  let passwordValid = false;
  try {
    passwordValid = await argon2.verify(passwordHash, password);
  } catch {
    throw new Error("Authentication error. Please try again.");
  }

  if (!passwordValid) {
    await recordLoginAttempt(username, ipAddress, false);
    await writeAuditLog({
      userId: String(userRow.id),
      action: "login.failed",
      details: "Invalid password",
      ipAddress,
      userAgent,
    });
    throw new Error("Invalid username or password.");
  }

  // Record successful attempt
  await recordLoginAttempt(username, ipAddress, true);

  // Create session
  const sessionId = randomUUID();
  // Raw token: a UUID we send to the client as a cookie
  const rawToken = randomUUID() + "-" + randomUUID();
  const tokenHash = hashToken(rawToken);
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;

  await db.execute({
    sql: `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, created_at, expires_at, last_accessed_at, is_active)
          VALUES (?, ?, ?, ?, ?, unixepoch(), ?, unixepoch(), 1)`,
    args: [
      sessionId,
      String(userRow.id),
      tokenHash,
      ipAddress,
      userAgent,
      expiresAt,
    ],
  });

  // Update last_login_at
  await db.execute({
    sql: `UPDATE users SET last_login_at = unixepoch() WHERE id = ?`,
    args: [String(userRow.id)],
  });

  await writeAuditLog({
    userId: String(userRow.id),
    action: "login.success",
    ipAddress,
    userAgent,
  });

  return rawToken;
}

/**
 * Validate a session token and return the session data.
 * Returns null if the token is invalid or expired.
 */
export async function validateSession(rawToken: string): Promise<Session | null> {
  if (!rawToken || rawToken.length < 32) return null;

  const db = getTursoClient();
  const tokenHash = hashToken(rawToken);
  const now = Math.floor(Date.now() / 1000);

  const result = await db.execute({
    sql: `SELECT s.id, s.user_id, s.expires_at, u.username, u.is_admin, u.is_active
          FROM sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token_hash = ?
            AND s.is_active = 1
            AND s.expires_at > ?
            AND u.is_active = 1`,
    args: [tokenHash, now],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Update last_accessed_at
  await db.execute({
    sql: `UPDATE sessions SET last_accessed_at = unixepoch() WHERE id = ?`,
    args: [String(row.id)],
  });

  return {
    id: String(row.id),
    userId: String(row.user_id),
    username: String(row.username),
    isAdmin: Boolean(row.is_admin),
    expiresAt: Number(row.expires_at),
  };
}

/**
 * Invalidate a session (logout).
 */
export async function logout(rawToken: string, userId?: string): Promise<void> {
  const db = getTursoClient();
  const tokenHash = hashToken(rawToken);

  await db.execute({
    sql: `UPDATE sessions SET is_active = 0 WHERE token_hash = ?`,
    args: [tokenHash],
  });

  await writeAuditLog({
    userId,
    action: "logout",
  });
}

/**
 * Extract the session token from a Next.js request's cookies.
 */
export async function getSessionFromRequest(
  req: NextRequest
): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
}

/**
 * Get the session from the Next.js server-side cookies() API.
 */
export async function getServerSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(token);
}

/**
 * Get client IP address from a Next.js request.
 */
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
