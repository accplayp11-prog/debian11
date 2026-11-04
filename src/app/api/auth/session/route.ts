/**
 * GET /api/auth/session
 * Returns current session information.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);

  if (!session) {
    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      username: session.username,
      isAdmin: session.isAdmin,
    },
    expiresAt: session.expiresAt,
  });
}
