import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { auth, authEnabled } from "@/auth";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";

// v10.0.529.105 · Wave 49 · structured logger surface for auth-bypass
// events. Pre-Wave-49 console.error was the only signal · meant the
// AUTH_ALLOW_MOCK_IN_PROD bypass was invisible to /system/errors and
// any Telegram alert pipeline. Routing through the structured logger
// lands these events in ErrorLog where they're surfaced.
const log = rootLogger.withSurface("auth-guard");

/**
 * Mock operator used when auth is disabled — either because env
 * credentials are missing OR because AUTH_FORCE_MOCK=1 was set for
 * local dev. Mirrors lib/auth.ts getMockOperatorSession() so server
 * + API surfaces agree on the same identity.
 */
const MOCK_OPERATOR = {
  id: process.env.AUTH_MOCK_USER_ID || "operator-1",
  email: process.env.AUTH_MOCK_USER_EMAIL || "operator@statenour.local",
  role: "operator" as const,
};

// v8.21 · drop the `?? ""` defaults. Each guard already checks for
// falsy and returns 401 — failing closed. Keeping `string | undefined`
// here makes that fail-closed semantics explicit at the type level
// instead of masquerading as a non-empty string.
const SYNC_KEY = process.env.STATENOUR_SYNC_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

/** Constant-time string comparison to prevent timing attacks. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then return false
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Validate Bearer CRON_SECRET header. Throws ServiceError on failure. */
export function requireCronAuth(req: Request): void {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!CRON_SECRET || !safeEqual(authHeader, `Bearer ${CRON_SECRET}`)) {
    throw new ServiceError("Unauthorized", 401);
  }
}

/** Validate x-sync-key or Bearer sync key. Throws ServiceError on failure. */
export function requireSyncAuth(req: Request): void {
  const syncKey =
    req.headers.get("x-sync-key") ??
    req.headers.get("authorization")?.replace("Bearer ", "");
  if (!SYNC_KEY || !safeEqual(syncKey ?? "", SYNC_KEY)) {
    throw new ServiceError("Unauthorized", 401);
  }
}

/**
 * v10.0.112 audit fix · production fail-closed gate.
 *
 * Pre-fix the mock-bypass was unconditional — if AUTH_SECRET /
 * AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET were ever dropped from a prod
 * env (key rotation, accidental Vercel env var deletion), every
 * caller would silently auto-authenticate as `operator-1`. The
 * dev-mock path is intentional but it MUST NOT be reachable in
 * production. AUTH_ALLOW_MOCK_IN_PROD=1 lets a deliberate operator
 * opt back in (e.g. preview deployments where OAuth callbacks aren't
 * wired) but it has to be set explicitly — no silent path.
 */
function assertMockBypassAllowed(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.AUTH_ALLOW_MOCK_IN_PROD === "1") {
    // Explicit opt-in — log via structured logger so it lands in
    // ErrorLog (visible in /system/errors AND triggers the Telegram
    // alert pipeline via error-telegram-push cron). Pre-Wave-49 this
    // was console.error only · the bypass was invisible.
    log.error("auth_bypass_active_in_production", {
      message:
        "AUTH_ALLOW_MOCK_IN_PROD=1 set. Every caller auto-authenticates as mock operator. Intentional ONLY for preview deployments without OAuth — should never appear on bdnick.info prod.",
      severity: "CRITICAL",
    });
    return;
  }
  log.error("auth_misconfigured_in_production", {
    message:
      "Auth disabled in production but AUTH_ALLOW_MOCK_IN_PROD is not set. Refusing to mock-authenticate. Set AUTH_SECRET + AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET, or AUTH_ALLOW_MOCK_IN_PROD=1 if bypass is intentional.",
    severity: "FATAL",
  });
  throw new ServiceError(
    "Authentication is unavailable",
    503,
  );
}

/** Validate NextAuth session. Returns session user. Throws ServiceError on failure. */
export async function requireSession(
  req: Request
): Promise<{ id: string; email: string; role: string }> {
  // When auth is disabled (env unset OR AUTH_FORCE_MOCK=1 for local
  // dev), skip the real session check and return a mock operator so
  // authed endpoints work without Google OAuth. This is the same
  // contract getOperatorSession() uses on the server side.
  if (!authEnabled) {
    assertMockBypassAllowed();
    return MOCK_OPERATOR;
  }
  const session = await auth();
  if (!session?.user?.email) {
    throw new ServiceError("Unauthorized", 401);
  }
  return {
    id: (session.user as any).id ?? session.user.email,
    email: session.user.email,
    role: (session.user as any).role ?? "operator",
  };
}
