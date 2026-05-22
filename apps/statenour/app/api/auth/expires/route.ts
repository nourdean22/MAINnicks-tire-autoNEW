/**
 * GET /api/auth/expires — lightweight, edge-safe session expiry probe.
 *
 * The SessionExpiryBanner polls every 30-120s to know when the JWT
 * session is about to expire. Hitting NextAuth's full /api/auth/session
 * endpoint runs the catchall handler in Node — pulling in the Google
 * provider, the full session callback chain, all of NextAuth's
 * middleware. For something as small as "what's the expires field?"
 * that's pure overhead.
 *
 * This route does the minimum work needed:
 *   1. Decode the encrypted JWT cookie via @auth/core/jwt (edge-safe,
 *      uses jose under the hood)
 *   2. Return { expires: ISO_STRING | null }
 *
 * Edge runtime → ~50-150ms cold + ~5-15ms warm. Compared to the Node
 * catchall at ~80-300ms warm + much heavier cold.
 *
 * scattered-components REST→tRPC slice (2026-05-22) · the JWT-exp
 * decode moved to the shared `lib/services/session-expiry.getSessionExpiry`
 * service · this route AND the new `trpc.system.sessionExpiry` procedure
 * call the same function · drift impossible. The route stays mounted as
 * the coexistence / rollback path.
 *
 * Security posture: identical to the regular session endpoint — same
 * AUTH_SECRET decrypts the same JWT cookie. We just don't run any of
 * the unrelated handler chain. If the JWT is missing/expired/tampered,
 * we return { expires: null } and the banner stays silent.
 */

import { NextResponse } from "next/server";
import { getSessionExpiry } from "@/lib/services/session-expiry";

export const runtime = "edge";
// Don't cache — every poll needs the actual JWT exp claim. The Vary
// on cookie header keeps any upstream proxies from cross-bleeding
// sessions even if they ignore the no-store directive.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const result = await getSessionExpiry(req.headers);
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}
