/**
 * Web experiment registry — every experiment the public site can run, as
 * code. Code is the pre-registration: the definition is frozen by git, its
 * hash travels with every verdict, and a definition cannot be edited after
 * the fact without a diff someone reviews.
 *
 * A registered experiment is INERT until its feature flag is on
 * (`web_experiment_<id>` in server/services/featureFlags.ts). Off = control
 * renders, nothing is logged. That is the human sign-off: flipping the flag
 * is the decision to expose real customers.
 *
 * Exposure and conversion both land in `customer_events` through the hook
 * the site already uses (useConversionTracking) — no new table, no new
 * pipeline, and the same visitor key every other funnel row carries.
 */
import type { WebExperimentDefinition } from "./experimentKernel";

export const EXPERIMENT_EXPOSURE_EVENT = "experiment_exposure" as const;

/**
 * home-hero-subline · the hero's primary lane sub-copy.
 *
 * Goal contract: goals/nicks-public-tires-arrivals.json (surface "/").
 * One variable: the subline under "Get tires now". The heading, href, order
 * and styling are identical in both arms — findConfoundsIn proves it.
 * Primary: page_cta_primary_clicked on the hero lane. Guardrails: the
 * phone tap and the drop-off tap must not fall — a subline that wins the
 * click by cannibalising the call is not a win.
 */
export const HOME_HERO_SUBLINE: WebExperimentDefinition = {
  experimentId: "home-hero-subline-2026-09",
  primaryVariable: "subline",
  primaryMetric: "page_cta_primary_clicked",
  guardrails: [
    { metric: "phone_number_clicked", direction: "HIGHER_IS_BETTER" },
    { metric: "page_cta_secondary_clicked", direction: "HIGHER_IS_BETTER" },
  ],
  surfaces: ["/"],
  preregisteredAt: "2026-09-15T00:00:00.000Z",
  arms: [
    {
      armId: "control",
      variantValue: "search-price-request",
      heading: "Get tires now",
      href: "/tires",
      subline: "Search your size · see installed prices · request online",
    },
    {
      armId: "variant",
      variantValue: "price-first-fcfs",
      heading: "Get tires now",
      href: "/tires",
      subline: "Installed price up front · first come, first served · request online",
    },
  ],
};

export const WEB_EXPERIMENTS: readonly WebExperimentDefinition[] = [HOME_HERO_SUBLINE];

export function webExperimentById(id: string): WebExperimentDefinition | undefined {
  return WEB_EXPERIMENTS.find((e) => e.experimentId === id);
}

/** Flag key convention. Adding an experiment means adding its flag definition too. */
export function webExperimentFlagKey(experimentId: string): string {
  return `web_experiment_${experimentId.replace(/[^a-z0-9]+/gi, "_")}`;
}
