/**
 * Experiments router — which registered web experiments are currently ARMED.
 *
 * Public because the storefront reads it on every home load; cached 60s
 * because the answer is a flag lookup. Returns ids only — arm copy ships in
 * the client bundle from shared/webExperiments.ts, so nothing here can
 * become a second source of truth for what the arms say.
 */
import { router, publicProcedure } from "../_core/trpc";

export const experimentsRouter = router({
  active: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("experiments:active", 60, async () => {
      const { armedWebExperimentIds } = await import("../services/webExperimentFlags");
      return { active: await armedWebExperimentIds() };
    });
  }),
});
