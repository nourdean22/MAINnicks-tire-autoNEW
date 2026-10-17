/**
 * A recap that did not go out never records the call as `confirmed`
 * (job 2026-10-17-vapi-followups; follow-up to the 2026-10-16 caller binding).
 *
 * The webhook's state hook classified tool calls by NAME only, so every
 * sendConfirmationSms recorded `confirmed`: the caller-ID refusal (nothing
 * sent), a failed send, a recap held as a draft. `confirmed` is the "success
 * acknowledgment" state, it shows as Confirmed on the live-calls board, and
 * trailReachedTool counts it as a conversion, so vapi_call_logs.convertedToLead
 * was 1 for a call whose only "conversion" was a text that never left.
 *
 * Drives the REAL route with the REAL classifier; only the DB write
 * (recordCallState) and the orchestrator are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  states: [] as Array<{ state: string; metadata?: Record<string, unknown> }>,
  status: "sent" as string,
  reason: undefined as string | undefined,
  sends: 0,
}));

vi.mock("../../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getDb: async () => null,
  getDbTyped: async () => null,
}));
vi.mock("../../services/voice-call-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/voice-call-state")>()),
  recordCallState: vi.fn(async (args: { state: string; metadata?: Record<string, unknown> }) => {
    h.states.push({ state: args.state, metadata: args.metadata });
  }),
}));
vi.mock("../../services/voice-latency", () => ({ captureVoiceLatency: vi.fn(async () => {}) }));
vi.mock("../../services/smsOrchestrator", () => ({
  orchestrateSms: vi.fn(async () => {
    h.sends++;
    return { id: 7, status: h.status, reason: h.reason };
  }),
}));

import { vapiWebhookRouter } from "./vapi";
import { trailReachedTool } from "../../services/vapiConversionSignals";

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
  h.states = [];
  h.status = "sent";
  h.reason = undefined;
  h.sends = 0;
});

function postRecap(callId: string, customer: string | null): Promise<number> {
  const payload = JSON.stringify({
    message: {
      type: "tool-calls",
      call: { id: callId, ...(customer === null ? {} : { customer: { number: customer } }) },
      toolCalls: [{ id: `tc-${callId}`, function: { name: "sendConfirmationSms", arguments: { summary: "Brake check today" } } }],
    },
  });
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
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** The state hook is fire-and-forget after the 200; wait for its one write. */
async function recordedState() {
  await vi.waitFor(() => expect(h.states).toHaveLength(1), { timeout: 5000 });
  return h.states[0];
}

describe("the call state a recap records", () => {
  it("refused for no caller ID: not confirmed, recap_unsent with the reason, not a conversion", async () => {
    expect(await postRecap("call-state-refused", null)).toBe(200);
    const s = await recordedState();

    expect(h.sends).toBe(0);
    expect(s.state).not.toBe("confirmed");
    expect(s).toMatchObject({ state: "recap_unsent", metadata: { tool: "sendConfirmationSms", reason: "no_caller_id" } });
    expect(trailReachedTool([s])).toBe(false);
  });

  it("a failed send: recap_unsent with the orchestrator's code", async () => {
    h.status = "failed";
    h.reason = "transmission_failed";
    await postRecap("call-state-failed", "+12165550100");
    const s = await recordedState();

    expect(h.sends).toBe(1);
    expect(s).toMatchObject({ state: "recap_unsent", metadata: { reason: "transmission_failed" } });
  });

  it("a recap held as a draft: recap_unsent", async () => {
    h.status = "drafted";
    await postRecap("call-state-drafted", "+12165550100");
    expect(await recordedState()).toMatchObject({ state: "recap_unsent", metadata: { reason: "not_sent" } });
  });

  // Positive controls: a text that went out (or was handed to the gateway and
  // must not be re-sent) still records confirmed, and still counts.
  it("sent: confirmed, and counts as a conversion", async () => {
    await postRecap("call-state-sent", "+12165550100");
    const s = await recordedState();
    expect(s.state).toBe("confirmed");
    expect(s.metadata).not.toHaveProperty("reason");
    expect(trailReachedTool([s])).toBe(true);
  });

  it("sending (gateway timeout, sent:true degraded): confirmed", async () => {
    h.status = "sending";
    await postRecap("call-state-sending", "+12165550100");
    expect((await recordedState()).state).toBe("confirmed");
  });
});
