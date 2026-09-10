/**
 * Every public, unauthenticated endpoint that WRITES a row must be registered
 * with formLimiter — not just covered by the general apiLimiter.
 *
 * WHY (2026-09-10): #2254 added `candidates.submit` (the /careers job
 * application) and `technicianReferrals.submit`, allowlisted them in
 * trpc-auth-tier.test.ts as "same tier as lead.submit", and never registered
 * either with the limiter lead.submit uses. They inherited only
 * `app.use("/api/trpc", apiLimiter)` — 100 per 15 minutes for an anonymous
 * caller, i.e. 400/hour, against formLimiter's 10/hour. Forty times the write
 * budget of every comparable form, into a candidates table an operator triages
 * by hand.
 *
 * The auth-tier test could not catch this: it asks "is this procedure allowed
 * to be public", which was the right answer. Nothing asked "and is the public
 * write it performs rate-limited". This does.
 *
 * Reading the wiring as SOURCE is deliberate. The registrations are
 * `app.use(...)` calls inside startServer(), and importing that module boots
 * the server (DB, cron, Vapi). The subject under test is the registry itself,
 * so the source text is the honest artifact to assert on — with a canary below
 * proving the extraction is not vacuous.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SERVER_ENTRY = path.resolve(__dirname, "_core/index.ts");
const source = readFileSync(SERVER_ENTRY, "utf8");

/** Endpoints registered as `withBatchRegex("<name>"), formLimiter`. */
function formLimitedEndpoints(text: string): Set<string> {
  const found = new Set<string>();
  const re = /withBatchRegex\(\s*"([^"]+)"\s*\)\s*,\s*(?:blockBatchedLimits\s*,\s*)?formLimiter/g;
  for (const m of text.matchAll(re)) found.add(m[1]);
  return found;
}

/**
 * Public, unauthenticated procedures whose whole purpose is to INSERT a row
 * a human then has to read. Adding a new one? Register it with formLimiter
 * and add it here — that is the point of this test.
 */
const PUBLIC_WRITE_FORMS: readonly string[] = [
  "lead.submit",
  "callback.submit",
  "emergency.submit",
  "candidates.submit",
  "technicianReferrals.submit",
  "referrals.submit",
  "booking.create",
  "waitlist.join",
  "fleet.submit",
];

describe("formLimiter registry covers every public write form", () => {
  const limited = formLimitedEndpoints(source);

  it("extraction is not vacuous — the canary", () => {
    // A broken regex that matched nothing would make every assertion below
    // fail loudly rather than pass silently, but a regex that matched
    // EVERYTHING would pass them all vacuously. Both directions are pinned:
    // a real, bounded number of endpoints, and a known non-member excluded.
    expect(limited.size).toBeGreaterThan(5);
    expect(limited.size).toBeLessThan(60);
    // chat.message is deliberately on aiLimiter, never formLimiter.
    expect(limited.has("chat.message")).toBe(false);
  });

  for (const endpoint of PUBLIC_WRITE_FORMS) {
    it(`${endpoint} is rate-limited by formLimiter`, () => {
      expect(limited.has(endpoint)).toBe(true);
    });
  }
});
