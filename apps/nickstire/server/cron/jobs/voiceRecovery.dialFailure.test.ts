/**
 * Voice recovery · a dial that never reached the customer must not burn the
 * lead, and must not report "completed" (2026-09-22)
 *
 * WHAT WAS WRONG. Every dial this lane ever placed — 110 of 110 since
 * 2026-06-18 — came back from Vapi as
 *   400 "assistantOverrides.model.provider must be one of the following
 *        values: openai, …"
 * (the override was a partial model block; `services/vapi.outboundOverride.test.ts`
 * pins the request shape). The loop then wrote outcome "failed" over the claim
 * it had already taken, so each lead became permanently ineligible without a
 * single ring — and the run RETURNED NORMALLY. cron_log read
 * "completed · placed=0 failed=N" for three months.
 *
 * WHAT THIS SUITE PINS — the DECISION per failure kind, not the SQL. The db is
 * a stub (PR #2356's lesson: greens here say nothing about the query).
 *   · a config / provider / network failure never reached the customer:
 *     the claim is RELEASED, the run REJECTS, and no further dial is tried
 *   · our own "customer" precondition (not E.164-shapeable): the lead is
 *     marked failed and the run CONTINUES to the next
 *   · the reason lands in `details`, so cron_log is diagnosable on its own
 *   · a missing / retired assistant pin skips BEFORE any claim is taken
 *
 * POSITIVE CONTROL FIRST. "No dial" is also what a broken rig prints, so one
 * test proves this rig places a call and marks the lead dialing.
 *
 * SYNTHETIC INPUTS ONLY — 555 numbers, a scripted provider, no network.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

type EstRow = {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  serviceDescription: string | null;
  estimatedAmount: number | null;
};
type DialResult = { success: boolean; callId?: string; error?: string; errorKind?: "config" | "customer" | "provider" | "network" };

/** 555-exchange, i.e. unassignable by NANP — it cannot ring anyone. */
const LEAD_A: EstRow = { id: 90_101, customerName: "Synthetic A", customerPhone: "216-555-0142", serviceDescription: "front brake pads", estimatedAmount: 42_000 };
const LEAD_B: EstRow = { id: 90_102, customerName: "Synthetic B", customerPhone: "216-555-0143", serviceDescription: "wheel bearing", estimatedAmount: 31_000 };
/** Digits that cannot be shaped into E.164 by the lane — trips its own precondition. */
const LEAD_BAD_NUMBER: EstRow = { ...LEAD_A, id: 90_103, customerPhone: "12" };

const PROVIDER_400: DialResult = {
  success: false,
  errorKind: "provider",
  error: 'VAPI /call returned 400: {"message":["assistantOverrides.model.provider must be one of the following values: openai"]}',
};

/** One select (the candidate query) and every update's `set` values, in order. */
function fakeDb(candidates: EstRow[]) {
  let selects = 0;
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    db: {
      select: () => {
        selects += 1;
        if (selects > 1) throw new Error("second select — the job is deriving suppression itself again");
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

const isClaim = (u: Record<string, unknown>) => u.voiceRecoveryOutcome === "pending" && u.voiceRecoveryAttemptedAt instanceof Date;
const isRelease = (u: Record<string, unknown>) => u.voiceRecoveryAttemptedAt === null && u.voiceRecoveryOutcome === null;
const isFailed = (u: Record<string, unknown>) => u.voiceRecoveryOutcome === "failed";
const isDialing = (u: Record<string, unknown>) => u.voiceRecoveryOutcome === "dialing";

describe("voice recovery · dial failures", () => {
  const dialed: string[] = [];
  let script: DialResult[] = [];

  beforeEach(() => {
    vi.resetModules();
    dialed.length = 0;
    script = [];
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

  /** Every gate before the loop, satisfied, so only the loop is under test. */
  function arm(candidates: EstRow[]) {
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("FEATURE_VOICE_RECOVERY", "1");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    vi.doMock("../../lib/timezoneAssert", () => ({
      getBusinessHour: () => 13,
      getBusinessDateKey: () => "2026-09-22",
    }));
    // Partial mocks SPREAD the real module (AGENTS.md §3).
    vi.doMock("../../services/vapi", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../services/vapi")>()),
      resolveVapiPhoneNumberId: async () => "pn_canary",
      placeVapiOutboundCall: async (params: { customerNumber: string }): Promise<DialResult> => {
        dialed.push(params.customerNumber);
        return script.shift() ?? { success: true, callId: `call_${dialed.length}` };
      },
    }));
    vi.doMock("../../sms", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../sms")>()),
      loadSuppressionIndex: async () => ({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false }),
    }));
    const rig = fakeDb(candidates);
    vi.doMock("../../db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../db")>()),
      getDb: async () => rig.db,
    }));
    return rig;
  }

  it("POSITIVE CONTROL: a successful dial claims the lead, marks it dialing and resolves", async () => {
    const rig = arm([LEAD_A]);
    const { runVoiceRecovery } = await import("./voiceRecovery");
    const result = await runVoiceRecovery();
    expect(dialed).toEqual(["+12165550142"]);
    expect(result.recordsProcessed).toBe(1);
    expect(result.details).toBe("placed=1 skipped=0 failed=0");
    expect(rig.updates.some(isClaim)).toBe(true);
    expect(rig.updates.some(isDialing)).toBe(true);
    expect(rig.updates.some(isRelease)).toBe(false);
  });

  it("BREAKS: the provider rejects the request → claim RELEASED, run REJECTS, second lead untouched", async () => {
    const rig = arm([LEAD_A, LEAD_B]);
    script = [PROVIDER_400];
    const { runVoiceRecovery } = await import("./voiceRecovery");
    await expect(runVoiceRecovery()).rejects.toThrow(/aborted after 0 placed.*\(provider\).*estimate 90101.*model\.provider must be one of/);
    // One dial, one claim, one release — and NOT a "failed" mark: the lead
    // stays eligible for the next run.
    expect(dialed).toEqual(["+12165550142"]);
    expect(rig.updates.filter(isClaim)).toHaveLength(1);
    expect(rig.updates.filter(isRelease)).toHaveLength(1);
    expect(rig.updates.some(isFailed)).toBe(false);
  });

  it("BREAKS: a config failure and a network failure are the same class (released + rejected)", async () => {
    for (const kind of ["config", "network"] as const) {
      vi.resetModules();
      dialed.length = 0;
      const rig = arm([LEAD_A, LEAD_B]);
      script = [{ success: false, errorKind: kind, error: `${kind} (canary)` }];
      const { runVoiceRecovery } = await import("./voiceRecovery");
      await expect(runVoiceRecovery()).rejects.toThrow(`dial failed (${kind})`);
      expect(dialed).toHaveLength(1);
      expect(rig.updates.filter(isRelease)).toHaveLength(1);
      expect(rig.updates.some(isFailed)).toBe(false);
      vi.doUnmock("../../lib/timezoneAssert");
      vi.doUnmock("../../services/vapi");
      vi.doUnmock("../../db");
      vi.doUnmock("../../sms");
    }
  });

  it("our own 'customer' precondition marks the lead failed and CONTINUES — the next lead is still dialed", async () => {
    const rig = arm([LEAD_BAD_NUMBER, LEAD_B]);
    script = [{ success: false, errorKind: "customer", error: "Invalid customerNumber: not E.164 (shape +##)" }];
    const { runVoiceRecovery } = await import("./voiceRecovery");
    const result = await runVoiceRecovery();
    expect(dialed).toHaveLength(2);
    expect(result.recordsProcessed).toBe(1);
    expect(result.details).toBe("placed=1 skipped=0 failed=1 · last error: Invalid customerNumber: not E.164 (shape +##)");
    expect(rig.updates.filter(isFailed)).toHaveLength(1);
    expect(rig.updates.some(isRelease)).toBe(false);
  }, 10_000);

  it("an unknown failure kind (a caller that forgot to classify) is treated as NOT about this customer — released, not burned", async () => {
    const rig = arm([LEAD_A]);
    script = [{ success: false, error: "unclassified (canary)" }];
    const { runVoiceRecovery } = await import("./voiceRecovery");
    await expect(runVoiceRecovery()).rejects.toThrow("dial failed (unknown)");
    expect(rig.updates.filter(isRelease)).toHaveLength(1);
    expect(rig.updates.some(isFailed)).toBe(false);
  });

  it("a missing assistant pin skips BEFORE any claim is taken", async () => {
    const rig = arm([LEAD_A]);
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "");
    const { runVoiceRecovery } = await import("./voiceRecovery");
    const result = await runVoiceRecovery();
    expect(result).toEqual({ recordsProcessed: 0, details: "Skipped · VAPI_FOLLOWUP_ASSISTANT_ID missing or retired" });
    expect(dialed).toEqual([]);
    expect(rig.updates).toEqual([]);
  });
});
