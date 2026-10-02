/**
 * GET /api/cron/think · resurrected 2026-10-02.
 *
 * Runs the thinking engine's three WRITING layers (lib/brain/thinking-engine.ts):
 *
 *   detectContradictions()   L7  -> `contradictions`
 *   trackIdentityEvolution() L8  -> `identity_snapshots` (one row per day)
 *   analyzeCausalChains()    L10 -> `causal_chains`
 *
 * HISTORY · the route that called these was deleted in the Wave-AE cron prune
 * (2026-05-28) and, like refresh-identity and distill-sessions, never re-wired.
 * The 2026-10-02 connection census found all three tables frozen since that
 * date while their readers kept serving the last rows as current: the brain
 * router's identityDelta, the pipeline controller's causal-chain context, and
 * learning-velocity's contradiction counts. (identityDelta and the causal-chain
 * context now age-gate their input, so a future freeze there degrades to "no
 * data" rather than stale data.)
 *
 * ORDER · contradictions run first because both later layers read the
 * `contradictions` table as input; the other two are independent and run in
 * parallel. Each layer is fail-soft (`.catch -> null`), the pre-prune contract:
 * one failed model call must not cost the other layers.
 *
 * NOT RUN · scanEnvironment() (L12) writes nothing — its model was removed and
 * its shop inputs are empty shims — so calling it would spend a model call on
 * output that is discarded.
 *
 * COST · three "reason"-lane calls per night on the flat Ollama subscription.
 * Wall time can exceed the fan-out's 90s child abort, so the path is in
 * mega-fanout's DETACHED_CHILDREN: an aborted-then-retried child would re-run
 * the whole engine and duplicate rows.
 */

import { cronHandler } from "@/lib/utils/http";
import {
  detectContradictions,
  trackIdentityEvolution,
  analyzeCausalChains,
} from "@/lib/brain/thinking-engine";

export const maxDuration = 300;

export const GET = cronHandler(async () => {
  const contradictions = await detectContradictions().catch((): null => null);

  const [identity, causal] = await Promise.all([
    trackIdentityEvolution().catch((): null => null),
    analyzeCausalChains().catch((): null => null),
  ]);

  return {
    ok: true,
    // null = the layer threw; a zero count = it ran and found nothing.
    contradictionsFound: contradictions?.found ?? null,
    identityTracked: identity?.tracked ?? null,
    causalChains: causal?.chains ?? null,
  };
});
