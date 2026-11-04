/**
 * Security utilities
 */

import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionFromRequest, writeAuditLog } from "./auth";

/**
 * Validate that a WebSocket upgrade request comes from an allowed origin.
 */
export function validateOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  if (!origin || !host) return false;

  // Allow same-origin requests
  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host;

    // Allow same host (handles http and https)
    if (originHost === host) return true;

    // Allow Vercel preview deployments
    if (originHost.endsWith(".vercel.app")) return true;
    if (originHost.endsWith(".vercel.run")) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Middleware to protect an API route with session authentication.
 * Returns the session on success or an error response on failure.
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
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown",
      userAgent: req.headers.get("user-agent") || undefined,
    });
  }

  return { session, error: null };
}

/**
 * Generate a CSRF token (simple approach using session ID).
 * For this application, we rely on SameSite=Strict cookies + Origin validation
 * rather than a separate CSRF token for most endpoints.
 */
export function generateCsrfToken(sessionId: string): string {
  const { createHash } = require("crypto");
  const secret = process.env.SESSION_SECRET || "fallback-secret";
  return createHash("sha256")
    .update(sessionId + secret)
    .digest("hex")
    .substring(0, 32);
}

/**
 * Sanitize a string for safe display (strip HTML).
 */
export function sanitizeString(input: string, maxLength = 256): string {
  return input
    .replace(/[<>&"']/g, "")
    .trim()
    .substring(0, maxLength);
}
