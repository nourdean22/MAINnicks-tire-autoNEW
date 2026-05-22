/**
 * GET  /api/decisions/[id] · v10.0.221 · single-decision detail.
 * POST /api/decisions/[id] · grade + edit a single decision.
 *
 * Powers the /decisions/[id] detail page. Returns the full
 * MasteryDecision row plus a small lineage block:
 *   · sibling decisions in the same domain (last 5)
 *   · candidate anti-patterns whose tags overlap the decision's domain
 *   · time-since-creation + days-to-review countdown
 *
 * misc-pages slice (2026-05-22 · legacy-modernizer REST→tRPC) · the
 * GET assembly + the POST grade-update moved to the shared
 * `lib/services/decision-detail` module the `operator.decisionDetail`
 * / `operator.gradeDecision` tRPC procedures also call · drift
 * structurally impossible. The route stays mounted as the rollback
 * path.
 *
 * Auth: owner only.
 */
import { apiHandler } from "@/lib/utils/http";
import {
  getDecisionDetail,
  gradeDecision,
} from "@/lib/services/decision-detail";

export const GET = apiHandler(
  async (_req, ctx) => {
    const params = (await ctx.params) ?? {};
    return getDecisionDetail(Number(params.id));
  },
  { auth: "owner" },
);

/** Same shape as the legacy /api/decisions POST grade action — kept
 *  here so the detail page can submit without a roundabout. */
export const POST = apiHandler(
  async (req, ctx) => {
    const params = (await ctx.params) ?? {};
    const body = (await req.json().catch(() => ({}))) as {
      actualOutcome?: string;
      grade?: string;
      reviewDate?: string;
    };
    return gradeDecision(Number(params.id), body);
  },
  { auth: "owner" },
);
