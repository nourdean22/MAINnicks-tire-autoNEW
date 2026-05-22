/**
 * lib/services/session-expiry.ts · scattered-components REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/hud/* slice).
 *
 * The lightweight session-expiry probe · lifted from the GET handler of
 * app/api/auth/expires/route.ts so the legacy REST endpoint AND the new
 * `system.sessionExpiry` tRPC procedure read the SAME JWT-exp logic ·
 * drift between consumers structurally impossible.
 *
 * The probe decodes the encrypted NextAuth JWT cookie and returns just
 * `{ expires }`. It is deliberately a no-throw read — a missing /
 * expired / tampered cookie resolves to `{ expires: null }` and the
 * SessionExpiryBanner stays silent (real 401 enforcement lives in
 * middleware, not here). No Prisma row · the AppRouter stays trivially
 * shallow.
 *
 * `getToken` only needs the request `headers` (it reads the cookie
 * header), so this works equally from the REST route (a fetch Request)
 * and the tRPC context (which already exposes `opts.req.headers`).
 */

import { getToken } from "next-auth/jwt";

/** The session-expiry probe result · ISO string or null. */
export interface SessionExpiry {
  expires: string | null;
}

/**
 * Decode the NextAuth JWT cookie from the request headers and return
 * its `exp` claim as an ISO string. The REST route and the
 * `system.sessionExpiry` procedure both call this. Resolves
 * `{ expires: null }` on any failure (mock mode, missing/rotated
 * secret, tampered cookie) — never throws.
 */
export async function getSessionExpiry(
  headers: Headers,
): Promise<SessionExpiry> {
  // No secret configured (mock mode / dev) — banner won't render anyway.
  if (!process.env.AUTH_SECRET) {
    return { expires: null };
  }

  try {
    const token = await getToken({
      // getToken reads the cookie header off `req.headers` · a bare
      // `{ headers }` object is all it needs (it does not touch the
      // body or any Next.js-specific request fields).
      req: { headers } as Parameters<typeof getToken>[0]["req"],
      secret: process.env.AUTH_SECRET,
      // secureCookie defaults to NEXTAUTH_URL.startsWith("https"); we
      // let it auto-detect, same as the catchall.
    });

    // token.exp is unix seconds. Convert to ISO so it matches the
    // shape /api/auth/session emits (the banner already parses ISO).
    if (!token || typeof token.exp !== "number") {
      return { expires: null };
    }

    return { expires: new Date(token.exp * 1000).toISOString() };
  } catch {
    // Decryption failure (rotated secret, tampered cookie) → banner
    // silent.
    return { expires: null };
  }
}
