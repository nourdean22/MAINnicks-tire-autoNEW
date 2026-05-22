/**
 * POST /api/brain/reset — nuke ALL brain-learning state.
 *
 * Wipes:
 *   chat_importance, chat_summary, skill, skill_pending,
 *   identity_snapshot (current + history), qualitative_identity
 *   (current + history), ghost_prediction (current + dismissals),
 *   ghost_accuracy, contradiction, belief, belief_candidate,
 *   brain_dump_importance
 *
 * Owner-auth. Intended for debugging / fresh start. Cannot be undone.
 * The UI confirms twice (confirm + prompt) before hitting this.
 *
 * Phase B.6d (2026-05-22 · legacy-modernizer REST→tRPC brain slice) ·
 * the inline deleteMany moved to `lib/services/brain-domain.resetBrainState`
 * so this route AND the new `trpc.brain.reset` procedure call the same
 * function · the destructive category set never drifts between transports.
 */
import { apiHandler } from "@/lib/utils/http";
import { resetBrainState } from "@/lib/services/brain-domain";

export const POST = apiHandler(
  async () => {
    return resetBrainState();
  },
  { auth: "owner" },
);
