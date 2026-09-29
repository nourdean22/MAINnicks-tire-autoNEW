/**
 * Q-21 no-contact holdout at the sendSms chokepoint (PROTECTED CORE).
 *
 * What is pinned here is the MECHANISM, not merely that a send happened:
 *   - flags OFF: a tagged marketing send behaves exactly like an untagged one
 *     (the real contactExperiment runs; only featureFlags is mocked)
 *   - a stored CONTROL never reaches the provider — no Twilio call, no gateway
 *     fetch — and returns heldOut with the cohort id
 *   - each exemption holds even when the experiment would say control:
 *     non-marketing classes, internal sends, `_forceImmediate` queue replays
 *     and human-initiated sends never consult the experiment at all
 *
 * Mutation receipts (PR body): reducing the guard in sms.ts to just
 * `opts?.variantKey` turns the exemption tests red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../sms");

const h = vi.hoisted(() => ({
  flags: new Set<string>(),
  // null = run the REAL resolveContactExperiment; otherwise a fixed decision.
  decision: null as null | Record<string, unknown>,
  resolveCalls: [] as Array<[string, string | null | undefined]>,
}));

vi.mock("../services/featureFlags", () => ({
  isEnabled: vi.fn(async (key: string) => h.flags.has(key)),
}));

vi.mock("../services/contactExperiment", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/contactExperiment")>();
  return {
    ...real,
    resolveContactExperiment: vi.fn(async (phone: string, variantKey: string | null | undefined) => {
      h.resolveCalls.push([phone, variantKey]);
      if (h.decision) return h.decision;
      return real.resolveContactExperiment(phone, variantKey);
    }),
  };
});

// Consent ledger: the test phone is consented, so shadow/enforce never matters.
vi.mock("../services/complianceLog", () => ({
  getSmsOptInIndex: vi.fn(async () => ({ ok: true, phones: new Set(["2165550142", "2165550143"]), stale: false })),
}));

vi.mock("../services/smsControl", () => ({
  getSmsPauseState: vi.fn(async () => ({ paused: false, readable: true })),
  checkGlobalDailyCap: vi.fn(async () => ({ allowed: true, count: 0, cap: 200, readable: true })),
  isPhoneHumanHeld: vi.fn(async () => false),
  SMS_GLOBAL_PAUSE_FLAG: "sms_global_pause",
}));

const dbHandle = {
  select: () => ({
    from: () => ({
      where: () => Object.assign(Promise.resolve([] as unknown[]), { limit: async () => [] }),
    }),
  }),
  insert: () => ({ values: () => ({ $returningId: async () => [{ id: 777 }] }) }),
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  execute: async () => [[]],
};
vi.mock("../db", () => ({
  getDb: async () => dbHandle,
  getDbTyped: async () => dbHandle,
  getOrCreateConversation: async () => ({ id: 1 }),
  addSmsMessage: async () => undefined,
}));

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_holdout_test" });
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockTwilioCreate } }),
}));

const CUSTOMER = "+12165550142";
// A second consented number: the per-number daily limit refuses a 2nd send to one phone.
const CUSTOMER_2 = "+12165550143";
const CONTROL = {
  eligible: true,
  armed: true,
  measurable: true,
  laneKey: "winback",
  experimentId: "contact:winback:v1",
  armId: "control",
  reason: "existing_durable_assignment",
};

const ENV_KEYS = [
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD", "SMS_KILL_SWITCH",
  "SMS_CONSENT_GATE", "OWNER_PHONE_NUMBER", "ADMIN_PHONE",
] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  // Weekday noon ET — inside the 8AM-8PM window.
  vi.setSystemTime(new Date("2026-09-29T16:00:00.000Z"));
  h.flags = new Set();
  h.decision = null;
  h.resolveCalls = [];
  mockTwilioCreate.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  for (const k of ["SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD", "SMS_KILL_SWITCH", "SMS_CONSENT_GATE", "OWNER_PHONE_NUMBER", "ADMIN_PHONE"]) {
    delete process.env[k];
  }
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok_test";
  process.env.TWILIO_PHONE_NUMBER = "+12165550100";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("flags OFF · behaviour is unchanged", () => {
  it("a tagged winback send reaches the provider exactly like an untagged one", async () => {
    const { sendSms, getSmsStats } = await import("../sms");
    const before = getSmsStats().heldOutByExperiment;

    const untagged = await sendSms(CUSTOMER, "We miss you", { via: "twilio" });
    const tagged = await sendSms(CUSTOMER_2, "We miss you", { via: "twilio", variantKey: "winback" });

    expect(untagged.success).toBe(true);
    expect(tagged).toEqual(untagged);
    expect(tagged.heldOut).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(2);
    expect(getSmsStats().heldOutByExperiment).toBe(before);
    // The real service ran and stopped at the master flag.
    expect(h.resolveCalls).toHaveLength(1);
  });

  it("master ON but lane flag OFF still sends", async () => {
    h.flags = new Set(["contact_holdouts_enabled"]);
    const { sendSms } = await import("../sms");
    const res = await sendSms(CUSTOMER, "We miss you", { via: "twilio", variantKey: "winback" });
    expect(res.success).toBe(true);
    expect(res.heldOut).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });
});

describe("a stored CONTROL never reaches the gateway", () => {
  it("returns heldOut with the cohort id and calls neither Twilio nor the shop gateway", async () => {
    h.decision = CONTROL;
    process.env.SHOP_SMS_GATEWAY_USERNAME = "gw_user";
    process.env.SHOP_SMS_GATEWAY_PASSWORD = "gw_pass";
    const { sendSms, getSmsStats } = await import("../sms");
    const before = getSmsStats().heldOutByExperiment;

    const res = await sendSms(CUSTOMER, "We miss you", { via: "shop", variantKey: "winback" });

    expect(res).toMatchObject({
      success: true,
      heldOut: true,
      experimentId: "contact:winback:v1",
      experimentLane: "winback",
    });
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getSmsStats().heldOutByExperiment).toBe(before + 1);
  });

  it("an UNMEASURABLE control (assignment not durable) is sent, never withheld", async () => {
    h.decision = { ...CONTROL, measurable: false };
    const { sendSms } = await import("../sms");
    const res = await sendSms(CUSTOMER, "We miss you", { via: "twilio", variantKey: "winback" });
    expect(res.heldOut).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
  });
});

describe("exemptions hold even when the experiment says CONTROL", () => {
  beforeEach(() => {
    h.decision = CONTROL;
  });

  it.each(["customer_followup", "customer_confirmation"] as const)(
    "non-marketing class %s is sent and never consults the experiment",
    async (messageClass) => {
      const { sendSms } = await import("../sms");
      const res = await sendSms(CUSTOMER, "Your car is ready", { via: "twilio", messageClass, variantKey: "winback" });
      expect(res.heldOut).toBeUndefined();
      expect(res.success).toBe(true);
      expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
      expect(h.resolveCalls).toHaveLength(0);
    },
  );

  it("an internal send is never held out", async () => {
    const { sendSms } = await import("../sms");
    const res = await sendSms(CUSTOMER, "Ops note", {
      via: "twilio",
      messageClass: "customer_marketing",
      isInternal: true,
      variantKey: "winback",
    });
    expect(res.heldOut).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(h.resolveCalls).toHaveLength(0);
  });

  it("a `_forceImmediate` queue replay is never re-randomised or withheld", async () => {
    // The treatment was decided when the message was queued; the drain must
    // deliver it, not flip it into a control on replay.
    const { sendSms } = await import("../sms");
    const res = await sendSms(CUSTOMER, "We miss you", {
      via: "twilio",
      variantKey: "winback",
      _forceImmediate: true,
    });
    expect(res.heldOut).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(h.resolveCalls).toHaveLength(0);
  });

  it("a human-initiated send is never held out", async () => {
    const { sendSms } = await import("../sms");
    const res = await sendSms(CUSTOMER, "Hi, it's Nick", {
      via: "twilio",
      variantKey: "winback",
      humanInitiated: true,
    });
    expect(res.heldOut).toBeUndefined();
    expect(mockTwilioCreate).toHaveBeenCalledTimes(1);
    expect(h.resolveCalls).toHaveLength(0);
  });

  it("control: the same send WITHOUT an exemption is held out (proves the mock decision is live)", async () => {
    const { sendSms } = await import("../sms");
    const res = await sendSms(CUSTOMER, "We miss you", { via: "twilio", variantKey: "winback" });
    expect(res.heldOut).toBe(true);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
    expect(h.resolveCalls).toHaveLength(1);
  });
});
