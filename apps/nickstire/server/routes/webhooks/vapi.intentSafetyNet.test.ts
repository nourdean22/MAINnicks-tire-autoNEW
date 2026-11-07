/**
 * Close-on-intent safety net through the REAL end-of-call route (2026-11-07 audit
 * section 3). Fixture call with tire intent and no closing tool -> one COMING IN text
 * to the on-duty manager marked "not booked by the assistant"; the same call with
 * bookSlot -> no text; a webhook retry (duplicate insert) -> no second text.
 *
 * DB-free: getDb is a chain fake, db-helper is null, the claim table is a Set.
 * Date only is faked (Wednesday 2026-11-04 11:00 America/New_York, shop open).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { intentNoToolEvent, intentWithBookSlotEvent } from "../../../tests/fixtures/endOfCallIntent";

const h = vi.hoisted(() => ({
  textOnDutyManager: vi.fn(async (_body: string) => ({ status: "sent" as const })),
  orchestrateSms: vi.fn(async (e: { type: string }) => { h.orchestrated.push(e.type); return { status: "sent" }; }),
  claims: new Set<string>(),
  insertFails: false,
  smsHistory: null as null | Record<string, unknown>,
  orchestrated: [] as string[],
}));

function chain(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get(_t, k) {
      if (k === "then") return (res: (v: unknown) => void) => res([]);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}

vi.mock("../../db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: () => {
        const p: Promise<unknown> = h.insertFails ? Promise.reject(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY", errno: 1062 })) : Promise.resolve([{ insertId: 1 }]);
        return p;
      },
    }),
    select: () => chain(),
    update: () => chain(),
    execute: async (q: { queryChunks?: unknown[] }) => {
      const text = JSON.stringify(q?.queryChunks ?? "");
      return text.includes("FROM sms_conversations") ? [[h.smsHistory ?? {}], []] : [[], []];
    },
  }),
}));
vi.mock("../../lib/db-helper", () => ({ db: async () => null }));
vi.mock("../../services/voice-call-state", () => ({
  recordCallState: vi.fn(async () => {}),
  classifyToolToState: () => null,
  getCallStateHistory: vi.fn(async () => []),
}));
vi.mock("../../services/featureFlags", async (orig) => ({ ...(await orig<object>()), isEnabled: vi.fn(async () => false) }));
vi.mock("../../services/eventBus", async (orig) => ({ ...(await orig<object>()), textOnDutyManager: h.textOnDutyManager }));
vi.mock("../../services/smsOrchestrator", async (orig) => ({ ...(await orig<object>()), orchestrateSms: h.orchestrateSms }));
vi.mock("../../services/alertClaim", async (orig) => ({
  ...(await orig<object>()),
  sendOncePerState: async (key: string, send: () => Promise<unknown>) => {
    if (h.claims.has(key)) return null;
    h.claims.add(key);
    return send();
  },
}));

import { vapiWebhookRouter } from "./vapi";
import { detachedWork } from "../../_core/gracefulShutdown";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
  savedSecret = process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  const app = express();
  app.use("/api/webhooks", vapiWebhookRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await detachedWork.settled();
  if (savedSecret !== undefined) process.env.VAPI_WEBHOOK_SECRET = savedSecret;
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T11:00:00-05:00")); // Wednesday, America/New_York, open
  h.textOnDutyManager.mockClear();
  h.claims.clear();
  h.insertFails = false;
  h.smsHistory = null;
  h.orchestrated = [];
});
afterEach(() => vi.useRealTimers());

function postEvent(message: Record<string, unknown>): Promise<number> {
  const payload = JSON.stringify({ message });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/webhooks/vapi", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
      (res) => { res.resume(); res.on("end", () => resolve(res.statusCode ?? 0)); },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function deliver(message: Record<string, unknown>) {
  expect(await postEvent(message)).toBe(200);
  await detachedWork.settled();
}

describe("end-of-call safety net: intent with no closing tool texts the counter", () => {
  it("tire intent, no bookSlot or sendConfirmationSms -> one ASKED, NOT BOOKED text to the counter", async () => {
    await deliver(intentNoToolEvent());
    expect(h.textOnDutyManager).toHaveBeenCalledTimes(1);
    const body = h.textOnDutyManager.mock.calls[0]![0];
    expect(body.split("\n")[0]).toBe("ASKED, NOT BOOKED (phone)");
    expect(body).toContain("Name not given - (216) 555-0147");
    expect(body).toMatch(/For: .*used tires/i);
    expect(body).toContain("Not booked by the assistant");
    expect(h.claims).toEqual(new Set(["voice-arrival:call-fixture-intent-no-tool"]));
  });

  it("the same call with bookSlot sends nothing", async () => {
    await deliver(intentWithBookSlotEvent());
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
  });

  it("a webhook retry (duplicate log insert) sends nothing", async () => {
    h.insertFails = true;
    await deliver(intentNoToolEvent("call-fixture-retry"));
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
  });

  it("after hours sends nothing (no 2 AM text to the on-duty manager)", async () => {
    vi.setSystemTime(new Date("2026-11-04T23:30:00-05:00"));
    await deliver(intentNoToolEvent("call-fixture-night"));
    expect(h.textOnDutyManager).not.toHaveBeenCalled();
  });
});

describe("forwarded-call follow-up text: one per phone per 14 days", () => {
  const forwarded = (callId: string) => ({ ...intentNoToolEvent(callId), endedReason: "assistant-forwarded-call" });

  it("positive control: no earlier follow-up -> the text goes out", async () => {
    await deliver(forwarded("call-fixture-fwd-fresh"));
    expect(h.orchestrated).toEqual(["vapi_forwarded_call_followup"]);
  });

  it("a follow-up 5 days ago -> no second text", async () => {
    h.smsHistory = { lastSendAt: new Date("2026-10-30T11:00:00-04:00"), anyOpen: 0 };
    await deliver(forwarded("call-fixture-fwd-repeat"));
    expect(h.orchestrated).toEqual([]);
  });

  it("the customer's own text is waiting on us -> no automated text over it", async () => {
    h.smsHistory = { anyOpen: 1, lastInboundAt: new Date("2026-11-04T10:30:00-05:00"), lastOutboundAt: new Date("2026-11-03T09:00:00-05:00") };
    await deliver(forwarded("call-fixture-fwd-awaiting"));
    expect(h.orchestrated).toEqual([]);
  });
});
