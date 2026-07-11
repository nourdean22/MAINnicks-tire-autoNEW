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
 */

import { cronHandler } from "@/lib/utils/http";
import { computeIdentitySnapshot } from "@/lib/brain/identity-snapshot";

export const maxDuration = 120;

export const GET = cronHandler(async () => {
  const snapshot = await computeIdentitySnapshot();
  return {
    ok: true,
    computedAt: snapshot.computed_at,
    axes: Object.fromEntries(
      Object.entries(snapshot.axes).map(([k, a]) => [k, a.manual ?? a.value]),
    ),
  };
});
