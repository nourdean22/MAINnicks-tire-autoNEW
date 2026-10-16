/**
 * Telegram alert diet · a failed shop SMS does not buzz Nour's phone per message.
 *
 * Before: sendSms alerted on every gateway failure or timeout ("falling back to
 * Twilio" -- false, Twilio is intentionally off), and the gateway's own sms:failed
 * webhook alerted again per message. The outage is already covered once per
 * incident by smsGatewayHealthMonitor (cron) and the stuck-queue alert in sms.ts,
 * so the per-message sends are noise. The outcome for the caller is unchanged.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ telegram: vi.fn(async (_text: string) => true) }));

vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegram: (text: string) => h.telegram(text),
  sendTelegramMessage: (text: string) => h.telegram(text),
}));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => null,
}));

import { sendSms } from "./sms";
import { smsGatewayWebhookRouter } from "./routes/webhooks/smsGateway";

const ENV_KEYS = ["SHOP_SMS_GATEWAY_USERNAME", "SHOP_SMS_GATEWAY_PASSWORD", "SHOP_SMS_GATEWAY_WEBHOOK_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sendSms · shop gateway failure", () => {
  beforeEach(() => {
    h.telegram.mockClear();
    process.env.SHOP_SMS_GATEWAY_USERNAME = "shop";
    process.env.SHOP_SMS_GATEWAY_PASSWORD = "test-password";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = () =>
    sendSms("+12165550142", "Your tires are ready.", {
      via: "shop",
      _forceImmediate: true,
      messageClass: "internal",
      isInternal: true,
      skipPersist: true,
    });

  it("a non-OK gateway response sends no Telegram message and still reports the failure", async () => {
    vi.stubGlobal("fetch", async () => new Response("relay error", { status: 502 }));
    const res = await send();
    await vi.dynamicImportSettled();
    expect(res.success).toBe(false);
    expect(h.telegram).not.toHaveBeenCalled();
  });

  it("a gateway timeout sends no Telegram message and still reports uncertain delivery", async () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const res = await send();
    await vi.dynamicImportSettled();
    expect(res).toMatchObject({ success: true, uncertain: true });
    expect(h.telegram).not.toHaveBeenCalled();
  });
});

describe("sms-gateway webhook · sms:failed", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    delete process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET;
    const app = express();
    app.use(express.json());
    app.use("/api/webhooks", smsGatewayWebhookRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  function post(body: Record<string, unknown>): Promise<number> {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/webhooks/sms-gateway",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }

  it("acks a failed-delivery receipt without sending a Telegram message", async () => {
    h.telegram.mockClear();
    const status = await post({
      event: "sms:failed",
      id: "evt-fail-1",
      payload: { messageId: "gw-msg-fail-1", phoneNumber: "+12165550142", reason: "no signal" },
    });
    await new Promise((r) => setTimeout(r, 50));
    await vi.dynamicImportSettled();
    expect(status).toBe(200);
    expect(h.telegram).not.toHaveBeenCalled();
  });
});

describe("the outage is still alerted, once per incident, by the health monitor", () => {
  it("two stale check-ins in a row send one offline alert", async () => {
    process.env.SHOP_SMS_GATEWAY_USERNAME = "shop";
    process.env.SHOP_SMS_GATEWAY_PASSWORD = "test-password";
    delete process.env.SHOP_SMS_GATEWAY_DEVICE_ID;
    h.telegram.mockClear();
    const stale = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify([{ id: "f25e", lastSeen: stale }])));
    const { runSmsGatewayHealthMonitor } = await import("./cron/jobs/smsGatewayHealthMonitor");
    await runSmsGatewayHealthMonitor();
    await runSmsGatewayHealthMonitor();
    vi.unstubAllGlobals();
    expect(h.telegram).toHaveBeenCalledTimes(1);
    expect(h.telegram.mock.calls[0][0]).toContain("SHOP SMS GATEWAY OFFLINE");
  });
});
