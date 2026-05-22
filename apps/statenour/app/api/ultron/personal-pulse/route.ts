// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { buildPersonalPulse } from "@/lib/services/personal-pulse";

/**
 * GET /api/ultron/personal-pulse
 *
 * The personal ticker counterpart to the top markets ticker. Feeds a
 * BOTTOM ticker that rotates PERSONAL state (capture · MIT · tomorrow
 * note · narrator · commitments · reflection · wins · contradictions
 * · mind · life · wisdom). Returns [] when nothing notable.
 *
 * Phase B.6a (2026-05-22) · the pulse composer was extracted into
 * `lib/services/personal-pulse.ts` (buildPersonalPulse) so the new
 * `operator.personalPulse` tRPC procedure calls the SAME function ·
 * drift impossible. This route stays mounted as the rollback path.
 * The `cached()` wrapper lives inside `buildPersonalPulse` so both
 * transports share the 90s window.
 */

export const revalidate = 90;

export async function GET() {
  try {
    const payload = await buildPersonalPulse();
    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          items: [],
          generatedAt: new Date().toISOString(),
        },
        error: sanitizeError(err),
      },
      { status: 200 },
    );
  }
}
