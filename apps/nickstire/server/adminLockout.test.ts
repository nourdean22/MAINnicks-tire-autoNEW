/**
 * The admin console rate-limited its own operator out of the building.
 *
 * REPORTED LIVE 2026-07-20: "I can't get into the admin — after I log in with
 * Google it goes right back into the sign in required screen."
 *
 * `app.use("/api/trpc", apiLimiter)` charged a 100-per-15-minutes ANTI-SPAM
 * budget to every tRPC call, the admin console's own included. Its polling alone
 * spends roughly five times that:
 *
 *     2 queries at 5s   = 360 requests / 15 min
 *     4 queries at 30s  = 120
 *     3 queries at 60s  =  45
 *     2 queries at 120s =  15
 *                       ~ 540  against a limit of 100
 *
 * Batching is deliberately blocked upstream, so nothing can be coalesced. A few
 * minutes into any session every call 429s — including auth.me — and the client
 * reads that failure as "no user" and renders "Sign in required". Signing in
 * again could never have fixed it, because the session was never the problem.
 *
 * Verified live: `ratelimit-limit: 100`, `ratelimit-remaining: 0`, HTTP 429 on
 * /api/trpc/auth.me.
 *
 * TWO defects, fixed separately, because either alone would have caused it again:
 *   1. the limiter did not distinguish a signed-in operator from an anonymous
 *      abuser
 *   2. the client rendered "could not check" as "not signed in"
 */
import { describe, it, expect } from "vitest";
import { readCode, readSource } from "./testUtils/sourceAssertions";

describe("a signed-in operator is not an anonymous abuser", () => {
  const src = readSource("server/middleware/rateLimiters.ts");
  const code = readCode("server/middleware/rateLimiters.ts");

  it("no longer applies one flat ceiling to everyone", () => {
    expect(code).not.toMatch(/max:\s*100,\s*\n/);
    expect(src).toMatch(/AUTHED_MAX_PER_WINDOW/);
    expect(src).toMatch(/ANON_MAX_PER_WINDOW/);
  });

  it("gives authenticated traffic a ceiling ABOVE what the product itself generates", () => {
    // ~540 requests / 15 min measured from polling alone. A ceiling below that is
    // not a limit on abuse, it is a limit on using the product.
    const authed = Number(src.match(/AUTHED_MAX_PER_WINDOW = (\d+)/)?.[1] ?? 0);
    expect(authed).toBeGreaterThan(540);
  });

  it("still bounds authenticated traffic — a leaked session is not an API key", () => {
    const authed = Number(src.match(/AUTHED_MAX_PER_WINDOW = (\d+)/)?.[1] ?? 0);
    expect(authed).toBeLessThanOrEqual(5000);
  });

  it("keeps the anonymous limit exactly where it was", () => {
    expect(src).toMatch(/ANON_MAX_PER_WINDOW = 100/);
  });

  it("buckets authed and anonymous SEPARATELY", () => {
    // Otherwise anonymous traffic from a shared NAT spends the operator's
    // allowance and locks them out of their own admin anyway.
    expect(src).toMatch(/looksAuthenticated\(req\) \? "auth" : "anon"/);
  });
});

describe("could-not-check is not signed-out", () => {
  const admin = readSource("client/src/pages/Admin.tsx");

  it("reads the auth error instead of only the absent user", () => {
    expect(admin).toMatch(/error: authError/);
    expect(admin).toMatch(/!user && authError/);
  });

  it("says UNKNOWN, and says signing in again will not help", () => {
    expect(admin).toMatch(/Could not verify your session/);
    expect(admin).toMatch(/unknown<\/strong>, not signed out/);
    expect(admin).toMatch(/signing in again will not help/i);
  });

  it("offers a RETRY, not just another sign-in loop", () => {
    expect(admin).toMatch(/Retry/);
  });

  it("names the rate limit specifically when that is the cause", () => {
    expect(admin).toMatch(/rate-limiting this browser/);
  });

  it("still shows the ordinary sign-in screen when there is genuinely no session", () => {
    // The plain !user branch must survive — this fix adds a state, it does not
    // replace the real signed-out case.
    expect(admin).toMatch(/Sign in with your admin account/);
  });
});

describe("the console stopped spending its own budget", () => {
  it("pipeline health polls at 30s, not 5s", () => {
    // One card at 5s = 180 requests / 15 min, nearly twice the entire anti-spam
    // budget. It also now asks Meta whether the token is live.
    const hq = readSource("client/src/pages/admin/instagram/HQ.tsx");
    expect(hq).not.toMatch(/getPipelineHealth[\s\S]{0,120}refetchInterval: 5000/);
    expect(hq).toMatch(/refetchInterval: 30_000/);
  });
});
