/**
 * Transfer callback, webhook half (2026-10-31).
 *
 * Vapi: "Assistant-based warm transfers to phone or SIP destinations do not send
 * transfer-update" and "A status-update event with status: forwarding signals that
 * the transfer started" (docs.vapi.ai/calls/assistant-based-warm-transfer, read
 * 2026-10-31). The webhook recorded only in-progress, so once the transfer
 * assistant is live every attempt would leave no witness. These pin:
 *   (6) status-update forwarding records transfer_attempted, destination KIND only;
 *   (3) a transfer that connects writes no callback (escalate is never reached);
 *   the ringback hold audio is served to Vapi without the webhook secret.
 * Drives the real express route (precedent: vapi.call-end-ack.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ escalates: 0 }));

vi.mock("../../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getDb: async () => null,
  getDbTyped: async () => null,
}));
vi.mock("../../services/voice-call-state", () => ({
  recordCallState: vi.fn(async () => {}),
  classifyToolToState: () => null,
  getCallStateHistory: vi.fn(async () => []),
}));
vi.mock("../../services/voice-latency", () => ({ captureVoiceLatency: vi.fn(async () => {}) }));
vi.mock("../../services/smsOrchestrator", () => ({ orchestrateSms: vi.fn(async () => ({ sent: false })) }));
vi.mock("../../routers/voiceAgent", () => ({
  spokenShopDirections: () => "17625 Euclid Avenue",
  voiceAgentRouter: {
    createCaller: () => ({
      escalate: async () => { h.escalates++; return { success: true }; },
    }),
  },
}));

import { vapiWebhookRouter } from "./vapi";
import { recordCallState } from "../../services/voice-call-state";

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
  if (savedSecret !== undefined) process.env.VAPI_WEBHOOK_SECRET = savedSecret;
  else delete process.env.VAPI_WEBHOOK_SECRET;
  await new Promise((r) => setTimeout(r, 50));
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.escalates = 0;
  vi.mocked(recordCallState).mockClear();
});

function request(method: "GET" | "POST", path: string, message?: Record<string, unknown>): Promise<{ status: number; type: string; body: Buffer }> {
  const payload = message ? JSON.stringify({ message }) : "";
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: message ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}
const post = (message: Record<string, unknown>) => request("POST", "/api/webhooks/vapi", message);

describe("(6) status-update forwarding is a transfer attempt", () => {
  it("records transfer_attempted with the destination kind and never the number", async () => {
    const res = await post({
      type: "status-update",
      status: "forwarding",
      call: { id: "call-fwd-1", assistantId: "asst-1" },
      destination: { type: "number", number: "+12165550142" },
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(recordCallState).toHaveBeenCalledWith({
        callId: "call-fwd-1",
        assistantId: "asst-1",
        state: "transfer_attempted",
        metadata: { eventType: "status-update", destinationType: "number" },
      }),
    );
    expect(JSON.stringify(vi.mocked(recordCallState).mock.calls)).not.toContain("555");
  });

  it("POSITIVE CONTROL: in-progress still records greeted, and only that", async () => {
    await post({ type: "status-update", status: "in-progress", call: { id: "call-fwd-2" } });
    await vi.waitFor(() => expect(recordCallState).toHaveBeenCalledTimes(1));
    expect(vi.mocked(recordCallState).mock.calls[0][0]).toMatchObject({ callId: "call-fwd-2", state: "greeted" });
  });

  it("ringing and ended statuses record nothing", async () => {
    await post({ type: "status-update", status: "ringing", call: { id: "call-fwd-3" } });
    await post({ type: "status-update", status: "ended", call: { id: "call-fwd-3" } });
    await new Promise((r) => setTimeout(r, 30));
    expect(recordCallState).not.toHaveBeenCalled();
  });
});

describe("(3) a transfer that connects does nothing new", () => {
  it("forwarding then a connected end-of-call reaches no escalate", async () => {
    await post({ type: "status-update", status: "forwarding", call: { id: "call-conn-1" }, destination: { type: "number" } });
    await post({
      type: "end-of-call-report",
      endedReason: "assistant-forwarded-call",
      call: { id: "call-conn-1" },
      artifact: { transfers: [{ status: "connected", mode: "warm-transfer-experimental" }] },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.escalates).toBe(0);
  });
});

describe("ringback hold audio", () => {
  it("is served as a WAV to Vapi without the webhook secret, even when one is set", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "test-secret";
    try {
      const res = await request("GET", "/api/webhooks/vapi/ringback.wav");
      expect(res.status).toBe(200);
      expect(res.type).toBe("audio/wav");
      expect(res.body.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(res.body.subarray(8, 12).toString("ascii")).toBe("WAVE");
    } finally {
      delete process.env.VAPI_WEBHOOK_SECRET;
    }
  });

  it("POSITIVE CONTROL: the webhook POST still demands the secret when one is set", async () => {
    process.env.VAPI_WEBHOOK_SECRET = "test-secret";
    try {
      expect((await post({ type: "status-update", status: "in-progress", call: { id: "x" } })).status).toBe(401);
    } finally {
      delete process.env.VAPI_WEBHOOK_SECRET;
    }
  });
});
