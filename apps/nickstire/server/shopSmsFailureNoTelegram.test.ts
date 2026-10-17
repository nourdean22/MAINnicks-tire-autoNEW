/**
 * Telegram alert diet · a failed shop SMS does not buzz Nour's phone per message.
 *
 * Before: sendSms alerted on every gateway failure or timeout ("falling back to
 * Twilio" -- false, Twilio is intentionally off), and the gateway's own sms:failed
 * webhook alerted again per message. Now a transport failure on an immediate SMS
 * (timeout, HTTP error, connection failure) sends ONE incident per ET day per error
 * kind through a cron_alerts_fired claim, naming the count so far and the last error;
 * the sms:failed webhook sends nothing. smsGatewayHealthMonitor (cron) and the
 * stuck-queue alert in sms.ts still cover a sustained outage. The caller's result
 * is unchanged.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  telegram: vi.fn(async (_text: string) => true),
  classes: [] as string[],
  claims: new Set<string>(),
}));

vi.mock("./services/telegram", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/telegram")>()),
  sendTelegram: (text: string) => h.telegram(text),
  sendTelegramMessage: (text: string) => h.telegram(text),
  sendTelegramResult: async (text: string, cls?: string) => {
    h.classes.push(cls ?? "(none)");
    await h.telegram(text);
    return { status: "delivered" };
  },
}));

/** A drizzle-shaped fake with INSERT IGNORE claim semantics for cron_alerts_fired. */
function sqlParts(query: unknown): { text: string; params: string[] } {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  let text = "";
  const params: string[] = [];
  for (const c of chunks) {
    if (typeof c === "string") params.push(c);
    else if (c && typeof c === "object" && "value" in c) text += (c as { value: string[] }).value.join("");
  }
  return { text, params };
}
const fakeDb = {
  execute: async (query: unknown) => {
    const { text, params } = sqlParts(query);
    if (/DELETE FROM cron_alerts_fired/i.test(text)) {
      h.claims.delete(`${params[0]}|${params[1]}`);
      return [{ affectedRows: 1 }];
    }
    if (/INSERT IGNORE INTO cron_alerts_fired/i.test(text)) {
      const k = `${params[0]}|${params[1]}`;
      if (h.claims.has(k)) return [{ affectedRows: 0 }];
      h.claims.add(k);
      return [{ affectedRows: 1 }];
    }
    return [[], []];
  },
};
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db")>()),
  getDb: async () => fakeDb,
}));

import { sendSms } from "./sms";
import { smsGatewayWebhookRouter } from "./routes/webhooks/smsGateway";

const ENV_KEYS = [
  "SHOP_SMS_GATEWAY_USERNAME",
  "SHOP_SMS_GATEWAY_PASSWORD",
  "SHOP_SMS_GATEWAY_WEBHOOK_SECRET",
  "SHOP_SMS_GATEWAY_DEVICE_ID",
] as const;
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
    h.classes.length = 0;
    h.claims.clear();
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

  const timeout = () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
  };
  const http502 = () => vi.stubGlobal("fetch", async () => new Response("relay error", { status: 502 }));
  const refused = () =>
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:443");
    });

  it("five failures in a row send ONE incident, naming the kind, the count and the last error; the callers still get their results", async () => {
    http502();
    for (let i = 0; i < 5; i++) {
      const res = await send();
      expect(res.success).toBe(false);
    }
    expect(h.telegram).toHaveBeenCalledTimes(1);
    const text = h.telegram.mock.calls[0][0];
    expect(text).toContain("http-5xx");
    expect(text).toContain("502");
    expect(text).not.toContain("falling back to Twilio");
    expect(h.classes).toEqual(["incident"]);
  });

  it("a gateway timeout is its own kind, sends one incident, and still reports uncertain delivery", async () => {
    timeout();
    const res = await send();
    expect(res).toMatchObject({ success: true, uncertain: true });
    await send();
    expect(h.telegram).toHaveBeenCalledTimes(1);
    expect(h.telegram.mock.calls[0][0]).toContain("timeout");
  });

  it("a different error kind later the same day sends one more incident; repeats of either send nothing", async () => {
    http502();
    await send();
    timeout();
    await send();
    await send();
    refused();
    await send();
    await send();
    expect(h.telegram).toHaveBeenCalledTimes(3);
    expect(h.telegram.mock.calls.map((c) => c[0]).join("|")).toMatch(/connection/);
  });

  it("a success after a failure the same day does not resend, and a later failure of the same kind stays quiet", async () => {
    http502();
    await send();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "m1", state: "Pending" }), { status: 200 }));
    expect((await send()).success).toBe(true);
    http502();
    await send();
    expect(h.telegram).toHaveBeenCalledTimes(1);
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
