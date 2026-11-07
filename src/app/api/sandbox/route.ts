/**
 * GET /api/sandbox   — Get current user's sandbox status
 * POST /api/sandbox  — Initialize / wake up the user's personal sandbox
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/security";
import {
  getOrCreateUserSandbox,
  getUserTerminalUrl,
  getUserSandboxInfo,
  invalidateUserSandboxCache,
} from "@/lib/sandbox";
import { getTursoClient } from "@/lib/turso";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  const info = await getUserSandboxInfo(session!.userId);

  return NextResponse.json({
    status: info,
    username: session!.username,
    isAdmin: session!.isAdmin,
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  const userId = session!.userId;

  try {
    await getOrCreateUserSandbox(userId);
    const terminalUrl = await getUserTerminalUrl(userId);
    const info = await getUserSandboxInfo(userId);

    // Update heartbeat
    const db = getTursoClient();
    await db.execute({
      sql: "UPDATE user_sandboxes SET last_heartbeat_at = unixepoch() WHERE user_id = ?",
      args: [userId],
    });

    return NextResponse.json({
      success: true,
      terminalUrl,
      status: info,
      username: session!.username,
    });
  } catch (err: unknown) {
    invalidateUserSandboxCache(userId);
    const message = err instanceof Error ? err.message : "Failed to initialize sandbox.";
    console.error("[api/sandbox] Error:", err);
    return NextResponse.json(
      { error: "Sandbox error", message },
      { status: 500 }
    );
  }
}
