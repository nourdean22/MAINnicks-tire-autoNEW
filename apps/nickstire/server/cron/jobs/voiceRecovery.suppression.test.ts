/**
 * Voice recovery · the suppression gate MUST fail CLOSED (2026-09-16)
 *
 * WHAT WAS WRONG. Until this diff `voiceRecovery.ts` derived its own opt-out
 * set, four lines, two defects:
 *
 *   const optOutSet = new Set<string>();
 *   try { ...select customers where smsOptOut = 1... } catch { /* fail-soft *\/ }
 *
 *   1. It read ONLY `customers.smsOptOut`, missing `sms_preferences` — the
 *      table `persistOptOutPreference` actually writes — so an opt-out
 *      recorded there was honoured by SMS and ignored by voice.
 *   2. An unreadable list produced an EMPTY set, which reads as "nobody opted
 *      out", so EVERY candidate got a call. That is the identical failure
 *      `server/sms.ts` documents with verified harm on 2026-07-20: a number
 *      that opted out on 07-13 still received automated messages on 07-16 and
 *      07-19. SMS was fixed to fail closed; this lane was never revisited.
 *
 * WHAT THIS SUITE PINS — the DECISION, not the SQL. The candidate query is
 * unchanged by this diff, and the db here is a stub, so these tests are
 * deliberately blind to the SQL (the lesson of PR #2356: a stubbed drizzle
 * chain hides the SQL from its own tests — so do not read greens here as
 * coverage of the query). What they cover is exactly what changed:
 *
 *   · an indeterminate index places ZERO calls and REJECTS  (fail closed)
 *   · a phone known only to the shared index is suppressed  (one definition)
 *   · the job no longer derives suppression itself           (no second copy)
 *   · a STALE index also places zero calls               (its age is UNBOUNDED)
 *
 * POSITIVE CONTROL FIRST. "Zero calls" is also what a broken harness prints,
 * so one test proves this rig CAN place a call. Without it every assertion
 * below is satisfiable by a job that never runs.
 *
 * SYNTHETIC INPUTS ONLY — no network, no DB, no real phone number.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type EstRow = {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  serviceDescription: string | null;
  estimatedAmount: number | null;
};

/** 555-exchange, i.e. unassignable by NANP — it cannot ring anyone. */
const CANDIDATE: EstRow = {
  id: 90_001,
  customerName: "Synthetic Candidate",
  customerPhone: "216-555-0142",
  serviceDescription: "front brake pads and rotors",
  estimatedAmount: 42_000,
};
const CANDIDATE_LAST10 = "2165550142";

/**
 * A db stub that allows EXACTLY ONE `select` — the candidate query.
 *
 * This is the assertion that the deleted local opt-out query stays deleted: if
 * anyone re-adds a `select ... from customers where smsOptOut = 1`, this throws
 * instead of quietly building a second, weaker definition of "do not contact".
 */
function fakeDb(candidates: EstRow[]) {
  let selects = 0;
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    get selectCount() { return selects; },
    db: {
      select: () => {
        selects += 1;
        if (selects > 1) {
          throw new Error("second select — voice recovery is deriving suppression itself again");
        }
        return { from: () => ({ where: () => ({ limit: async () => candidates }) }) };
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => [{ affectedRows: 1 }] };
        },
      }),
    },
  };
}

/** Every gate before the suppression check, satisfied, so only it is under test. */
function armGates() {
  vi.stubEnv("VAPI_API_KEY", "canary-key");
  vi.stubEnv("FEATURE_VOICE_RECOVERY", "1");
  vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
  vi.doMock("../../lib/timezoneAssert", () => ({
    getBusinessHour: () => 13,
    getBusinessDateKey: () => "2026-09-16",
  }));
}

describe("voice recovery · suppression gate", () => {
  const placed: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    placed.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // doMocks are NOT file-scoped under singleFork serial mode — drop each one
    // or a later file gets this file's doubles.
    vi.doUnmock("../../lib/timezoneAssert");
    vi.doUnmock("../../services/vapi");
    vi.doUnmock("../../db");
    vi.doUnmock("../../sms");
  });

  /**
   * Partial mocks SPREAD the real module (AGENTS.md §3): a factory returning
   * only what this file imports drops every other export from a registry
   * vitest shares across all files, and the victim is some unrelated suite.
   */
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

  it("POSITIVE CONTROL: a clean index DOES place the call (so 'zero calls' below means something)", async () => {
    armGates();
    mockVapi();
    mockSuppression({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false });
    const rig = fakeDb([CANDIDATE]);
    vi.doMock("../../db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../db")>()),
      getDb: async () => rig.db,
    }));

    const { runVoiceRecovery } = await import("./voiceRecovery");
    const result = await runVoiceRecovery();

    expect(placed).toEqual(["+12165550142"]);
    expect(result.recordsProcessed).toBe(1);
  });

  it("BREAKS: an UNREADABLE index places ZERO calls and REJECTS (the fail-closed pin)", async () => {
    armGates();
    mockVapi();
    mockSuppression({ ok: false, reason: "opt-out index unreadable (canary)" });
    const rig = fakeDb([CANDIDATE]);
    vi.doMock("../../db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../db")>()),
      getDb: async () => rig.db,
    }));

    const { runVoiceRecovery } = await import("./voiceRecovery");
    let message = "";
    try {
      await runVoiceRecovery();
      throw new Error("runVoiceRecovery RESOLVED — the fail-soft catch is back");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    // Rejecting (not returning a soft "skipped") is what makes cron_log record
    // the run as FAILED — a silent 0 is how this would hide for weeks.
    expect(message).toMatch(/suppression index unreadable/);
    // The operator has to be able to see WHICH failure, so the reason travels.
    expect(message).toContain("opt-out index unreadable (canary)");
    // The whole point: nobody was called.
    expect(placed).toEqual([]);
    // And nothing was claimed either — a claim would burn the estimate's
    // one-shot `voice_recovery_attempted_at` on a call that never happened.
    expect(rig.updates).toEqual([]);
  });

  it("BREAKS: a phone the SHARED index knows (e.g. sms_preferences only) is suppressed", async () => {
    armGates();
    mockVapi();
    mockSuppression({
      ok: true,
      phones: new Set([CANDIDATE_LAST10]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });
    const rig = fakeDb([CANDIDATE]);
    vi.doMock("../../db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../db")>()),
      getDb: async () => rig.db,
    }));

    const { runVoiceRecovery } = await import("./voiceRecovery");
    const result = await runVoiceRecovery();

    expect(placed).toEqual([]);
    expect(result.recordsProcessed).toBe(0);
    expect(result.details).toContain("skipped=1");
    // ONE select — the candidate query. A second would mean the job is back to
    // deriving its own (customers-only) opt-out set.
    expect(rig.selectCount).toBe(1);
  });

  it("BREAKS: a STALE index also places ZERO calls — its age is UNBOUNDED, not 5 minutes", async () => {
    armGates();
    mockVapi();
    mockSuppression({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: true });
    const rig = fakeDb([CANDIDATE]);
    vi.doMock("../../db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../db")>()),
      getDb: async () => rig.db,
    }));

    const { runVoiceRecovery } = await import("./voiceRecovery");
    let message = "";
    try {
      await runVoiceRecovery();
      throw new Error("runVoiceRecovery RESOLVED on a stale index — it placed the call");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    // This test asserted the OPPOSITE until Codex's P1 on PR #2361. The reason
    // it was wrong: `stale` is not "5 minutes old" — 5 minutes is the TTL, i.e.
    // the FRESH path. `stale()` in sms.ts hands back `optOutCache` WITHOUT
    // consulting `optOutCacheLoadedAt`, so in this long-lived process a
    // persistent DB fault leaves the set hours or days old, and an opt-out
    // recorded since — especially by another pod — is invisible.
    expect(message).toMatch(/suppression index is STALE/);
    expect(message).toMatch(/age is unbounded/);
    expect(placed).toEqual([]);
    // Nothing claimed either: a claim would burn the one-shot attempt marker.
    expect(rig.updates).toEqual([]);
  });

  it("the refusal is VOICE-ONLY — SMS deliberately keeps the opposite bar", () => {
    // Source assertion, and declared as one: sendSms's tolerance of a stale
    // index is covered by the sms suite, not here. What is pinned is that
    // nobody "consistency-fixes" the asymmetry away without reading why — a
    // text is cheap and reversible, an unwanted phone call is neither.
    const sms = readFileSync(resolve(__dirname, "..", "..", "sms.ts"), "utf8");
    expect(sms).toMatch(/A STALE set is still `ok: true`/);
    const voice = readFileSync(resolve(__dirname, "voiceRecovery.ts"), "utf8");
    expect(voice).toMatch(/Do NOT generalise this to the SMS path/);
  });

  it("CANARY — the OLD fail-soft shape would RESOLVE here, proving the assertions bite", async () => {
    const failSoft = async () => {
      const optOutSet = new Set<string>();
      try {
        throw new Error("opt-out query exploded");
      } catch { /* fail-soft — the deleted behaviour */ }
      // An empty set reads as "nobody opted out", so the candidate is called.
      return { recordsProcessed: optOutSet.has(CANDIDATE_LAST10) ? 0 : 1 };
    };
    await expect(failSoft()).resolves.toEqual({ recordsProcessed: 1 });
  });
});
