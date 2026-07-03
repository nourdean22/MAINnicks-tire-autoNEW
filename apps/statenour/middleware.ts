import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { generateNonce, buildCsp } from "@/lib/security/csp";

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

const PUBLIC_PREFIXES = [
  "/api/auth",        // NextAuth handlers
  "/api/webhooks",    // External webhook receivers
  "/api/telegram",    // Telegram bot webhook (own chat_id validation)
  "/api/images",      // Generated image serving (public, cached)
  "/api/cron",        // Cron jobs (own CRON_SECRET auth)
  "/api/sync",        // Bridge sync (own Bearer auth)
  "/api/short/",      // Public short-link redirector /api/short/<code> (own 404; logs anonymized clicks). Trailing slash keeps the owner-gated collection route /api/short protected.
  // 2026-05-17 · WAVE-200 Phase 3 follow-up · Inngest serve endpoint.
  // Same pattern as /api/telegram · Inngest hits this with their own
  // HMAC-signed requests, validated by inngest/next's serve() handler
  // using INNGEST_SIGNING_KEY. Must bypass NextAuth so the signed
  // probe gets through. The 503+hint wrapper in the route handles
  // the unconfigured case.
  "/api/inngest",
  // 2026-05-17 · WAVE-200 Phase 4 follow-up · Mastra agent endpoint.
  // The /api/agent route handles its own auth via resolveOperator():
  // either VOICE_BRIDGE_TOKEN Bearer (for the apps/voice Python worker)
  // OR requireSession() (browser useChat() callers). Both gates work
  // regardless of middleware. Whitelisting here lets the Bearer-only
  // bridge path through.
  "/api/agent",
  "/api/actions/",    // GPT Custom Actions bridge (own Bearer auth). forensic-audit LOW · trailing slash so it no longer also exempts the unrelated /api/actions-brain route.
  "/api/mcp",         // MCP bridge (own Bearer auth)
  // forensic-audit HIGH · header-token-authenticated server-to-server
  // surfaces. Each route runs its OWN auth (requireSyncAuth / verifyVapiSecret
  // / x-sync-key), but they carry no NextAuth cookie, so the session
  // middleware 401'd them before that auth could run — breaking the Windows
  // device agent, nickstire camera sync, and live VAPI voice-tool calls.
  // Same whitelist pattern as /api/agent and /api/actions above.
  "/api/devices",     // device RPC queue/ack/upsert (own x-sync-key auth)
  "/api/vapi",        // VAPI voice webhooks + tools (own X-Vapi-Secret auth)
  "/api/nour-os",     // nour-os bridge query (own x-sync-key auth)
  "/auth",            // Sign-in/sign-out pages
  "/_next",           // Next.js internals
  "/favicon",
];

const PUBLIC_EXACT = [
  "/",
  "/api/health",           // General health
  "/api/system/health",    // read-only uptime probe
  "/api/system/heartbeat", // External monitors (UptimeRobot, etc.)
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)).*)",
  ],
};
