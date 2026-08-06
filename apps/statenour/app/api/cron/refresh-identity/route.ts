/**
 * GET /api/cron/refresh-identity · resurrected 2026-07-11.
 *
 * Rolls the 8-axis identity snapshot forward (BrainMemory
 * category="identity_snapshot" key="current" + daily history row).
 *
 * HISTORY · the original route was deleted in the Wave-AE cron prune
 * (2026-05-28, 107→35 routes) but — unlike autonomous-engine, which was
 * resurrected 2026-06-02 — it was never re-wired. From then on NOTHING
 * scheduled called computeIdentitySnapshot: the only refresh paths were
 * the manual /api/identity?refresh=true and the operator tRPC procedure.
 * Prod froze at the last manual refresh (2026-07-05) and every consumer
 * (cross-system nudges → pulse ticker "social battery 20", chat context,
 * ghost/drift engines) served week-old axes as if current.
 *
 * Wired into EVENING_JOBS (lib/inngest/jobs.ts) — the identity docstring's
 * original 04:30 daily intent maps fine to the nightly fan-out; the axes
 * read 14-30d windows, so intra-day drift is immaterial.
 *
 * 2026-08-06 · THE 2026-07-11 RESURRECTION WAS PARTIAL. The pre-prune route
 * ran FOUR producers; only computeIdentitySnapshot came back. Its three
 * siblings were dropped silently and stayed dormant for another 26 days:
 *
 *   computeQualitativeIdentity()  RESTORED below — nothing scheduled has
 *     recomputed it since 2026-05-28. Its only remaining callers are the
 *     manual /api/identity/qualitative route and an operator tRPC procedure,
 *     so the qualitative-identity row has been FROZEN and every chat turn has
 *     been served that stale snapshot as if current. NOTE: this genuinely
 *     changes what the model sees — it un-freezes a block that has been
 *     constant for ~10 weeks. That is the correct behaviour (the block exists
 *     to reflect current identity) but it is a behaviour change, not a
 *     no-op. Manual entries survive the recompute.
 *
 *   harvestBeliefs()  RESTORED below — this is why `belief_candidate` sits at
 *     0 rows in prod, and therefore why `belief` does too and the /chat
 *     "beliefs" context block has fired 0 times in 1,417 measured turns. The
 *     harvester had live callers, but all of them are MANUAL (the BeliefsPanel
 *     button, POST /api/beliefs, the chat action sheet) and none had ever been
 *     used. With no candidates there is nothing to promote, so the downstream
 *     block can never fill.
 *
 *   runDecay()  DELIBERATELY NOT RESTORED. Checked before assuming: expired
 *     rows are already reaped nightly by /api/cron/data-cleanup (route.ts:57,
 *     `expiresAt: { lt: new Date() }`), which IS in EVENING_JOBS. Prod agrees —
 *     only 41 live-but-expired rows, none older than today. Re-adding it here
 *     would double-run the same sweep for no gain.
 *
 * All three run in parallel with, and independently of, the snapshot: each
 * catches to null so one failing producer cannot take down the others or the
 * cron. That is the original route's contract, preserved.
 */

import { cronHandler } from "@/lib/utils/http";
import { computeIdentitySnapshot } from "@/lib/brain/identity-snapshot";
import { computeQualitativeIdentity } from "@/lib/brain/qualitative-identity";
import { harvestBeliefs } from "@/lib/brain/belief-harvester";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const snapshot = await computeIdentitySnapshot();

  // Restored siblings · parallel + individually fail-soft, matching the
  // pre-prune route. A thrown harvester must not cost us the identity roll.
  const [qualitative, beliefs] = await Promise.all([
    computeQualitativeIdentity().catch((): null => null),
    harvestBeliefs().catch((): null => null),
  ]);

  return {
    ok: true,
    computedAt: snapshot.computed_at,
    axes: Object.fromEntries(
      Object.entries(snapshot.axes).map(([k, a]) => [k, a.manual ?? a.value]),
    ),
    // Surfaced so a run that silently produced nothing is visible in the cron
    // result rather than having to be inferred from row counts later.
    qualitativeRefreshed: qualitative !== null,
    beliefsHarvested: beliefs,
  };
});
