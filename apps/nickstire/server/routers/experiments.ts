/**
 * Experiments router — which registered web experiments are currently ARMED.
 *
 * Public because the storefront reads it on every home load; cached 60s
 * because the answer is a flag lookup. Returns ids only — arm copy ships in
 * the client bundle from shared/webExperiments.ts, so nothing here can
 * become a second source of truth for what the arms say.
 */
import { router, publicProcedure } from "../_core/trpc";
import { WEB_EXPERIMENTS, webExperimentFlagKey } from "@shared/webExperiments";
import type { FlagKey } from "../services/featureFlags";

export const experimentsRouter = router({
  active: publicProcedure.query(async () => {
    const { cached } = await import("../lib/cache");
    return cached("experiments:active", 60, async () => {
      const { isEnabled } = await import("../services/featureFlags");
      const active: string[] = [];
      for (const e of WEB_EXPERIMENTS) {
        if (await isEnabled(webExperimentFlagKey(e.experimentId) as FlagKey)) active.push(e.experimentId);
      }
      return { active };
    });
  }),
});
