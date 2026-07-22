/**
 * lib/security/route-policy.ts · truth-substrate audit P0 (2026-07-21)
 *
 * The PURE, dependency-free classification of which request paths bypass the
 * NextAuth session gate. Extracted verbatim out of `middleware.ts` so the
 * security boundary is unit-testable WITHOUT importing the NextAuth runtime
 * (`@/auth`) — which drags in env + provider config and can't run under vitest.
 *
 * This is the first concrete step toward the audit's "typed route-security
 * registry" (finding #2): a single, testable source for public-route policy.
 * Middleware imports `isPublic` from here; behavior is byte-for-byte identical
 * to the previous inline implementation.
 *
 * INVARIANT: adding a path here makes it anonymously reachable. Every entry
 * must either serve genuinely public data OR run its OWN auth inside the route
 * (cron secret / sync key / webhook signature / Bearer). See per-line notes.
 */

/** Path PREFIXES that bypass the session gate (each runs its own auth or is public). */
export const PUBLIC_PREFIXES = [
  "/api/auth",        // NextAuth handlers
  "/api/webhooks",    // External webhook receivers
  "/api/telegram",    // Telegram bot webhook (own chat_id validation)
  "/api/images",      // Generated image serving (public, cached)
  "/api/cron",        // Cron jobs (own CRON_SECRET auth)
  "/api/sync",        // Bridge sync (own Bearer auth)
  "/api/brain",       // Extension token-auth operations
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
  // code-review 2026-07-09 · same class as devices/vapi/nour-os above:
  // Apple Health / iOS-Shortcut sync authed by its OWN header secret
  // (x-statenour-health-sync-secret, constant-time compared in the
  // route) and carries no NextAuth cookie — the session gate 401'd it
  // before its own auth could run, so no caller could ever succeed.
  "/api/health/summary",
  "/auth",            // Sign-in/sign-out pages
  "/_next",           // Next.js internals
  "/favicon",
] as const;

/** EXACT paths that bypass the session gate. */
export const PUBLIC_EXACT = [
  // truth-substrate audit P0 (2026-07-21) · REMOVED "/" and "/api/health".
  //   · "/" renders the private HomeConsole cockpit — never a public landing.
  //     Anonymous callers now redirect to /auth/sign-in like every other page.
  //   · "/api/health" returned the full buildSystemHealth() payload (task /
  //     commitment / device / radar counts, morning-brief, Inngest, Braintrust)
  //     to any unauthenticated client. It also lacked a route-level auth wrapper
  //     (unlike /api/system/health), so this middleware entry was its ONLY guard.
  //     Now owner-gated here AND at the route (defense-in-depth). External
  //     uptime monitors must use /api/system/heartbeat (Railway healthcheckPath
  //     already points there — see railway.json — so deploys are unaffected).
  "/api/system/health",    // owner-gated at the route ({ auth: "owner" }); kept here as coexistence path
  "/api/system/heartbeat", // External monitors (UptimeRobot, etc.) — returns only { status, db_latency_ms }
  "/api/system/perplexica-diag", // CRON_SECRET-gated at the route ({ auth: "cron" }); bypasses the session gate so the /perplexica diagnostic is reachable with the cron bearer, exactly like /api/cron/*
] as const;

/** True iff `pathname` bypasses the NextAuth session gate. Pure — no I/O, no env. */
export function isPublic(pathname: string): boolean {
  if ((PUBLIC_EXACT as readonly string[]).includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
