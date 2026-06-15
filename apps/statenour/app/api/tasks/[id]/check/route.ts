/**
 * POST /api/tasks/[id]/check — unified loop completion endpoint.
 *
 * Handles all three kinds from the Loops unification:
 *
 *   ONCE    → status = DONE
 *   PROMISE → status = DONE (success) or ARCHIVED (broken, via action=break)
 *   DAILY   → lastCompletedAt = now, streakCount bumped
 *             Status stays READY so the loop keeps reappearing.
 *             Streak resets to 1 if the gap since last check > 1 day.
 *
 * Body: { action?: "complete" | "break" }
 *
 * Phase RR (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/task-actions.checkTask` so both this REST endpoint
 * AND the new `trpc.task.check` mutation call the same function ·
 * drift between consumers structurally impossible.
 */
import { apiHandler } from "@/lib/utils/http";
import { checkTask } from "@/lib/services/task-actions";

export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    completionNote?: string | null;
    outcomeScore?: number | null;
  };
  return checkTask({
    id,
    action: body.action,
    completionNote: body.completionNote,
    outcomeScore: body.outcomeScore,
  });
}, { auth: "owner" });
