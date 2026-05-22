/**
 * POST /api/system/decision-replays/[id]/mark · v10.0.529.7 · extended v529.27
 *
 * Operator-only mark for a queued decision-replay row. Two modes ·
 * the body decides which one fires:
 *
 *   1. EMPTY body (legacy · v529.7 behavior)
 *      Stamps the BrainMemory row (category=decision_replay_due) with
 *      metadata.consumedAt so the decision-replay tile drops it from
 *      the unconsumed list and the next morning brief doesn't repeat.
 *      Used by the "tap-to-chat" row-click flow · operator goes to
 *      /chat to actually process the replay, the row drops from HQ
 *      immediately.
 *
 *   2. BODY { outcome, outcomeScore?, lesson? } (v529.27 · Arc B 1B)
 *      In addition to stamping consumedAt · ALSO calls
 *      decision-replay-coach.markReplayed() which writes the actual
 *      DecisionReplay row (outcome + score + lesson) + creates a
 *      BrainMemory(category="decision_replay_outcome") so future
 *      recall can pull the lesson forward into similar decisions.
 *      Used by the inline lesson form on the DecisionReplayCard ·
 *      operator logs the lesson without leaving /ultron.
 *
 * Idempotent in both modes · re-marking just overwrites the timestamp
 * and re-upserts the DecisionReplay row (markReplayed uses an
 * idempotencyKey of `decision_<id>_30d`). decisionId comes from the
 * BrainMemory.metadata blob the cron stamps · without it we can't
 * resolve the linked MasteryDecision so we fall back to legacy mode.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
// Phase B.6c · the dual-mode mark logic moved to a shared service so
// the legacy REST route AND the tRPC `system.markDecisionReplay`
// procedure call the same function · drift impossible. The body schema
// is the SHARED validator the tRPC procedure also imports.
import { markDecisionReplay } from "@/lib/services/decision-replays";
import { decisionReplayMarkSchema } from "@/lib/validators/system";

export const POST = apiHandler(
  async (req, ctx) => {
    const params = await ctx.params;
    const id = params?.id;
    if (!id || typeof id !== "string") {
      throw new ServiceError("id required", 400);
    }

    // Best-effort body parse · the route is backward-compatible with:
    //   · no body                → legacy consumedAt-only flow
    //   · valid lesson body      → mark + markReplayed dual write
    //   · invalid lesson body    → 400 (be strict when something IS sent
    //                              so silent malformed posts don't drop
    //                              the lesson on the floor)
    let body: import("@/lib/validators/system").DecisionReplayMarkInput = {};
    let bodyWasSent = false;
    try {
      const text = await req.text();
      if (text.trim().length > 0) {
        bodyWasSent = true;
        const parsedJson = JSON.parse(text);
        const parsed = decisionReplayMarkSchema.safeParse(parsedJson);
        if (!parsed.success) {
          throw new ServiceError("invalid_lesson_body", 400);
        }
        body = parsed.data;
      }
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      if (bodyWasSent) {
        throw new ServiceError("invalid_json_body", 400);
      }
    }

    // `markDecisionReplay` throws ServiceError(404 / 400 / 500) on a
    // missing row / wrong category / failed update — apiHandler maps it.
    return markDecisionReplay({
      id,
      outcome: body.outcome,
      outcomeScore: body.outcomeScore,
      lesson: body.lesson,
    });
  },
  { auth: "owner" },
);
