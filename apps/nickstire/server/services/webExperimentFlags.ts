/**
 * The flag that arms each registered web experiment — as LITERALS, on purpose.
 *
 * `webExperimentFlagKey()` derives the key by convention, but a key that only
 * ever exists as a computed string has no reader anyone can grep for, and
 * server/featureFlagReaders.test.ts rightly treats a flag nobody visibly reads
 * as orphaned. This table is the visible reader; the test beside it proves each
 * literal equals the convention and that every registered experiment has one.
 */
import { WEB_EXPERIMENTS } from "@shared/webExperiments";
import type { FlagKey } from "./featureFlags";

export const WEB_EXPERIMENT_FLAGS = {
  "home-hero-subline-2026-09": "web_experiment_home_hero_subline_2026_09",
} as const satisfies Record<string, FlagKey>;

/** Experiment ids whose flag is currently ON. Fails closed on any flag-read failure. */
export async function armedWebExperimentIds(): Promise<string[]> {
  const { isEnabled } = await import("./featureFlags");
  const armed: string[] = [];
  for (const e of WEB_EXPERIMENTS) {
    const flag = WEB_EXPERIMENT_FLAGS[e.experimentId as keyof typeof WEB_EXPERIMENT_FLAGS];
    if (!flag) continue; // no literal flag = not armable; the test makes this unreachable
    if (await isEnabled(flag)) armed.push(e.experimentId);
  }
  return armed;
}
