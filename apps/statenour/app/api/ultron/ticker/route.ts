// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { buildTickerFeed } from "@/lib/services/ultron-ticker";

/**
 * GET /api/ultron/ticker
 *
 * Ambient awareness feed for the Ultron top strip. Pulls personal
 * timelines + markets + macro headlines + shop pulse + brain pulse +
 * self metrics + ops, interleaved so the operator's own intelligence
 * surfaces alongside world data.
 *
 * Phase B.6a (2026-05-22) · the feed composer was extracted into
 * `lib/services/ultron-ticker.ts` (buildTickerFeed) so the new
 * `operator.ticker` tRPC procedure calls the SAME function · drift
 * impossible. This route stays mounted as the rollback path. The
 * `cached()` wrapper lives inside `buildTickerFeed` so both
 * transports share the 60s window.
 */

export const revalidate = 300;

export async function GET() {
  try {
    const payload = await buildTickerFeed();
    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          items: [],
          generatedAt: new Date().toISOString(),
          softError: String(err),
        },
      },
      { status: 200 },
    );
  }
}
