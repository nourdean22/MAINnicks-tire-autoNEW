/**
 * POST /api/projects/backfill-tasks — bulk-spawn NOW tasks from every
 * project plan that has un-spawned phases.
 *
 * Phase SS.4 (2026-05-19 AM) · heavy lifting moved to
 * `lib/services/backfill-tasks.backfillProjectTasks` so both this REST
 * endpoint AND the new `trpc.task.backfill` mutation call the same
 * function · drift between consumers structurally impossible.
 *
 * Body (optional): { firstPhaseOnly?: boolean } · default true
 *
 * v10.0.119 audit-pattern fix · owner-gated · this endpoint scans
 * every project plan and creates tasks · anonymous trigger = mass
 * task spam.
 */
import { apiHandler } from "@/lib/utils/http";
import { backfillProjectTasks } from "@/lib/services/backfill-tasks";

export const dynamic = "force-dynamic";

interface BackfillBody {
  firstPhaseOnly?: boolean;
}

export const POST = apiHandler(async (req) => {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as BackfillBody;
  return backfillProjectTasks({ firstPhaseOnly: body.firstPhaseOnly });
}, { auth: "owner" });
