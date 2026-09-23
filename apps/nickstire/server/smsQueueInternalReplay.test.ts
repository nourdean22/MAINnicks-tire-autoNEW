/**
 * A queued text to an INTERNAL line survives a restart and is not held for
 * quiet hours (server/lib/smsQueueReplay.ts has the why).
 *
 * The defect (found 2026-09-23 auditing the careers owner alert): a durable
 * sms_messages row keeps the body, not the send options. After a restart the
 * drain replayed an owner alert with no messageClass, sendSms's internal-line
 * guard refused it, and after MAX_SEND_ATTEMPTS the row was dead-lettered.
 * The drain also held every queued row until 8 AM, internal ones included.
 *
 * These drive the REAL queue: rows come back through rehydrateQueuedFromDb,
 * the real 60 s drain timer fires, and each row goes through the real sendSms.
 * No transport is configured, so every send ends "not configured" — what is
 * observed is whether the internal-line guard refused the replay
 * (getSmsStats().internalLineRefused) and which rows the drain took out of
 * the queue (delayedQueueSize).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { OPERATOR_MOBILE_LAST10 } from "./services/nonCustomerFilter";

vi.unmock("./sms");

let pendingRows: Array<{ id: number; body: string; phone: string }> = [];

/** Awaitable chain: any method returns the chain, awaiting it yields `result`. */
function chain(result: unknown): unknown {
  const target = function () {};
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return () => chain(result);
    },
    apply: () => chain(result),
  });
}

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) =>
        getTableName(table) === "sms_messages"
          ? { innerJoin: () => ({ where: () => ({ limit: async () => pendingRows }) }), where: () => chain([]) }
          : chain([]),
    }),
    update: () => chain([{ affectedRows: 1 }, []]),
    insert: () => chain([{ id: 1 }]),
    execute: async () => [[], []],
  }),
}));

vi.mock("./services/smsControl", () => ({
  getSmsPauseState: async () => ({ readable: true, paused: false, reason: null }),
}));

const TRANSPORT_ENV = [
  "SHOP_SMS_GATEWAY_USERNAME",
  "SHOP_SMS_GATEWAY_PASSWORD",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "OWNER_PHONE_NUMBER",
  "ADMIN_PHONE",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.resetModules();
  pendingRows = [];
  for (const k of TRANSPORT_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(async () => {
  const sms = await import("./sms");
  sms.stopDelayedQueueProcessor();
  vi.useRealTimers();
  for (const k of TRANSPORT_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

/** Rehydrate the rows, then let the real 60 s drain timer fire once. */
async function rehydrateThenDrainOnce(utcNow: string, expectQueueAfter: number) {
  vi.useFakeTimers({ now: new Date(utcNow), toFake: ["Date", "setInterval", "clearInterval"] });
  const sms = await import("./sms");
  expect(await sms.rehydrateQueuedFromDb()).toBe(pendingRows.length);
  sms.startDelayedQueueProcessor();
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => expect(sms.getSmsStats().delayedQueueSize).toBe(expectQueueAfter), { timeout: 5_000 });
  return sms.getSmsStats();
}

describe("queued owner alert, replayed after a restart", () => {
  it("in sending hours: the replay passes the internal-line guard instead of being refused", async () => {
    pendingRows = [{ id: 41, body: "NEW CAREERS LEAD: test", phone: OPERATOR_MOBILE_LAST10 }];
    // 14:00Z = 10:00 America/New_York (EDT)
    const stats = await rehydrateThenDrainOnce("2026-09-23T14:00:00Z", 0);
    expect(stats.internalLineRefused).toBe(0);
  });

  it("at 2 AM: the internal row drains, a customer row stays held until 8 AM", async () => {
    pendingRows = [
      { id: 51, body: "NEW CAREERS LEAD: night", phone: OPERATOR_MOBILE_LAST10 },
      { id: 52, body: "customer reminder", phone: "2165550152" },
    ];
    // 06:00Z = 02:00 America/New_York (EDT)
    const stats = await rehydrateThenDrainOnce("2026-09-23T06:00:00Z", 1);
    expect(stats.internalLineRefused).toBe(0);
  });
});
