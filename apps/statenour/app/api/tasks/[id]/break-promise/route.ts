/**
 * POST /api/tasks/[id]/break-promise
 *
 * Called when Nour marks a PROMISE loop as broken AFTER providing
 * a reason in the modal. Does three things:
 *
 *   1. Archives the task (status → ARCHIVED)
 *   2. Writes a BrainMemory promise_break row with the reason
 *   3. Pattern-tags the reason via a cheap keyword match so Nick
 *      can reference failure patterns later (overcommitted,
 *      low-energy, forgot, external-blocker, etc)
 *
 * Body: { reason: string }
 *
 * Phase RR (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/task-actions.breakPromise` so both this REST endpoint
 * AND the new `trpc.task.breakPromise` mutation call the same function
 * · drift between consumers structurally impossible.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { breakPromise, WrongLoopKindError } from "@/lib/services/task-actions";
import { ServiceError } from "@/lib/utils/service-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  try {
    return NextResponse.json(await breakPromise({ id, reason: body.reason }));
  } catch (err) {
    if (err instanceof WrongLoopKindError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
