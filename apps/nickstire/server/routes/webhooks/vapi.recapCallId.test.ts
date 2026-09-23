/**
 * The recap text carries the call it belongs to (2026-09-23).
 *
 * dispatchToolCall injects the live call's id into every tool's arguments, but
 * sendConfirmationSms's input schema listed only phone, summary and mapLink,
 * and zod stripped the id. The orchestrator then built its idempotency key from
 * Date.now()+random, which can never match, so a second run of the tool on the
 * same call (the model calling it twice, or a retry after a gateway timeout)
 * texted the caller again.
 *
 * This drives the REAL express route with a tool-calls event (precedent:
 * vapi.call-end-ack.test.ts: node:http, dev-mode signature, env restored) and
 * reads the event that reaches the orchestrator.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

// No database: every persist and lookup on this path no-ops.
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
vi.mock("../../services/smsOrchestrator", () => ({
  orchestrateSms: vi.fn(async (event: Record<string, unknown>) => {
    h.events.push(event);
    return { id: 7, status: "sent" };
  }),
}));

import { vapiWebhookRouter } from "./vapi";

let server: http.Server;
let port: number;
let savedSecret: string | undefined;

beforeAll(async () => {
  // Dev-mode signature path (no secret -> allowed outside production).
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
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.events = [];
});

/** node:http POST: immune to other files' globalThis.fetch stubs. */
function postEvent(message: Record<string, unknown>): Promise<{ status: number; body: { results?: Array<{ result: string }> } }> {
  const payload = JSON.stringify({ message });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/webhooks/vapi",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const recapCall = (callId?: string) => ({
  type: "tool-calls",
  ...(callId ? { call: { id: callId } } : {}),
  toolCalls: [
    {
      id: "tool-call-1",
      function: {
        name: "sendConfirmationSms",
        arguments: { phone: "2165550100", summary: "Brake inspection, walk in any time today" },
      },
    },
  ],
});

describe("sendConfirmationSms through the webhook", () => {
  it("hands the call's id to the orchestrator as vapiCallId", async () => {
    const res = await postEvent(recapCall("call-recap-1"));

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.results?.[0]?.result ?? "{}")).toMatchObject({ sent: true });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ type: "vapi_confirmation", vapiCallId: "call-recap-1" });
  });

  it("still sends when the event carries no call id", async () => {
    const res = await postEvent(recapCall());

    expect(res.status).toBe(200);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].vapiCallId).toBeUndefined();
  });
});
