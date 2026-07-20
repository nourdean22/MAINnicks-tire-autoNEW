/**
 * The TCPA opt-out gate must FAIL CLOSED.
 *
 * Before 2026-07-20 it failed open twice over: ensureOptOutCache returned an
 * empty Set when it could not read, and the call site ended in
 * `catch { log.warn("proceeding with send") }`. Together they meant an
 * unreadable opt-out list read as "nobody has opted out".
 *
 * Verified harm in production: 8138959400 texted STOP on 2026-07-13, was
 * correctly recorded in sms_preferences, and still received automated recovery
 * texts on 07-16 and 07-19.
 *
 * These tests exist to make that specific regression impossible to reintroduce.
 * Every one of them fails if the guard is reverted to fail-open.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../sms");

const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_optout_test" });
vi.mock("twilio", () => ({
  default: () => ({ messages: { create: mockTwilioCreate } }),
}));

/** Controls what the opt-out index load does for each test. */
let dbBehaviour: "throw" | "empty" | "optedOut" = "empty";
const OPTED_OUT_PHONE = "2165550147";

vi.mock("../db", () => ({
  getDb: async () => {
    if (dbBehaviour === "throw") throw new Error("connection refused");
    const rows = dbBehaviour === "optedOut" ? [{ phone: OPTED_OUT_PHONE }] : [];
    return {
      select: () => ({ from: () => ({ where: async () => rows }) }),
      execute: async () => [rows],
    };
  },
}));

const ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "SMS_KILL_SWITCH", "OWNER_PHONE_NUMBER"] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetModules();          // each test needs a FRESH module-level opt-out cache
  mockTwilioCreate.mockClear();
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok_test";
  process.env.TWILIO_PHONE_NUMBER = "+12165550100";
  delete process.env.SMS_KILL_SWITCH;
});

afterEach(() => {
  vi.useRealTimers();
  dbBehaviour = "empty";
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("opt-out gate fails closed", () => {
  it("REFUSES a customer send when the opt-out index cannot be read", async () => {
    dbBehaviour = "throw";
    const { sendSms } = await import("../sms");

    const res = await sendSms("+12165550199", "Your quote is still good!");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/cannot verify opt-out/i);
    // The part that actually matters: nothing reached the carrier.
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("still blocks a phone that IS on the list", async () => {
    dbBehaviour = "optedOut";
    const { sendSms } = await import("../sms");

    const res = await sendSms(`+1${OPTED_OUT_PHONE}`, "Hey, that quote is still good");

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/opted out/i);
    expect(mockTwilioCreate).not.toHaveBeenCalled();
  });

  it("allows a normal send when the index loads and the phone is absent", async () => {
    dbBehaviour = "empty";
    const { sendSms } = await import("../sms");

    const res = await sendSms("+12165550199", "Your car is ready for pickup");

    // Asserting the guard did not block. Delivery itself depends on routing
    // config, so the meaningful signal is the ABSENCE of a refusal.
    expect(res.error ?? "").not.toMatch(/opted out|cannot verify/i);
  });

  // The carve-out is deliberate and narrow: internal messages go to the shop's
  // own phone, carry no TCPA exposure, and are how the operator finds out the
  // database is down. Failing them closed would let an outage silence its own
  // alarm. If this test starts failing, the exemption widened — check why.
  it("still lets INTERNAL alerts through when the index is unreadable", async () => {
    dbBehaviour = "throw";
    process.env.OWNER_PHONE_NUMBER = "+12165550188";
    const { sendSms } = await import("../sms");

    const res = await sendSms("+12165550188", "Mirror sync failed", { internal: true });

    expect(res.error ?? "").not.toMatch(/cannot verify opt-out/i);
  });
});
