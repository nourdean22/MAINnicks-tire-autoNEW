/**
 * A database outage must not turn the OTP limiter into an open door.
 *
 * WHAT WAS THERE. checkBruteForce returned `{ allowed: true }` on a dead
 * handle, with NO log — unlike its own catch branch, which at least warned.
 * recordFailedAttempt returned just as quietly. So while the database was
 * unreachable this PUBLIC endpoint accepted unlimited OTP guesses and said
 * nothing: "the check passed" and "the check could not run" were the same
 * answer, which is this repo's fabricated-read shape sitting on an auth path.
 *
 * Surfaced by widening scripts/lib/fabricatedAdminReadScan.mjs past
 * server/db.ts (#2300) — the highest-severity pair that widening revealed.
 *
 * WHAT IS NOT CHANGED. Fail-open is deliberate policy and the file header
 * argues it well: a locked-down DB is already an emergency and locking real
 * customers out on top of it helps nobody. That argument turns on "transient",
 * and nothing distinguished a blip from a sustained outage. The fix keeps the
 * policy and bounds it — an in-process counter with the SAME 5-in-15min rule.
 * Degraded on purpose (per-pod, cleared by restart — the two holes the durable
 * table was built to close), but degraded is not absent: N x 5 instead of
 * infinity, and a log line instead of silence.
 *
 * Both halves are asserted below. A test that only proved "blocks after 5"
 * would pass a change that locked every customer out during an outage, which
 * is the failure the original policy existed to prevent.
 *
 * Each test uses a DISTINCT phone number: the fallback map is module state and
 * this suite deliberately has no production reset hook — a test seam on an auth
 * path is a liability, and unique keys cost nothing.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const dbHandle = vi.fn();
vi.mock("./lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, db: () => dbHandle() };
});

const { checkBruteForce, recordFailedAttempt, clearAttempts } = await import("./middleware/bruteForce");

/** The outage condition: getDb() hands back null. */
function databaseDown() {
  dbHandle.mockResolvedValue(null);
}

describe("OTP limiter under a database outage", () => {
  beforeEach(() => {
    dbHandle.mockReset();
    databaseDown();
  });

  it("still allows a customer who has done nothing wrong — the policy that is KEPT", async () => {
    // The availability half. If this ever fails, the fix has traded a security
    // hole for a customer-facing lockout during exactly the emergency the
    // fail-open policy was written for.
    await expect(checkBruteForce("216-555-0101")).resolves.toEqual({ allowed: true });
  });

  it("BLOCKS after the same 5 failures the durable path would have blocked on", async () => {
    const phone = "216-555-0102";
    for (let i = 0; i < 5; i++) await recordFailedAttempt(phone);
    const verdict = await checkBruteForce(phone);
    expect(verdict.allowed, "5 failed attempts during an outage must not be unlimited").toBe(false);
    expect(verdict.retryAfter).toBeGreaterThan(0);
  });

  it("does not block early — 4 failures are still allowed", async () => {
    // Guards the other direction: a counter that blocked immediately would pass
    // the arm above while locking customers out on their first typo.
    const phone = "216-555-0103";
    for (let i = 0; i < 4; i++) await recordFailedAttempt(phone);
    await expect(checkBruteForce(phone)).resolves.toEqual({ allowed: true });
  });

  it("counts each phone separately", async () => {
    const blocked = "216-555-0104";
    for (let i = 0; i < 5; i++) await recordFailedAttempt(blocked);
    expect((await checkBruteForce(blocked)).allowed).toBe(false);
    // A bystander must not inherit someone else's lockout.
    await expect(checkBruteForce("216-555-0105")).resolves.toEqual({ allowed: true });
  });

  it("a successful verify clears the degraded counter", async () => {
    // Without this, the fallback creates a lockout the durable path never
    // would: verify succeeds during the outage, the in-process count survives,
    // and the customer is refused later for attempts they already passed.
    const phone = "216-555-0106";
    for (let i = 0; i < 5; i++) await recordFailedAttempt(phone);
    expect((await checkBruteForce(phone)).allowed).toBe(false);
    await clearAttempts(phone);
    await expect(checkBruteForce(phone)).resolves.toEqual({ allowed: true });
  });

  it("normalises the number, so formatting cannot reset the count", async () => {
    // 5 attempts spread across spellings of one number must still block —
    // otherwise the bound is defeated by adding a dash.
    for (const spelling of ["2165550107", "216-555-0107", "(216) 555-0107", "+1 216 555 0107", "216.555.0107"]) {
      await recordFailedAttempt(spelling);
    }
    expect((await checkBruteForce("216-555-0107")).allowed).toBe(false);
  });
});

describe("the durable table stays authoritative when it answers", () => {
  beforeEach(() => dbHandle.mockReset());

  it("does not consult the in-process counter while the database is up", async () => {
    const phone = "216-555-0108";
    databaseDown();
    for (let i = 0; i < 5; i++) await recordFailedAttempt(phone); // fallback now blocks it
    expect((await checkBruteForce(phone)).allowed).toBe(false);

    // Database returns: the table says this phone has no row, so it is allowed
    // even though the degraded counter is still hot. The DB is the truth.
    dbHandle.mockResolvedValue({ execute: async () => [[], []] });
    await expect(checkBruteForce(phone)).resolves.toEqual({ allowed: true });
  });

  it("honours a block the DATABASE reports", async () => {
    const future = new Date(Date.now() + 600_000);
    dbHandle.mockResolvedValue({ execute: async () => [[{ blocked_until: future }], []] });
    const verdict = await checkBruteForce("216-555-0109");
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfter).toBeGreaterThan(0);
  });
});
