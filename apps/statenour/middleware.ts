import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { generateNonce, buildCsp } from "@/lib/security/csp";
import { isPublic } from "@/lib/security/route-policy";

/**
 * Global auth middleware (Karpathy-Mode Hardened)
 *
 * Absolute security boundaries. Routes NOT requiring auth are explicitly whitelisted.
 * Fail-open bypasses are strictly constrained to non-production environments.
 *
 * audit-2026-06-21 · also the single source of the Content-Security-Policy.
 * A per-request nonce is generated here and threaded onto EVERY response so
 * the browser always receives a CSP header; in production script-src is
 * nonce + 'strict-dynamic' (no unsafe-inline / unsafe-eval). CSP was removed
 * from next.config.ts — two CSP sources would make the browser enforce their
 * intersection and silently break the nonce model. See lib/security/csp.ts.
 */

// Public-route policy (PUBLIC_PREFIXES / PUBLIC_EXACT / isPublic) extracted to
// lib/security/route-policy.ts so the security boundary is unit-testable without
// the NextAuth runtime. truth-substrate audit P0 (2026-07-21).

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // ── CSP · per-request nonce (audit-2026-06-21) ──────────────────────────
  // Built once per request and attached to every response below. The nonce
  // also rides the REQUEST headers so the Next renderer stamps it on its
  // framework <script> tags (required for 'strict-dynamic' hydration).
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = generateNonce();
  const csp = buildCsp(nonce, isDev);

  /** Pass-through that carries the nonce to the renderer + CSP to the browser. */
  const allow = () => {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  /** Attach CSP to a terminal (redirect / json) response. */
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };

  // Allow public routes
  if (isPublic(pathname)) return allow();

  // Allow static files
  if (pathname.includes(".") && !pathname.startsWith("/api/")) return allow();

  // Absolute Security Bounds: Fail-Closed Architecture
  // Pre-v10.1, a missing AUTH_SECRET in production would gracefully fail OPEN
  // granting global unauthenticated access. This enforces a strict fail-closed state.
  const hasAuth = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET);

  if (isDev) {
    const forceMock = process.env.AUTH_FORCE_MOCK === "1" || process.env.AUTH_FORCE_MOCK?.toLowerCase() === "true";
    if (!hasAuth || forceMock || process.env.LOCAL_DEV_BYPASS_AUTH === "1") {
      return allow();
    }
  } else if (!hasAuth) {
    // Production & Missing Auth Credentials -> Total Lockdown
    return withCsp(
      NextResponse.json(
        { error: "SYSTEM LOCKED: Critical authorization configuration missing." },
        { status: 500 }
      )
    );
  }

  // Check session
  if (!req.auth?.user?.email) {
    // API routes get 401, pages get redirected to sign-in
    if (pathname.startsWith("/api/")) {
      return withCsp(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const signInUrl = new URL("/auth/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return withCsp(NextResponse.redirect(signInUrl));
  }

  return allow();
});

export const config = {
  matcher: [
    // Match all paths except static files and _next.
    // code-review 2026-07-09 · the extension exclusion is END-ANCHORED ($)
    // so ONLY paths that actually END in an asset extension are skipped.
    // Without the anchor, any path merely CONTAINING ".png"/".js"/etc.
    // mid-path (e.g. /api/relationships/x.png/laws) skipped auth + CSP.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)",
  ],
};
