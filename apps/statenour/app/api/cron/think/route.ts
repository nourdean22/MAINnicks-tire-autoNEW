import { cronHandler } from "@/lib/utils/http";
import { detectContradictions, trackIdentityEvolution, analyzeCausalChains, scanEnvironment } from "@/lib/brain/thinking-engine";
export const maxDuration = 60;

/**
 * GET /api/cron/think — The Thinking Engine (Layers 7-12)
 *
 * Runs the brain's higher-order reasoning:
 * L7: Contradiction detection (says vs does)
 * L8: Identity evolution tracking (who is Nour becoming?)
 * L10: Causal chain analysis (why do patterns repeat?)
 * L12: Environmental awareness (external forces)
 *
 * L9 (Simulation) is on-demand only — triggered by Nick AI or user.
 * L11 (People) is populated through interactions, not crons.
 */
export const GET = cronHandler(async () => {
  const [contradictions, identity, causal, environment] = await Promise.allSettled([
    detectContradictions(),
    trackIdentityEvolution(),
    analyzeCausalChains(),
    scanEnvironment(),
  ]);

  return {
    L7_contradictions: contradictions.status === "fulfilled" ? contradictions.value : { error: "failed" },
    L8_identity: identity.status === "fulfilled" ? identity.value : { error: "failed" },
    L10_causal: causal.status === "fulfilled" ? causal.value : { error: "failed" },
    L12_environment: environment.status === "fulfilled" ? environment.value : { error: "failed" },
  };
});
