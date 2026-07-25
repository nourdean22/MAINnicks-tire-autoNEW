/**
 * GET /api/system/deploy-info — current deployment identity.
 *
 * AUTH REALITY (2026-07-25 doc correction): this route is NOT public.
 * It is not listed in lib/security/route-policy.ts PUBLIC_EXACT, so the
 * NextAuth middleware wall answers 401 to anonymous callers — verified
 * live against bdnick.info. The old "// public: …" note here dated from
 * the Vercel era, when "/" itself was public and an unauthenticated HQ
 * chip read this endpoint; the truth-substrate P0 wave (2026-07-21)
 * closed that surface, and every consumer (deploy chip, smoke with
 * SMOKE_SESSION_COOKIE) now carries a session. If you ever intend to
 * re-open it, that is a route-policy decision — make it in
 * lib/security/route-policy.ts, not here.
 *
 * Identity comes from the canonical getDeployMeta() (Railway-first,
 * Vercel fallback). Build time is the best approximation of "deployed
 * at" — stamped via the BUILD_TIME env that next.config.ts sets.
 *
 * Used by the HQ deployment chip (components/ultron/deploy-chip.tsx)
 * so Nour can see at a glance which SHA is live and how long ago it
 * deployed.
 */

import { NextResponse } from "next/server";
// Phase B.6c · the env-var read moved to a shared service so the
// legacy REST route AND the tRPC `system.deployInfo` procedure call the
// same function · drift impossible.
import { buildDeployInfo } from "@/lib/services/deploy-info";

export async function GET() {
  return NextResponse.json({ data: buildDeployInfo() });
}
