/**
 * 2026-10-21 · escalate gets the connected caller ID from the webhook, the same
 * way bookSlot does, so the assistant never has to ask a caller for a number.
 * The model never owns args.callerNumber. Drives the real express route
 * (precedent: vapi.recapCallId.test.ts) with the voice router stubbed so the
 * test reads exactly what dispatchToolCall hands it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ calls: [] as Array<{ tool: string; args: Record<string, unknown> }> }));

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
vi.mock("../../routers/voiceAgent", () => {
  const record = (tool: string) => async (args: Record<string, unknown>) => {
    h.calls.push({ tool, args });
    return { success: true };
  };
  return {
    spokenShopDirections: () => "17625 Euclid Avenue",
    voiceAgentRouter: { createCaller: () => ({ escalate: record("escalate"), bookSlot: record("bookSlot") }) },
  };
});

import { vapiWebhookRouter } from "./vapi";

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
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.calls = [];
});

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

const toolCall = (name: string, args: Record<string, unknown>, customer?: string) => ({
  type: "tool-calls",
  call: { id: "call-esc-1", ...(customer ? { customer: { number: customer } } : {}) },
  toolCalls: [{ id: "tc-1", function: { name, arguments: args } }],
});

describe("escalate receives the connected caller ID", () => {
  it("args.callerNumber comes from call.customer.number", async () => {
    expect(await postEvent(toolCall("escalate", { reason: "wants the manager" }, "+12165550123"))).toBe(200);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ tool: "escalate", args: { reason: "wants the manager", callerNumber: "+12165550123", callId: "call-esc-1" } });
  });

  it("a model-supplied callerNumber is overwritten by caller ID", async () => {
    await postEvent(toolCall("escalate", { reason: "x", callerNumber: "+12165550999" }, "+12165550123"));
    expect(h.calls[0].args.callerNumber).toBe("+12165550123");
  });

  it("bookSlot keeps the same injection", async () => {
    await postEvent(toolCall("bookSlot", { name: "Ray", service: "brake check", callerNumber: "+12165550999" }, "+12165550123"));
    expect(h.calls[0].args.callerNumber).toBe("+12165550123");
  });
});
