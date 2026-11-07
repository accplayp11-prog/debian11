/**
 * POST /api/processes/[id]  — Action on a process (start | stop | delete)
 * DELETE /api/processes/[id] — Delete a process
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/security";
import {
  startManagedProcess,
  stopManagedProcess,
  deleteManagedProcess,
} from "@/lib/sandbox";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  const { id: processId } = await params;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action || "");

  if (action === "start") {
    const result = await startManagedProcess(session!.userId, processId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  }

  if (action === "stop") {
    const result = await stopManagedProcess(session!.userId, processId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    const deleted = await deleteManagedProcess(session!.userId, processId);
    if (!deleted) {
      return NextResponse.json({ error: "Process not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: "Invalid action. Use: start | stop | delete" },
    { status: 400 }
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requireAuth(req);
  if (error) return error;

  const { id: processId } = await params;
  const deleted = await deleteManagedProcess(session!.userId, processId);

  if (!deleted) {
    return NextResponse.json({ error: "Process not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
