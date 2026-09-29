/**
 * PROTECTED-CORE rule 5 · the send path never logs a customer's phone.
 *
 * A drizzle query error's message is the SQL AND its bound params. Two send-path
 * catches logged `err.message` of a query that binds the phone: the per-number
 * daily-limit upsert and the delayed-queue persist. Both must log only the
 * driver class/code (describeDbError). Raised in the orchestrator review of #2785.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("../sms");

const PHONE = "2165550177";

const h = vi.hoisted(() => ({ logged: [] as unknown[] }));

vi.mock("../lib/logger", () => {
  const rec = (...a: unknown[]) => { h.logged.push(a); };
  const logger = { info: rec, warn: rec, error: rec, debug: rec };
  return { createLogger: () => logger, logger };
});

class DrizzleQueryError extends Error {}
const boom = () =>
  new DrizzleQueryError(`Failed query: INSERT INTO sms_rate_limit (...) VALUES (?)\nparams: +1${PHONE}`);

vi.mock("../services/complianceLog", () => ({
  getSmsOptInIndex: vi.fn(async () => ({ ok: true, phones: new Set([PHONE]), stale: false })),
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
  insert: () => ({ values: () => ({ $returningId: async () => { throw boom(); } }) }),
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  // Only the per-number rate-limit upsert fails; every other raw read succeeds.
  execute: async (q: { queryChunks?: Array<{ value?: string[] }> }) => {
    const text = (q.queryChunks ?? []).map((c) => (Array.isArray(c.value) ? c.value.join("") : "")).join("");
    if (/sms_rate_limit/.test(text)) throw boom();
    return [[]];
  },
};
vi.mock("../db", () => ({
  getDb: async () => dbHandle,
  getDbTyped: async () => dbHandle,
  getOrCreateConversation: async () => ({ id: 1 }),
  addSmsMessage: async () => undefined,
}));
const mockTwilioCreate = vi.fn().mockResolvedValue({ sid: "SM_nophone" });
vi.mock("twilio", () => ({ default: () => ({ messages: { create: mockTwilioCreate } }) }));

const ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD"] as const;
const ORIG: Record<string, string | undefined> = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  h.logged = [];
  mockTwilioCreate.mockClear();
  delete process.env.SHOP_SMS_GATEWAY_USERNAME;
  delete process.env.SHOP_SMS_GATEWAY_PASSWORD;
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "tok_test";
  process.env.TWILIO_PHONE_NUMBER = "+12165550100";
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    const v = ORIG[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function loggedText(): string {
  return JSON.stringify(h.logged, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v));
}

describe("send-path DB errors never put the phone in the logs", () => {
  it("daily-limit upsert failure (fail-open) logs the driver class, not the params", async () => {
    vi.setSystemTime(new Date("2026-09-29T16:00:00.000Z")); // noon ET
    const { sendSms } = await import("../sms");
    const res = await sendSms(`+1${PHONE}`, "Your car is ready", { via: "twilio", messageClass: "customer_confirmation" });
    expect(res.success).toBe(true);
    const text = loggedText();
    expect(text).toContain("SMS_DAILY_LIMIT_QUERY_ERROR");
    expect(text).toContain("DrizzleQueryError");
    expect(text).not.toContain(PHONE);
  });

  it("delayed-queue persist failure logs the driver class, not the params", async () => {
    vi.setSystemTime(new Date("2026-09-30T03:00:00.000Z")); // 11 PM ET: marketing queues
    const { sendSms } = await import("../sms");
    const res = await sendSms(`+1${PHONE}`, "Tire sale this week", { via: "twilio", messageClass: "customer_marketing" });
    expect(res.queued).toBe(true);
    await vi.waitFor(() => expect(loggedText()).toContain("Failed to persist delayed SMS to DB"));
    const text = loggedText();
    expect(text).toContain("DrizzleQueryError");
    expect(text).not.toContain(PHONE);
  });
});
