/**
 * GET /api/brain/identity-projection — Wave 60 trajectory exposure.
 *
 * v10.0.529.106 · Wave 72.
 *
 * Wave 60 added projectIdentityForward() · pure least-squares linear
 * regression on the last 14 history rows per axis. Returns:
 *   { axis, currentValue, projectedValue30d, delta30d, slopePerDay,
 *     rSquared, warning }
 *
 * This endpoint exposes that to the operator UI surface. Used by the
 * /brain/identity panel (to be added · for now any consumer can
 * fetch + render).
 *
 * Query params:
 *   ?days=N · projection horizon · default 30 · clamped [7, 90]
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { projectIdentityForward } from "@/lib/brain/identity-snapshot";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await requireSession(req);
  const { searchParams } = new URL(req.url);
  const rawDays = parseInt(searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(rawDays) ? Math.max(7, Math.min(90, rawDays)) : 30;

  const projection = await projectIdentityForward(days);

  // Sort trajectories: warnings first (so the operator sees red/amber
  // up top), then by absolute delta30d (biggest movement next).
  const sorted = [...projection.trajectories].sort((a, b) => {
    const aWarn = a.warning ? 1 : 0;
    const bWarn = b.warning ? 1 : 0;
    if (aWarn !== bWarn) return bWarn - aWarn;
    return Math.abs(b.delta30d) - Math.abs(a.delta30d);
  });

  return NextResponse.json({
    ...projection,
    trajectories: sorted,
  });
}
