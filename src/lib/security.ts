/**
 * Security utilities
 */

import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionFromRequest, writeAuditLog } from "./auth";
import { createHash } from "crypto";

/**
 * Validate that a request comes from an allowed origin.
 */
export function validateOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;
    if (originHost === host) return true;
    if (originHost.endsWith(".vercel.app")) return true;
    if (originHost.endsWith(".vercel.run")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Protect an API route with session authentication.
 */
export async function requireAuth(
  req: NextRequest,
  options?: { logAction?: string }
) {
  const session = await getSessionFromRequest(req);

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Unauthorized", message: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  if (options?.logAction) {
    await writeAuditLog({
      userId: session.userId,
      action: options.logAction,
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  }

  return { session, error: null };
}

/**
 * Protect an API route that requires admin privileges.
 */
export async function requireAdmin(
  req: NextRequest,
  options?: { logAction?: string }
) {
  const session = await getSessionFromRequest(req);

  if (!session) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Unauthorized", message: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  if (!session.isAdmin) {
    await writeAuditLog({
      userId: session.userId,
      action: "admin.access.denied",
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    });
    return {
      session: null,
      error: NextResponse.json(
        { error: "Forbidden", message: "Administrator access required." },
        { status: 403 }
      ),
    };
  }

  if (options?.logAction) {
    await writeAuditLog({
      userId: session.userId,
      action: options.logAction,
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  }

  return { session, error: null };
}

/**
 * Generate a CSRF token from session ID.
 */
export function generateCsrfToken(sessionId: string): string {
  const secret = process.env.SESSION_SECRET || "fallback-secret";
  return createHash("sha256")
    .update(sessionId + secret)
    .digest("hex")
    .substring(0, 32);
}

/**
 * Sanitize a string for safe display (strip dangerous HTML chars).
 */
export function sanitizeString(input: string, maxLength = 256): string {
  return input
    .replace(/[<>&"']/g, "")
    .trim()
    .substring(0, maxLength);
}
