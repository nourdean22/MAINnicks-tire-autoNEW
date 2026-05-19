/**
 * POST /api/tasks/[id]/start — start the DOING timer on a task.
 *
 * Sets status = DOING and startedAt = now. Paired with the
 * existing POST /api/tasks/[id]/check which computes the time
 * diff and bumps actualMinutes when the task gets completed.
 *
 * Idempotent: if the task is already DOING, updates startedAt
 * only if it's null (so a stale timer gets refreshed).
 *
 * Phase RR (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/task-actions.startTask` so both this REST endpoint
 * AND the new `trpc.task.start` mutation call the same function ·
 * drift between consumers structurally impossible.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { startTask } from "@/lib/services/task-actions";
import { ServiceError } from "@/lib/utils/service-error";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireSession(req);
  const { id } = await params;
  try {
    return NextResponse.json(await startTask(id));
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
