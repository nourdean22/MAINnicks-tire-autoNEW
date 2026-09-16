/**
 * EVERY outbound voice lane consumes the SHARED suppression index, and fails
 * closed when it cannot trust it.
 *
 * WHY THIS FILE EXISTS, and it is the uncomfortable part: the first pass of
 * this work fixed `voiceRecovery.ts` and shipped. Sweeping every caller of
 * `placeVapiOutboundCall` afterwards found a SECOND lane,
 * `followupCadence.ts`, carrying a byte-for-byte copy of the same four-line
 * bug — a local `customers.smsOptOut`-only query inside a fail-soft catch whose
 * log line literally read "opt-out query failed (proceeding without)".
 * Proceeding without is an EMPTY set, which reads as "nobody opted out".
 *
 * So this suite does two things a per-lane test cannot:
 *   1. pins followupCadence's behaviour (the second lane), and
 *   2. ENUMERATES the lanes from the source and fails on a lane that does not
 *      consume the index — so a FOURTH lane added later cannot be missed the
 *      way the second one was.
 *
 * ⚠ The lesson `followupCadence.ts` illustrates best: twelve lines above the
 * consent query, the fired-touch query already RETHROWS, commented "an
 * unreadable fired-touch set must not read as a clean run (it is the guard
 * against re-texting)". The RE-CONTACT guard failed closed and the CONSENT
 * guard failed open, in the same function.
 *
 * SYNTHETIC INPUTS ONLY — no network, no DB, no real phone number.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const JOBS_DIR = __dirname;

/** 555-exchange, unassignable by NANP — it cannot ring anyone. */
const PHONE = "216-555-0188";
const PHONE_LAST10 = "2165550188";

/** 13:00 Cleveland, inside the 9-18 window, on a date with a due d7 touch. */
const NOW_UTC = new Date("2026-09-16T17:00:00Z");

type Booking = { id: number; name: string; phone: string; service: string; createdAt: Date };

const BOOKING: Booking = {
  id: 77_001,
  name: "Synthetic Booking",
  phone: PHONE,
  service: "four used tires mounted",
  // 10 days old: past the d7 due time, inside the 65-day floor.
  createdAt: new Date(NOW_UTC.getTime() - 10 * 24 * 60 * 60 * 1000),
};

/**
 * A db stub that allows EXACTLY TWO selects — the candidate query and the
 * fired-touch query. A THIRD means someone re-added a local opt-out query, so
 * the tripwire trips instead of a second, weaker definition of "do not contact"
 * quietly coming back.
 */
function fakeDb(bookings: Booking[]) {
  let selects = 0;
  const inserts: Array<Record<string, unknown>> = [];
  /** `where()` is awaited directly in one place and `.orderBy()`-chained in another. */
  const settle = <T>(rows: T) => Object.assign(Promise.resolve(rows), { orderBy: () => Promise.resolve(rows) });
  return {
    inserts,
    get selectCount() { return selects; },
    db: {
      select: () => {
        selects += 1;
        if (selects > 2) {
          throw new Error("third select — a voice lane is deriving suppression itself again");
        }
        const rows = selects === 1 ? bookings : [];
        return { from: () => ({ where: () => settle(rows) }) };
      },
      insert: () => ({
        values: async (v: Record<string, unknown>) => { inserts.push(v); },
      }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
  };
}

describe("followup cadence · suppression gate (the SECOND lane)", () => {
  const placed: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    placed.length = 0;
    // Only Date is faked: the lane throttles with a real setTimeout, and faking
    // timers would hang it. getClevelandHour() reads `new Date()` through Intl,
    // so a fixed instant is what puts the run inside the call window.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW_UTC);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // doMocks are NOT file-scoped under singleFork serial mode.
    vi.doUnmock("../../services/vapi");
    vi.doUnmock("../../db");
    vi.doUnmock("../../sms");
  });

  /** Every gate before suppression, satisfied, so only it is under test. */
  const armGates = () => {
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("FEATURE_FOLLOWUP_CADENCE", "1");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
  };

  /** Partial mocks SPREAD the real module (AGENTS.md §3) — see voiceRecovery.suppression.test.ts. */
  const mockVapi = () =>
    vi.doMock("../../services/vapi", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../services/vapi")>()),
      resolveVapiPhoneNumberId: async () => "pn_canary",
      placeVapiOutboundCall: async (params: { customerNumber: string }) => {
        placed.push(params.customerNumber);
        return { success: true, callId: `call_${placed.length}` };
      },
    }));

  const mockSuppression = (index: unknown) =>
    vi.doMock("../../sms", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../sms")>()),
      loadSuppressionIndex: async () => index,
    }));

  const mockDb = (rig: ReturnType<typeof fakeDb>) =>
    vi.doMock("../../db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../db")>()),
      getDb: async () => rig.db,
    }));

  it("POSITIVE CONTROL: a clean index DOES place the call", async () => {
    armGates();
    mockVapi();
    mockSuppression({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false });
    const rig = fakeDb([BOOKING]);
    mockDb(rig);

    const { runFollowupCadence } = await import("./followupCadence");
    const result = await runFollowupCadence();

    // Without this, every "zero calls" below is satisfiable by a run that
    // never got past its own feature gates.
    expect(placed).toEqual([`+1${PHONE_LAST10}`]);
    expect(result.recordsProcessed).toBe(1);
    // And the at-most-once claim was written before the dial.
    expect(rig.inserts).toHaveLength(1);
  });

  it("BREAKS: an UNREADABLE index places ZERO calls and REJECTS", async () => {
    armGates();
    mockVapi();
    mockSuppression({ ok: false, reason: "opt-out index unreadable (canary)" });
    const rig = fakeDb([BOOKING]);
    mockDb(rig);

    const { runFollowupCadence } = await import("./followupCadence");
    let message = "";
    try {
      await runFollowupCadence();
      throw new Error("runFollowupCadence RESOLVED — 'proceeding without' is back");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/suppression index unreadable/);
    expect(message).toContain("opt-out index unreadable (canary)");
    expect(placed).toEqual([]);
    // No claim row either: a claim would burn this (booking, touch) pair
    // permanently via the UNIQUE key, for a call that never happened.
    expect(rig.inserts).toEqual([]);
  });

  it("BREAKS: a STALE index also places ZERO calls — its age is UNBOUNDED", async () => {
    armGates();
    mockVapi();
    mockSuppression({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: true });
    const rig = fakeDb([BOOKING]);
    mockDb(rig);

    const { runFollowupCadence } = await import("./followupCadence");
    let message = "";
    try {
      await runFollowupCadence();
      throw new Error("runFollowupCadence RESOLVED on a stale index — it placed the call");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/suppression index is STALE/);
    expect(message).toMatch(/age is unbounded/);
    expect(placed).toEqual([]);
    expect(rig.inserts).toEqual([]);
  });

  it("BREAKS: a phone the SHARED index knows (e.g. sms_preferences only) is suppressed", async () => {
    armGates();
    mockVapi();
    mockSuppression({
      ok: true,
      phones: new Set([PHONE_LAST10]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });
    const rig = fakeDb([BOOKING]);
    mockDb(rig);

    const { runFollowupCadence } = await import("./followupCadence");
    const result = await runFollowupCadence();

    expect(placed).toEqual([]);
    expect(result.recordsProcessed).toBe(0);
    expect(result.details).toContain("skipped=1");
    // TWO selects — candidates and fired-touches. A third would mean the local
    // customers-only opt-out query is back.
    expect(rig.selectCount).toBe(2);
    expect(rig.inserts).toEqual([]);
  });
});

/**
 * THE SWEEP, made mechanical.
 *
 * A per-lane test proves the lane it names. It cannot prove there is no lane
 * nobody named — which is exactly how `followupCadence.ts` was missed on the
 * first pass. This enumerates the lanes from the source instead.
 */
/** Blank out comments so a guard never fires on prose ABOUT the thing it bans. */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("every outbound voice lane is accounted for", () => {
  /**
   * Lanes that deliberately do NOT consult the index, each with the reason.
   * Adding a name here is a POLICY decision and should be argued in the PR, not
   * a way to make this test green.
   */
  const DOCUMENTED_EXCEPTIONS: Record<string, string> = {
    "confirmationCalls.ts":
      "OPERATOR DECISION, open as of 2026-09-16: a call confirming a booking the customer themselves requested is arguably TRANSACTIONAL rather than marketing. Surfaced in PR #2361 rather than changed by an agent, because the transactional/marketing line is a consent-policy call.",
  };

  /** Files under server/cron/jobs that actually dial out. */
  const dialingLanes = readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => ({ file: f, src: readFileSync(resolve(JOBS_DIR, f), "utf8") }))
    // The import line alone is not enough — a file could name the function in a
    // comment. Require an actual call expression.
    .filter(({ src }) => /placeVapiOutboundCall\s*\(/.test(src));

  it("the enumeration itself found something — otherwise this suite asserts nothing", () => {
    // The silent-instrument guard: if the glob or the pattern ever stops
    // matching, every assertion below passes over an empty list.
    expect(dialingLanes.length).toBeGreaterThanOrEqual(3);
  });

  it("BREAKS: each dialing lane consumes loadSuppressionIndex, or is a documented exception", () => {
    // ⚠ CALL EXPRESSION, on COMMENT-STRIPPED source. The first version of this
    // test was `src.includes("loadSuppressionIndex")`, and mutation M10 proved
    // it blind: reverting followupCadence.ts to the fail-soft local query left
    // the test GREEN, because a leftover comment ("loadSuppressionIndex now
    // owns — see the block below") still contained the substring. A guard
    // satisfied by prose about the thing it checks for is a silent instrument.
    // Only the mutation showed it; the first green run did not.
    const offenders = dialingLanes
      .filter(({ file }) => !(file in DOCUMENTED_EXCEPTIONS))
      .filter(({ src }) => !/loadSuppressionIndex\s*\(/.test(stripComments(src)))
      .map(({ file }) => file);

    expect(
      offenders,
      `these lanes dial out without consulting the shared suppression index: ${offenders.join(", ")}. ` +
        "Either consume loadSuppressionIndex() and fail closed, or add the file to DOCUMENTED_EXCEPTIONS with a reason and argue it in the PR.",
    ).toEqual([]);
  });

  it("BREAKS: no lane keeps a LOCAL opt-out query alongside the shared index", () => {
    // The specific shape of the bug this sweep exists for: a second, weaker
    // definition of "do not contact" derived from customers.smsOptOut.
    //
    // ⚠ MENTION vs EXECUTION. The first version of this test matched the raw
    // source and flagged BOTH fixed lanes — because each one now carries a
    // comment DESCRIBING the deleted query. A guard that fails on its own
    // documentation is a guard someone deletes, so comments come out first.
    // Same helper shape as `server/nonCustomerFilter.test.ts`.
    const localCopies = dialingLanes
      .filter(({ src }) => /customers\.smsOptOut/.test(stripComments(src)))
      .map(({ file }) => file);

    expect(
      localCopies,
      `these lanes still derive suppression from customers.smsOptOut directly: ${localCopies.join(", ")}. ` +
        "That misses sms_preferences, the inbound-message log and carrier blocks — the sources ensureOptOutCache reads.",
    ).toEqual([]);
  });

  it("every documented exception still exists, so the allowlist cannot rot", () => {
    // An allowlist entry for a deleted or renamed file is a permanently green
    // waiver for a lane nobody is looking at.
    const present = new Set(dialingLanes.map(({ file }) => file));
    for (const file of Object.keys(DOCUMENTED_EXCEPTIONS)) {
      expect(present.has(file), `${file} is allowlisted but no longer dials out — drop the entry`).toBe(true);
    }
  });
});
