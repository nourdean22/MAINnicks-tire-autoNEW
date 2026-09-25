/**
 * The OPERATOR-TRIGGERED dial refuses a suppressed number, and SAYS WHY.
 *
 * `makeFollowUpCall` in `server/routers/vapi.ts` was the FOURTH outbound voice
 * lane, and the one my own sweep missed on 2026-09-16 — it POSTs straight to
 * `https://api.vapi.ai/call` with a raw `fetch`, so a guard keyed on the
 * `placeVapiOutboundCall(` helper and scoped to `server/cron/jobs` could not see
 * it. Found by sweeping the PROVIDER instead of the helper.
 *
 * WHY ITS CONTRACT DIFFERS FROM THE CRONS. A cron skips a suppressed number
 * silently: there is nobody to tell. Here an operator pressed a button and is
 * waiting, so the procedure REFUSES and returns a reason. Silently returning
 * success-with-no-call would read as a broken button and get pressed again;
 * silently returning nothing would be worse.
 *
 * Gated on the operator's 2026-09-16 instruction, "i need the opt outs to work
 * too email, txt". Being human-initiated is not a consent defence — TCPA does
 * not care who pressed the button, and this dials an AI voice.
 *
 * ⚠ These tests assert the REFUSAL, which happens BEFORE any network call. The
 * happy path is deliberately not exercised: it would require a live VAPI dial,
 * and a test that places real phone calls is not a test. What the suite proves
 * is that a suppressed number, an unreadable index and a stale index each stop
 * the procedure before it reaches `fetch`, with `fetch` stubbed to throw so a
 * regression that lets it through fails LOUDLY rather than silently dialling.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const SUPPRESSED = "2165550177";
const CLEAN = "2165550188";

function adminContext() {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

/**
 * Set by the fetch stub. Since Q-45 the procedure dials through
 * placeVapiOutboundCall, which CATCHES network failures and returns them, so a
 * rejection is no longer the only sign the network was reached — the flag is.
 */
let fetchReached = false;

describe("makeFollowUpCall · the operator-triggered dial honours the opt-out index", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    // If a regression ever lets execution past the guard, this makes it fail
    // LOUDLY instead of quietly placing a real call.
    fetchReached = false;
    vi.stubGlobal("fetch", async () => {
      fetchReached = true;
      throw new Error("fetch reached — the suppression guard did NOT stop the dial");
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // doMocks are NOT file-scoped under singleFork serial mode.
    vi.doUnmock("./sms");
  });

  /** Partial mock SPREADS the real module (AGENTS.md §3). */
  const mockSuppression = (index: unknown) =>
    vi.doMock("./sms", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./sms")>()),
      loadSuppressionIndex: async () => index,
    }));

  const call = async (phone: string) => {
    const { appRouter } = await import("./routers");
    return appRouter.createCaller(adminContext()).vapi.makeFollowUpCall({
      customerName: "Synthetic Operator Probe",
      phone,
      lastService: "four used tires",
    });
  };

  it("BREAKS: a SUPPRESSED number is refused, with a reason the operator can act on", async () => {
    mockSuppression({
      ok: true,
      phones: new Set([SUPPRESSED]),
      carrierBlocked: new Set<string>(),
      stale: false,
    });

    const r = await call(SUPPRESSED);

    expect(r.success).toBe(false);
    // The operator has to understand WHY, or they press it again.
    expect(r.error).toMatch(/opted out/i);
    // And the message names the number so they know which one.
    expect(r.error).toContain("0177");
  });

  it("BREAKS: an UNREADABLE index is refused rather than risked", async () => {
    mockSuppression({ ok: false, reason: "opt-out index unreadable (canary)" });

    const r = await call(CLEAN);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/opt-out list could not be read/i);
    expect(r.error).toContain("opt-out index unreadable (canary)");
  });

  it("BREAKS: a STALE index is refused — its age is UNBOUNDED, not the 5-minute TTL", async () => {
    mockSuppression({
      ok: true,
      phones: new Set<string>(),
      carrierBlocked: new Set<string>(),
      stale: true,
    });

    const r = await call(CLEAN);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/last refresh FAILED/i);
    expect(r.error).toMatch(/unbounded/i);
  });

  it("the guard runs BEFORE the network — proved by the throwing fetch stub", async () => {
    // A clean index means the procedure proceeds, reaches the stubbed fetch and
    // fails on it. That is the POSITIVE CONTROL for the three refusals above:
    // without it they are all satisfiable by a procedure that never runs (a
    // missing env var, a thrown import, a changed input schema).
    mockSuppression({
      ok: true,
      phones: new Set<string>(),
      carrierBlocked: new Set<string>(),
      stale: false,
    });

    // Reaching the stub THROWS, and the procedure does not catch it, so this
    // rejects. The rejection IS the proof: execution got past the suppression
    // block and into the network layer.
    let reached = false;
    let refusal: string | null = null;
    try {
      const r = await call(CLEAN);
      refusal = r.error ?? "(returned success)";
    } catch (err) {
      reached = /fetch reached/.test(err instanceof Error ? err.message : String(err));
    }
    reached = reached || fetchReached;

    expect(
      reached,
      `a clean index must NOT be refused — the procedure returned instead of dialling: ${refusal}`,
    ).toBe(true);
  });
});
