/**
 * POST /api/auth/logout
 * Invalidate the current session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest, logout, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await getSessionFromRequest(req);

  if (token && session) {
    await logout(token, session.userId);
  }

  const response = NextResponse.json(
    { success: true, message: "Logged out successfully." },
    { status: 200 }
  );

  // Clear the session cookie
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
