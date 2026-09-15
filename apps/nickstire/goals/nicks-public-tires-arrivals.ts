import type { GoalContract } from "../shared/goalContract";

/**
 * Frozen 2026-09-15. Editing this file is an EVALUATOR change
 * (config/agent-os/evaluator-paths.json) — never in the same PR as a
 * candidate that wants to be judged by it.
 */
export const NICKS_PUBLIC_TIRES_ARRIVALS: GoalContract = {
  goalId: "nicks-public-tires-arrivals",
  product: "nicks-public",
  surfaces: ["/", "/tires"],
  desiredOutcome:
    "More tire customers physically arrive at Nick's from the public site: a visitor who lands with tire intent finds a believable installed price and the fastest path to the shop.",
  truthSources: [
    "shared/business.ts (BUSINESS canon: hours, phone, pricing bands)",
    "shopCapacity (bookings + work_orders mirror; never live ALG)",
    "ShopState (server-derived, unknown on any stale input)",
  ],
  protectedInvariants: [
    "never fabricate inventory or imply a tire is in stock",
    "never fabricate a wait time or bay count; unknown renders as unknown",
    "never imply a reservation or an appointment — the shop is first come, first served",
    "prices come from BUSINESS canon; used-tire copy stays two-tier by design",
    "EUCLID GRIT tone stays intact: physical, dense proof, no SaaS chrome",
    "no per-visitor personalisation from camera or customer data",
  ],
  mutationAxes: ["hero primary-lane subline", "installed-price hierarchy on /tires", "trust/proof density above the fold"],
  primaryMetric: "page_cta_primary_clicked",
  guardrails: ["phone_number_clicked", "page_cta_secondary_clicked", "form_abandoned"],
  minimumEvidence: "randomized",
  killCriteria: [
    "phone taps fall significantly while the primary metric rises",
    "any copy fails lint:brand-voice or contradicts a truth source",
    "LCP on / or /tires regresses past the Lighthouse budget",
  ],
  rollbackPlan: "Flip the experiment flag off (control renders, logging stops) and revert the PR; no data migration is involved.",
  frozenAt: "2026-09-15T00:00:00.000Z",
};
