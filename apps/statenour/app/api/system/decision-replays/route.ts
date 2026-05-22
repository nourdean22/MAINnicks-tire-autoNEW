/**
 * GET /api/system/decision-replays · v10.0.528 · Arc B · Feature 3
 *
 * Owner-gated read for the future Ultron tile. Returns:
 *   · `due` — replay prompts queued by the daily cron, not yet consumed
 *   · `recent` — last 10 reviewed DecisionReplay rows (operator can
 *     audit what they actually answered + the lessons that landed in
 *     BrainMemory)
 *
 * Read-only · no mutation, no AI cost. The cron is the ONLY producer
 * of `decision_replay_due` BrainMemory rows; this surface is purely
 * a reader.
 */

import { apiHandler } from "@/lib/utils/http";
// Phase B.6c · the read assembly moved to a shared service so the
// legacy REST route AND the tRPC `system.decisionReplays` procedure
// call the same function · drift impossible.
import { buildDecisionReplaysView } from "@/lib/services/decision-replays";

export const GET = apiHandler(
  async () => {
    return buildDecisionReplaysView();
  },
  { auth: "owner" },
);
