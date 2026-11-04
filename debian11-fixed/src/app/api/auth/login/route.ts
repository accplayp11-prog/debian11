/**
 * POST /api/auth/login
 * Authenticate a user and set a session cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  login,
  isRateLimited,
  getClientIp,
  SESSION_COOKIE,
} from "@/lib/auth";
import { sanitizeString } from "@/lib/security";

export async function POST(req: NextRequest) {
  const ipAddress = getClientIp(req);
  const userAgent = req.headers.get("user-agent") || "unknown";

  // Check rate limit before even parsing the body
  if (await isRateLimited(ipAddress)) {
    return NextResponse.json(
      {
        error: "Rate limited",
        message:
          "Too many failed login attempts. Please wait 15 minutes before trying again.",
      },
      { status: 429 }
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Bad request", message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const username = sanitizeString(String(body.username || ""), 64);
  const password = String(body.password || "");

  if (!username || !password) {
    return NextResponse.json(
      { error: "Bad request", message: "Username and password are required." },
      { status: 400 }
    );
  }

  if (password.length > 256) {
    return NextResponse.json(
      { error: "Bad request", message: "Password too long." },
      { status: 400 }
    );
  }

  try {
    const rawToken = await login(username, password, ipAddress, userAgent);

    const response = NextResponse.json(
      { success: true, message: "Login successful." },
      { status: 200 }
    );

    // Set HTTP-only, Secure, SameSite=Strict cookie
    response.cookies.set(SESSION_COOKIE, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 24 * 60 * 60, // 24 hours
    });

    return response;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Authentication failed.";

    return NextResponse.json(
      { error: "Unauthorized", message },
      { status: 401 }
    );
  }
}
