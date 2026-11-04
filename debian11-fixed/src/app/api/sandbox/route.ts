/**
 * GET /api/sandbox   — Get sandbox status and terminal URL
 * POST /api/sandbox  — Initialize / wake up the shared sandbox
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/security";
import {
  getOrCreateSharedSandbox,
  getTerminalHttpUrl,
  getSandboxStatus,
  invalidateSandboxCache,
} from "@/lib/sandbox";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  const status = await getSandboxStatus();

  return NextResponse.json({
    status,
    username: session!.username,
  });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  try {
    // This call is idempotent — safe to call even if sandbox is already running
    await getOrCreateSharedSandbox();
    const terminalUrl = await getTerminalHttpUrl();
    const status = await getSandboxStatus();

    return NextResponse.json({
      success: true,
      terminalUrl,
      status,
      username: session!.username,
    });
  } catch (err: unknown) {
    // Invalidate cache so next request tries again
    invalidateSandboxCache();

    const message =
      err instanceof Error ? err.message : "Failed to initialize sandbox.";
    console.error("[api/sandbox] Error:", err);

    return NextResponse.json(
      { error: "Sandbox error", message },
      { status: 500 }
    );
  }
}
