/**
 * EVERY outbound lane — VOICE and EMAIL — consumes the SHARED suppression index
 * and fails closed when it cannot trust it.
 *
 * (Renamed from voiceLanes.suppression.test.ts on 2026-09-16 when the operator
 * asked for email too: "i need the opt outs to work too email, txt".)
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
 * THE SWEEP — and an honest account of what it can and cannot see.
 *
 * A per-lane test proves the lane it names. It cannot prove there is no lane
 * nobody named, which is exactly how `followupCadence.ts` was missed. So this
 * enumerates the lanes from the source.
 *
 * ⚠ THE FIRST VERSION OF THIS BLOCK OVERCLAIMED, and the claim shipped. It said
 * "a FOURTH lane cannot be missed the way the second one was" while scanning
 * only `server/cron/jobs` and keying only on `placeVapiOutboundCall(`. A
 * fourth lane existed the whole time, in neither of those: `makeFollowUpCall`
 * in `server/routers/vapi.ts` POSTs straight to `https://api.vapi.ai/call`
 * with a raw `fetch`. Found by sweeping the PROVIDER rather than the helper —
 * the same mistake one level up, caught by the same move that caught the first.
 *
 * WHAT IT NOW COVERS: every `.ts` under `server/` (recursively, tests aside),
 * and all three dial shapes this codebase actually uses —
 *   1. `placeVapiOutboundCall(`                    the sanctioned helper
 *   2. `api.vapi.ai/call` with no `/` or `?` after  a raw literal URL
 *   3. `vapiFetch("/call")`                         how the helper itself dials
 * Shapes 2 and 3 are distinguished from the FIVE read-only sites
 * (`/call/${id}`, `/call?limit=`) by the character after `call`, which is
 * why the negative lookahead matters rather than being defensive noise.
 *
 * WHAT IT STILL CANNOT SEE, stated rather than papered over: a NEW spelling —
 * another base-URL constant, a client library, a proxy helper. No pattern list
 * closes that. The inventory test below is the answer to it: the set of files
 * that touch the VAPI API at all is pinned, so a new VAPI-touching file fails
 * and a human has to classify it as a read or a dial. That is robust to
 * spellings in a way a pattern list is not.
 */
/** Blank out comments so a guard never fires on prose ABOUT the thing it bans. */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SERVER_DIR = resolve(__dirname, "..", "..");

/** Every `.ts` under server/, tests excluded, paths relative to server/. */
function serverSources(): Array<{ file: string; src: string }> {
  return readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f))
    .map((f) => ({ file: f.replace(/\\/g, "/"), src: readFileSync(resolve(SERVER_DIR, f), "utf8") }));
}

/**
 * The gate's own implementation is not a lane. `services/vapi.ts` is where the
 * sanctioned dial lives, so it necessarily contains a dial shape and
 * necessarily does not consult the index — the CALLERS do.
 */
const GATE_IMPL = "services/vapi.ts";

/** The three dial shapes, on comment-stripped source. */
function dials(src: string): boolean {
  const t = stripComments(src);
  return (
    /placeVapiOutboundCall\s*\(/.test(t) ||
    /api\.vapi\.ai\/call(?![/?\w])/.test(t) ||
    /vapiFetch\s*\(\s*["'\`]\/call["'\`]/.test(t)
  );
}

describe("every outbound voice lane is accounted for", () => {
  /**
   * Lanes that deliberately do NOT consult the index, each with its reason.
   * Adding a name here is a POLICY decision to be argued in the PR — it is not
   * a way to make this test green.
   */
  /**
   * EMPTY, and that is the point.
   *
   * Both entries that lived here were resolved by the operator on 2026-09-16,
   * so every dialing lane now consults the index and the allowlist has nothing
   * legitimate in it:
   *
   *   · `cron/jobs/confirmationCalls.ts` — the one plausible TRANSACTIONAL
   *     exception, retired by a business fact rather than a legal argument:
   *     "we are first come first serve so it can confirm they are gonna come
   *     but no holding spots". No slot is held, so there is no reservation to
   *     confirm and nothing the customer forfeits — the call is outreach.
   *   · `routers/vapi.ts` (`makeFollowUpCall`) — operator-triggered, so it
   *     REFUSES with a reason instead of skipping silently. Being
   *     human-initiated is not a consent defence.
   *
   * An entry added here must carry a reason and be argued in the PR. It is not
   * a way to make this test green.
   */
  const DOCUMENTED_EXCEPTIONS: Record<string, string> = {};

  const lanes = serverSources().filter(({ file, src }) => file !== GATE_IMPL && dials(src));

  it("the enumeration itself found something — otherwise this suite asserts nothing", () => {
    // The silent-instrument guard: if the walk or the patterns ever stop
    // matching, every assertion below passes over an empty list. Four lanes are
    // known to exist today; fewer means the instrument broke, not that the
    // lanes went away.
    expect(lanes.map((l) => l.file).sort()).toEqual(
      [
        "cron/jobs/confirmationCalls.ts",
        "cron/jobs/followupCadence.ts",
        "cron/jobs/voiceRecovery.ts",
        "routers/vapi.ts",
      ].sort(),
    );
  });

  it("BREAKS: each dialing lane consumes loadSuppressionIndex, or is a documented exception", () => {
    // CALL EXPRESSION on COMMENT-STRIPPED source. A bare substring test was
    // proved blind by mutation M10: reverting a lane left it GREEN, satisfied by
    // a leftover comment reading "loadSuppressionIndex now owns".
    const offenders = lanes
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
    // ⚠ MENTION vs EXECUTION. The first version matched raw source and flagged
    // BOTH fixed lanes, because each now carries a comment DESCRIBING the
    // deleted query. A guard that fails on its own documentation is a guard
    // someone deletes. Same helper shape as `server/nonCustomerFilter.test.ts`.
    const localCopies = lanes
      .filter(({ src }) => /customers\.smsOptOut/.test(stripComments(src)))
      .map(({ file }) => file);

    expect(
      localCopies,
      `these lanes still derive suppression from customers.smsOptOut directly: ${localCopies.join(", ")}. ` +
        "That misses sms_preferences, the inbound-message log and carrier blocks — the sources ensureOptOutCache reads.",
    ).toEqual([]);
  });

  it("every documented exception still dials, so the allowlist cannot rot", () => {
    // Vacuous while the allowlist is empty — deliberately KEPT, because the
    // moment someone adds an entry this is the test that stops it becoming a
    // permanently green waiver for a file that no longer dials.
    const present = new Set(lanes.map(({ file }) => file));
    for (const file of Object.keys(DOCUMENTED_EXCEPTIONS)) {
      expect(present.has(file), `${file} is allowlisted but no longer dials — drop the entry`).toBe(true);
    }
    // The stronger statement, true as of 2026-09-16: nothing is waived.
    expect(Object.keys(DOCUMENTED_EXCEPTIONS)).toEqual([]);
  });

  /**
   * THE ANSWER TO "a new spelling would evade the patterns".
   *
   * Pinning the set of files that touch the VAPI API at all means a new
   * VAPI-touching file fails this test and a human must classify it as a READ
   * (add it here) or a DIAL (it then has to satisfy the assertions above). That
   * is robust to spellings in a way a pattern list can never be.
   */
  it("BREAKS: the set of files touching the VAPI API is pinned — classify any new one", () => {
    const READ_ONLY = [
      "cron/jobs/agenticAuditor.ts",
      "cron/jobs/vapiCallEval.ts",
      "cron/jobs/vapiLatencySync.ts",
      "routes/adminRoutes.ts",
      "services/vapi-harness.ts",
      "services/vapiCallArchive.ts",
    ];
    const KNOWN = [...READ_ONLY, GATE_IMPL, "routers/vapi.ts"].sort();

    const touching = serverSources()
      .filter(({ src }) => /api\.vapi\.ai/.test(stripComments(src)))
      .map(({ file }) => file)
      .sort();

    expect(
      touching,
      "a file started (or stopped) touching the VAPI API. If it only READS call records, add it to READ_ONLY. " +
        "If it DIALS, it must consume loadSuppressionIndex() or earn a DOCUMENTED_EXCEPTIONS entry.",
    ).toEqual(KNOWN);
  });
});

/**
 * THE EMAIL LEG, swept the same way and for the same reason.
 *
 * Added 2026-09-16 on the operator's instruction — "email lines we really arent
 * emailing ppl right now but u can do it to" plus "i need the opt outs to work
 * too email, txt". Both email lanes were found by sweeping the PROVIDER rather
 * than a helper, which is the third time that move paid this session:
 *
 *   · `services/emailCampaigns.ts` gated on `c.smsOptOut = 0` alone — ONE of
 *     the four sources the index reads. Never fail-OPEN (the condition sat in a
 *     WHERE clause, so a query error sends nothing), but incomplete.
 *   · `services/dripProcessor.ts`'s email step checked NOTHING, and the SMS
 *     branch's comment said so: "any later email steps are unaffected".
 *
 * ⚠ CROSS-CHANNEL, and worth re-reading before anyone "simplifies" it: strictly,
 * TCPA STOP governs calls and texts while CAN-SPAM unsubscribe governs email, so
 * suppressing email on an SMS opt-out is OVER-suppression — safe, not required.
 * The operator asked for it explicitly. Note also that emailCampaigns had
 * ALREADY made that choice implicitly by filtering on `smsOptOut`, so this is
 * the same policy completely applied rather than a new one.
 *
 * ⚠ STILL MISSING, named because a guard that implies completeness it lacks is
 * how this session's earlier overclaim happened: an EMAIL unsubscribe is a
 * `mailto:unsubscribe@nickstire.org` and is recorded NOWHERE machine-readable.
 * Someone who unsubscribed by email and never texted STOP is in no index. This
 * suite cannot see that gap and does not pretend to.
 */
describe("every outbound EMAIL lane is accounted for", () => {
  /** Operator/internal recipients — not customer contact, so not lanes. */
  const OPERATOR_FACING: Record<string, string> = {
    "email-notify.ts":
      "Recipients are the shop email, the CEO email, or an explicit overrideTo — operator notifications about leads and system events. Checked 2026-09-16: no customer address is ever a recipient.",
  };

  /** The two send shapes this codebase actually uses. */
  const sends = (src: string) => {
    const t = stripComments(src);
    return /\.emails\.send\s*\(/.test(t) || /api\.resend\.com\/emails/.test(t);
  };

  const emailLanes = serverSources().filter(({ src }) => sends(src));

  it("the enumeration found the senders — otherwise this suite asserts nothing", () => {
    // Pinned, so a new sender fails here and has to be classified. Three files
    // send email today: two customer lanes and one operator-notification path.
    expect(emailLanes.map((l) => l.file).sort()).toEqual(
      ["email-notify.ts", "services/dripProcessor.ts", "services/emailCampaigns.ts"].sort(),
    );
  });

  it("BREAKS: each customer-facing email lane consumes loadSuppressionIndex", () => {
    const offenders = emailLanes
      .filter(({ file }) => !(file in OPERATOR_FACING))
      .filter(({ src }) => !/loadSuppressionIndex\s*\(/.test(stripComments(src)))
      .map(({ file }) => file);

    expect(
      offenders,
      `these email lanes send without consulting the shared suppression index: ${offenders.join(", ")}. ` +
        "Either consume loadSuppressionIndex() and fail closed, or justify it in OPERATOR_FACING with evidence that no customer address is a recipient.",
    ).toEqual([]);
  });

  it("BREAKS: the drip email branch is no longer unguarded", () => {
    // Targeted at the exact defect: the branch had NO check while its sibling
    // SMS branch had one, and a comment declared email "unaffected". A generic
    // file-level assertion would pass on the SMS branch's check alone.
    const src = stripComments(readFileSync(resolve(SERVER_DIR, "services/dripProcessor.ts"), "utf8"));
    expect(src, "the old customers-only opt-out query is back in the drip processor").not.toMatch(
      /SELECT smsOptOut FROM customers/,
    );
    expect(src, "the email branch must short-circuit on an opted-out enrollment").toMatch(
      /else if \(optedOut\)/,
    );
  });

  it("the operator-facing allowlist cannot rot", () => {
    const present = new Set(emailLanes.map(({ file }) => file));
    for (const file of Object.keys(OPERATOR_FACING)) {
      expect(present.has(file), `${file} is allowlisted but no longer sends email — drop the entry`).toBe(true);
    }
  });
});
