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
 * Security posture: identical to the regular session endpoint — same
 * AUTH_SECRET decrypts the same JWT cookie. We just don't run any of
 * the unrelated handler chain. If the JWT is missing/expired/tampered,
 * we return { expires: null } and the banner stays silent.
 */

import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export const runtime = "edge";
// Don't cache — every poll needs the actual JWT exp claim. The Vary
// on cookie header keeps any upstream proxies from cross-bleeding
// sessions even if they ignore the no-store directive.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // No secret configured (mock mode / dev) — banner won't render anyway.
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ expires: null });
  }

  try {
    const token = await getToken({
      req: req as Parameters<typeof getToken>[0]["req"],
      secret: process.env.AUTH_SECRET,
      // secureCookie defaults to NEXTAUTH_URL.startsWith("https"); we
      // let it auto-detect. Same as the catchall.
    });

    // token.exp is unix seconds. Convert to ISO string to match the
    // shape that /api/auth/session emits (banner already parses ISO).
    if (!token || typeof token.exp !== "number") {
      return NextResponse.json({ expires: null });
    }

    return NextResponse.json(
      { expires: new Date(token.exp * 1000).toISOString() },
      {
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      },
    );
  } catch {
    // Decryption failure (rotated secret, tampered cookie) → banner
    // silent. Real 401 enforcement is in middleware, not here.
    return NextResponse.json({ expires: null });
  }
}
