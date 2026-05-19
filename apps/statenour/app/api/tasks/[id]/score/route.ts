/**
 * POST /api/tasks/[id]/score · Wave 26 (v10.0.529.82) · C3
 *
 * Lightweight AI-fill for tasks whose roiScore is the default 50.
 * The quick-add path hardcodes roiScore=50 (the operator doesn't
 * grade urgency every time) which means the urgency sort is
 * effectively random for new untagged tasks.
 *
 * Phase SS.2 (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/task-actions.scoreTaskWithAI` so both this REST
 * endpoint AND the new `trpc.task.score` mutation call the same
 * function · drift between consumers structurally impossible.
 *
 * Body: { force?: boolean }
 *   force=true · update roiScore even when operator has graded it.
 */
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { scoreTaskWithAI } from "@/lib/services/task-actions";

export const dynamic = "force-dynamic";

export const POST = apiHandler(
  async (req, { params }) => {
    const { id } = await params!;
    const body = (await readRequestJson(req).catch(() => ({}))) as { force?: boolean };
    return scoreTaskWithAI({ id, force: body.force });
  },
  { auth: "owner" },
);
