// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { buildSituation } from "@/lib/services/ultron-situation";

/**
 * GET /api/ultron/situation
 *
 * THE unified signal endpoint. Replaces the 7-card stack on HQ with a
 * single synthesized narrative. A META-aggregator composing blind
 * spots · narrator voices · bets · calibration · contradictions ·
 * persona-drift · ghost · agent health · brain-growth · momentum.
 *
 * Phase B.6a (2026-05-22) · the synthesizer body was extracted into
 * `lib/services/ultron-situation.ts` (buildSituation) so the new
 * `operator.situation` tRPC procedure calls the SAME function · drift
 * impossible. This route stays mounted as the rollback path. The
 * `cached()` wrapper lives inside `buildSituation` so both transports
 * share the 120s window.
 */

export const revalidate = 120;

export async function GET() {
  try {
    const payload = await buildSituation();
    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "situation build failed",
        code: "SITUATION_BUILD_FAILED",
        data: {
          primary: null,
          secondaries: [],
          autoResolved: [],
          monitors: [],
          counts: {
            blindSpots: 0,
            activeBets: 0,
            agingBeliefs: 0,
            stalePins: 0,
            openRuminations: 0,
            reflectionsToday: 0,
          },
          noiseReduced: 0,
          generatedAt: new Date().toISOString(),
        },
      },
      { status: 500 },
    );
  }
}
