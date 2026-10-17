/**
 * Canaries for the SMS-gateway webhook's HMAC check (webhook security review
 * 2026-10-16, F5: no test broke it).
 *
 * Drives the REAL express route and its REAL verifySignature with
 * SHOP_SMS_GATEWAY_WEBHOOK_SECRET set. The app parses JSON the way
 * server/_core/index.ts does (express.json with a verify callback that keeps
 * req.rawBody), because the HMAC is over those exact bytes.
 *
 * The request is an inbound customer text. Its first side effect is
 * recordInboundShopSms; a refused request must never reach it. The positive
 * controls prove a correctly signed request does, so each "never called"
 * below is a real refusal, not a request that would have done nothing anyway.
 *
 * The signer below is the SENDER's side (what the Capevace relay does:
 * HMAC-SHA256(secret, rawBody + timestamp), hex, in X-Signature, with the
 * unix-seconds timestamp in X-Timestamp). The check under test is the route's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ inbound: 0 }));

vi.mock("../../sms", () => ({
  // normalized:null ends the request right after the first side effect, so the
  // positive control needs no database, conversation or reply mocks.
  recordInboundShopSms: vi.fn(() => {
    h.inbound++;
    return { normalized: null };
  }),
}));
vi.mock("../../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getDb: async () => null,
  getDbTyped: async () => null,
}));

import { smsGatewayWebhookRouter } from "./smsGateway";

const SECRET = "gateway-canary-secret-0123456789";

let withRaw: { server: http.Server; port: number };
let withoutRaw: { server: http.Server; port: number };
const saved = { secret: process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET, nodeEnv: process.env.NODE_ENV };

async function listen(keepRawBody: boolean) {
  const app = express();
  app.use(
    keepRawBody
      ? express.json({
          verify: (req, _res, buf) => {
            (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
          },
        })
      : express.json(),
  );
  app.use("/api/webhooks", smsGatewayWebhookRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  return { server, port: (server.address() as AddressInfo).port };
}

beforeAll(async () => {
  withRaw = await listen(true);
  withoutRaw = await listen(false);
});

afterAll(async () => {
  for (const s of [withRaw.server, withoutRaw.server]) await new Promise<void>((r) => s.close(() => r()));
});

beforeEach(() => {
  h.inbound = 0;
  process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (saved.secret === undefined) delete process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET;
  else process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET = saved.secret;
  if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = saved.nodeEnv;
});

let seq = 0;
function inboundBody(message = "Do you have 225/65R17 used?"): string {
  seq++;
  return JSON.stringify({
    event: "sms:received",
    id: `evt-${seq}`,
    payload: { messageId: `msg-${seq}`, phoneNumber: "+12165550100", message },
  });
}

const nowSec = () => Math.floor(Date.now() / 1000);
const sign = (body: string, ts: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(body + ts).digest("hex");

function post(body: string, headers: Record<string, string | string[]>, target = withRaw): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: target.port,
        path: "/api/webhooks/sms-gateway",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/** A correctly signed request's headers for this body and timestamp. */
function signed(body: string, ts = String(nowSec())) {
  return { "x-signature": sign(body, ts), "x-timestamp": ts };
}

async function expectRefused(body: string, headers: Record<string, string | string[]>, target = withRaw) {
  expect(await post(body, headers, target)).toBe(401);
  expect(h.inbound).toBe(0);
}

describe("positive controls: a correctly signed request reaches the handler", () => {
  it("hex HMAC over rawBody + timestamp -> 200 and the inbound text is recorded", async () => {
    const body = inboundBody();
    expect(await post(body, signed(body))).toBe(200);
    expect(h.inbound).toBe(1);
  });

  it("the documented sha256= prefix -> 200", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    expect(await post(body, { "x-signature": `sha256=${sign(body, ts)}`, "x-timestamp": ts })).toBe(200);
    expect(h.inbound).toBe(1);
  });

  it("header NAME casing does not matter", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    expect(await post(body, { "X-SIGNATURE": sign(body, ts), "X-TIMESTAMP": ts })).toBe(200);
    expect(h.inbound).toBe(1);
  });

  it("a timestamp 4 minutes old is still inside the 5-minute window", async () => {
    const body = inboundBody();
    expect(await post(body, signed(body, String(nowSec() - 240)))).toBe(200);
    expect(h.inbound).toBe(1);
  });
});

describe("a request that is not correctly signed is refused and reaches nothing", () => {
  it("no X-Signature", async () => {
    const body = inboundBody();
    await expectRefused(body, { "x-timestamp": String(nowSec()) });
  });

  it("no X-Timestamp (the signature alone is not enough)", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    await expectRefused(body, { "x-signature": sign(body, ts) });
  });

  it("an empty signature, bare and with the sha256= prefix", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    await expectRefused(body, { "x-signature": "", "x-timestamp": ts });
    await expectRefused(body, { "x-signature": "sha256=", "x-timestamp": ts });
  });

  it("signed with a different secret", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    await expectRefused(body, { "x-signature": sign(body, ts, "not-the-shop-secret"), "x-timestamp": ts });
  });

  it("the body changed after signing (an opt-out swapped in)", async () => {
    const original = inboundBody("Do you have 225/65R17 used?");
    const ts = String(nowSec());
    const tampered = original.replace("Do you have 225/65R17 used?", "STOP");
    await expectRefused(tampered, { "x-signature": sign(original, ts), "x-timestamp": ts });
  });

  it("the timestamp changed after signing, still inside the window", async () => {
    const body = inboundBody();
    const ts = nowSec();
    await expectRefused(body, { "x-signature": sign(body, String(ts)), "x-timestamp": String(ts - 1) });
  });

  it("a signature over the body alone (timestamp not bound) with a fresh timestamp", async () => {
    const body = inboundBody();
    await expectRefused(body, { "x-signature": sign(body, ""), "x-timestamp": String(nowSec()) });
  });

  it("a stale timestamp, correctly signed (replay older than 5 minutes)", async () => {
    const body = inboundBody();
    await expectRefused(body, signed(body, String(nowSec() - 301)));
  });

  it("a future timestamp, correctly signed", async () => {
    const body = inboundBody();
    await expectRefused(body, signed(body, String(nowSec() + 301)));
  });

  it("a millisecond timestamp, correctly signed (reads as far in the future)", async () => {
    const body = inboundBody();
    await expectRefused(body, signed(body, String(Date.now())));
  });

  it("a non-numeric timestamp, correctly signed", async () => {
    const body = inboundBody();
    await expectRefused(body, signed(body, "not-a-time"));
  });

  it("a truncated signature (first half of the right one)", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    await expectRefused(body, { "x-signature": sign(body, ts).slice(0, 32), "x-timestamp": ts });
  });

  it("duplicate X-Signature headers, wrong then right", async () => {
    const body = inboundBody();
    const ts = String(nowSec());
    await expectRefused(body, { "x-signature": ["00".repeat(32), sign(body, ts)], "x-timestamp": ts });
  });

  it("a right signature when the app did not keep the raw body (fails closed, never re-serialises)", async () => {
    const body = inboundBody();
    await expectRefused(body, signed(body), withoutRaw);
  });
});

describe("production with no usable secret configured refuses everything", () => {
  it("secret unset -> 500 webhook_misconfigured, nothing recorded", async () => {
    delete process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    const body = inboundBody();
    expect(await post(body, signed(body))).toBe(500);
    expect(h.inbound).toBe(0);
  });

  it("secret set to the empty string -> 500, even with no signature at all", async () => {
    process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET = "";
    process.env.NODE_ENV = "production";
    const body = inboundBody();
    expect(await post(body, {})).toBe(500);
    expect(h.inbound).toBe(0);
  });
});
