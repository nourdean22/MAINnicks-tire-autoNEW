/**
 * Canaries for the Vapi webhook's secret check (webhook security review
 * 2026-10-16, F5: no test broke it).
 *
 * Drives the REAL express route and the REAL verifyVapiSignature with a
 * secret configured, posting a recap tool call that would text the caller.
 * A refused request must answer 401 and reach nothing: the SMS orchestrator
 * mock (the side effect an attacker wants) and the call-state writer must
 * never be called. The positive controls prove the same request DOES reach
 * the orchestrator when it carries the secret, so every "never called" below
 * means something.
 *
 * What Vapi's check is: the assistant's `server.secret` sent verbatim in
 * `x-vapi-secret` (or `x-vapi-signature`), compared constant-time. It is not
 * an HMAC of the body and carries no timestamp, so there is no
 * "body changed after signing" or "stale timestamp" case to test here; those
 * live in smsGateway.signature.test.ts, whose check does sign the body.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ sends: 0, states: 0 }));

vi.mock("../../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getDb: async () => null,
  getDbTyped: async () => null,
}));
vi.mock("../../services/voice-call-state", () => ({
  recordCallState: vi.fn(async () => {
    h.states++;
  }),
  classifyToolToState: () => "confirmed",
  recapCallState: () => ({ state: "confirmed" }),
  getCallStateHistory: vi.fn(async () => []),
}));
vi.mock("../../services/voice-latency", () => ({ captureVoiceLatency: vi.fn(async () => {}) }));
vi.mock("../../services/smsOrchestrator", () => ({
  orchestrateSms: vi.fn(async () => {
    h.sends++;
    return { id: 7, status: "sent" };
  }),
}));

import { vapiWebhookRouter } from "./vapi";

// Fake and low-entropy on purpose: the PR secret scan flags high-entropy literals.
const SECRET = "not-real-not-real-not-real";

let server: http.Server;
let port: number;
const saved = { secret: process.env.VAPI_WEBHOOK_SECRET, nodeEnv: process.env.NODE_ENV };

beforeAll(async () => {
  const app = express();
  app.use("/api/webhooks", vapiWebhookRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.sends = 0;
  h.states = 0;
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (saved.secret === undefined) delete process.env.VAPI_WEBHOOK_SECRET;
  else process.env.VAPI_WEBHOOK_SECRET = saved.secret;
  if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = saved.nodeEnv;
});

let seq = 0;
/** A recap tool call for a caller with a real caller ID: it texts unless refused. */
function recapPayload(): string {
  seq++;
  return JSON.stringify({
    message: {
      type: "tool-calls",
      call: { id: `call-sig-${seq}`, customer: { number: "+12165550100" } },
      toolCalls: [
        {
          id: `tool-sig-${seq}`,
          function: { name: "sendConfirmationSms", arguments: { summary: "Brake check, walking in today" } },
        },
      ],
    },
  });
}

/** node:http POST with raw header control (duplicates, casing): immune to fetch stubs. */
function post(headers: Record<string, string | string[]>): Promise<number> {
  const payload = recapPayload();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/webhooks/vapi",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...headers },
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

/** Let the route's fire-and-forget state hook run before counting it. */
const settle = () => new Promise((r) => setTimeout(r, 30));

async function expectRefused(headers: Record<string, string | string[]>) {
  const status = await post(headers);
  await settle();
  expect(status).toBe(401);
  expect(h.sends).toBe(0);
  expect(h.states).toBe(0);
}

describe("positive controls: a request carrying the secret reaches the orchestrator", () => {
  it("x-vapi-secret with the secret -> 200 and one send", async () => {
    expect(await post({ "x-vapi-secret": SECRET })).toBe(200);
    expect(h.sends).toBe(1);
    // The state hook runs after the 200 (cold dynamic imports on first use):
    // wait for it here, so the refusals' "0 states" is measured against a hook
    // proven to fire.
    await vi.waitFor(() => expect(h.states).toBe(1), { timeout: 5000 });
  });

  it("x-vapi-signature (Vapi's custom-credential mode) with the secret -> 200 and one send", async () => {
    expect(await post({ "x-vapi-signature": SECRET })).toBe(200);
    expect(h.sends).toBe(1);
  });

  it("header NAME casing does not matter (HTTP header names are case-insensitive)", async () => {
    expect(await post({ "X-VAPI-SECRET": SECRET })).toBe(200);
    expect(h.sends).toBe(1);
  });
});

describe("a request without the right secret is refused and reaches nothing", () => {
  it("no secret header", async () => {
    await expectRefused({});
  });

  it("an empty header value", async () => {
    await expectRefused({ "x-vapi-secret": "" });
  });

  it("a wrong secret of the same length", async () => {
    await expectRefused({ "x-vapi-secret": SECRET.replace(/.$/, (c) => (c === "f" ? "e" : "f")) });
  });

  it("a prefix of the secret", async () => {
    await expectRefused({ "x-vapi-secret": SECRET.slice(0, -1) });
  });

  it("the secret with extra bytes appended", async () => {
    await expectRefused({ "x-vapi-secret": `${SECRET}x` });
  });

  it("the secret in a different letter case (the VALUE is case-sensitive)", async () => {
    await expectRefused({ "x-vapi-secret": SECRET.toUpperCase() });
  });

  it("duplicate x-vapi-secret headers, wrong then right", async () => {
    await expectRefused({ "x-vapi-secret": ["wrong", SECRET] });
  });

  it("duplicate x-vapi-secret headers, both right (joined, so neither matches)", async () => {
    await expectRefused({ "x-vapi-secret": [SECRET, SECRET] });
  });

  it("a wrong x-vapi-secret is not rescued by a right x-vapi-signature", async () => {
    await expectRefused({ "x-vapi-secret": "wrong", "x-vapi-signature": SECRET });
  });

  it("the secret sent as a bearer token in Authorization", async () => {
    await expectRefused({ authorization: `Bearer ${SECRET}` });
  });
});

describe("production with no usable secret configured refuses everything", () => {
  it("secret unset -> 401, nothing sent", async () => {
    delete process.env.VAPI_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    await expectRefused({ "x-vapi-secret": SECRET });
  });

  it("secret set to the empty string -> 401, even for an empty header", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "";
    process.env.NODE_ENV = "production";
    await expectRefused({ "x-vapi-secret": "" });
    await expectRefused({});
  });
});
