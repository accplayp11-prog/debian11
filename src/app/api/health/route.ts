/**
 * GET /api/health
 * Public health check endpoint (no auth required).
 */

import { NextRequest, NextResponse } from "next/server";
import { getTursoClient } from "@/lib/turso";

export async function GET(_req: NextRequest) {
  const checks: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  };

  // Check Turso connectivity
  try {
    const db = getTursoClient();
    await db.execute("SELECT 1");
    checks.database = "ok";
  } catch (err) {
    checks.database = "error";
    checks.databaseError =
      err instanceof Error ? err.message : "Unknown error";
    checks.status = "degraded";
  }

  const statusCode = checks.status === "ok" ? 200 : 503;
  return NextResponse.json(checks, { status: statusCode });
}
