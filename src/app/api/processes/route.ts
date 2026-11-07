/**
 * GET  /api/processes       — List user's managed processes
 * POST /api/processes       — Register a new managed process
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/security";
import {
  listManagedProcesses,
  registerManagedProcess,
  startManagedProcess,
} from "@/lib/sandbox";
import { sanitizeString } from "@/lib/security";

export async function GET(req: NextRequest) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  const processes = await listManagedProcesses(session!.userId);
  return NextResponse.json({ processes });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  let body: {
    name?: string;
    command?: string;
    workingDir?: string;
    restartPolicy?: string;
    maxFailures?: number;
    isInteractive?: boolean;
    autoStart?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = sanitizeString(String(body.name || ""), 64);
  const command = String(body.command || "").trim();
  const workingDir = sanitizeString(String(body.workingDir || "/root"), 256);
  const restartPolicy = ["always", "on-failure", "never"].includes(
    String(body.restartPolicy)
  )
    ? (String(body.restartPolicy) as "always" | "on-failure" | "never")
    : "on-failure";
  const maxFailures = Math.min(Math.max(Number(body.maxFailures ?? 5), 1), 20);
  const isInteractive = Boolean(body.isInteractive);

  if (!name) {
    return NextResponse.json({ error: "Process name is required" }, { status: 400 });
  }
  if (!command) {
    return NextResponse.json({ error: "Command is required" }, { status: 400 });
  }
  if (command.length > 2000) {
    return NextResponse.json({ error: "Command too long (max 2000 chars)" }, { status: 400 });
  }

  try {
    const processId = await registerManagedProcess(session!.userId, {
      name,
      command,
      workingDir,
      restartPolicy,
      maxFailures,
      isInteractive,
    });

    // Optionally auto-start
    if (body.autoStart && !isInteractive) {
      await startManagedProcess(session!.userId, processId);
    }

    return NextResponse.json({ success: true, processId }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register process";
    console.error("[api/processes] Error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
