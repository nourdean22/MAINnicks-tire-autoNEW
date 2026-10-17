/**
 * The manual follow-up call tells the operator, in plain words, that a send
 * pause held it (C5.5 round 2). Round 1 returned the raw hold code
 * ("send_pause:voice_outbound") to the UI. The code stays in the server log.
 * fetch is stubbed to throw: a hold must stop before the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ reason: null as string | null, fetchReached: false }));

vi.mock("./services/sendPause", () => ({ sendPauseHoldReason: async () => h.reason }));

function adminContext() {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin User", loginMethod: "manus",
      role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  h.reason = null;
  h.fetchReached = false;
  vi.stubEnv("VAPI_API_KEY", "canary-key");
  vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
  vi.stubGlobal("fetch", async () => {
    h.fetchReached = true;
    throw new Error("fetch reached");
  });
  vi.doMock("./sms", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./sms")>()),
    loadSuppressionIndex: async () => ({ ok: true, phones: new Set<string>(), carrierBlocked: new Set<string>(), stale: false }),
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("./sms");
});

const call = async () => {
  const { appRouter } = await import("./routers");
  return appRouter.createCaller(adminContext()).vapi.makeFollowUpCall({
    customerName: "Synthetic Operator Probe",
    phone: "2165550188",
    lastService: "four used tires",
  });
};

describe("makeFollowUpCall · send pause in plain words", () => {
  it("paused -> 'Outbound calls are paused in Settings', no raw code, no network", async () => {
    h.reason = "send_pause:voice_outbound";
    const r = await call();
    expect(r.success).toBe(false);
    expect(r.error).toBe("Outbound calls are paused in Settings.");
    expect(h.fetchReached).toBe(false);
  });

  it("unreadable (an explicit unreadable hold) -> says the pause switch could not be read", async () => {
    h.reason = "send_pause_unreadable:voice_outbound";
    const r = await call();
    expect(r.success).toBe(false);
    expect(r.error).toBe("Outbound calls are held: the pause switch could not be read. Try again in a minute.");
    expect(h.fetchReached).toBe(false);
  });

  it("CONTROL: not held -> the dial proceeds to the network", async () => {
    const r = await call().catch((e: unknown) => ({ success: false, error: String(e) }));
    expect(h.fetchReached).toBe(true);
    expect(r.error ?? "").not.toMatch(/paused in Settings/);
  });
});
