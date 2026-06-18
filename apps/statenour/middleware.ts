import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Global auth middleware (Karpathy-Mode Hardened)
 * 
 * Absolute security boundaries. Routes NOT requiring auth are explicitly whitelisted.
 * Fail-open bypasses are strictly constrained to non-production environments.
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

  // Allow public routes
  if (isPublic(pathname)) return NextResponse.next();

  // Allow static files
  if (pathname.includes(".") && !pathname.startsWith("/api/")) return NextResponse.next();

  // Absolute Security Bounds: Fail-Closed Architecture
  // Pre-v10.1, a missing AUTH_SECRET in production would gracefully fail OPEN
  // granting global unauthenticated access. This enforces a strict fail-closed state.
  const hasAuth = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET);
  const isDev = process.env.NODE_ENV !== "production";
  
  if (isDev) {
    const forceMock = process.env.AUTH_FORCE_MOCK === "1" || process.env.AUTH_FORCE_MOCK?.toLowerCase() === "true";
    if (!hasAuth || forceMock || process.env.LOCAL_DEV_BYPASS_AUTH === "1") {
      return NextResponse.next();
    }
  } else if (!hasAuth) {
    // Production & Missing Auth Credentials -> Total Lockdown
    return NextResponse.json(
      { error: "SYSTEM LOCKED: Critical authorization configuration missing." }, 
      { status: 500 }
    );
  }

  // Check session
  if (!req.auth?.user?.email) {
    // API routes get 401, pages get redirected to sign-in
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/auth/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all paths except static files and _next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)).*)",
  ],
};
