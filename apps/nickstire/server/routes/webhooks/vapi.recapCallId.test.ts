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

const h = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  // What the mocked orchestrator returns, and how long it takes to return it.
  status: "sent" as string,
  delayMs: 0,
}));

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
    if (h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs));
    return { id: 7, status: h.status };
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
  h.status = "sent";
  h.delayMs = 0;
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

// 2026-09-23. The model invented mapLink "https://goo.gl/maps/abc123"; the
// preflight guard held the text as a draft. The live assistant keeps sending
// the argument until the next config push, so the call must still succeed,
// and the link must never reach the orchestrator.
describe("a model-supplied mapLink", () => {
  it("is accepted but never forwarded to the orchestrator", async () => {
    const call = recapCall("call-recap-map");
    (call.toolCalls[0].function.arguments as Record<string, unknown>).mapLink = "https://goo.gl/maps/abc123";

    const res = await postEvent(call);

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.results?.[0]?.result ?? "{}")).toMatchObject({ sent: true });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).not.toHaveProperty("mapLink");
    expect(JSON.stringify(h.events[0])).not.toContain("goo.gl");
  });
});

// 2026-09-23. The "Vapi tool call" line printed args whole: the caller's full
// name and full phone number in the Railway log.
describe("the Vapi tool call log line", () => {
  it("carries the tool, the argument keys and the last 4 digits only", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    try {
      await postEvent({
        type: "tool-calls",
        call: { id: "call-log-1" },
        toolCalls: [
          {
            id: "tool-call-2",
            function: {
              name: "sendConfirmationSms",
              arguments: { name: "Jordan Testcaller", phone: "(216) 555-0187", summary: "Used tire, walking in today" },
            },
          },
        ],
      });
    } finally {
      spy.mockRestore();
    }

    const toolLine = lines.find((l) => l.includes("Vapi tool call"));
    // Positive control: the line was emitted at all, so the absences below mean something.
    expect(toolLine).toBeDefined();
    expect(toolLine).toContain("sendConfirmationSms");
    expect(toolLine).toContain("0187");
    expect(toolLine).toContain('"argKeys"');
    expect(toolLine).not.toContain("5550187");
    expect(toolLine).not.toContain("555-0187");
    expect(toolLine).not.toContain("Jordan");
    expect(toolLine).not.toContain("Testcaller");
    expect(toolLine).not.toContain("walking in");
  });
});

// Post-merge audit 2026-09-23, item C. The shop gateway's delivery receipt
// flips the recap's row from sent to delivered within seconds
// (routes/webhooks/smsGateway.ts), and a second recap on the same call gets
// that row back from the orchestrator's per-call dedupe. The tool then said
// sent:false, degraded:true, and Nick told a caller who already had the text
// that texts were down.
describe("a recap the orchestrator reports as already delivered", () => {
  const result = async (status: string) => {
    h.status = status;
    const res = await postEvent(recapCall(`call-status-${status}`));
    expect(res.status).toBe(200);
    return JSON.parse(res.body.results?.[0]?.result ?? "{}") as Record<string, unknown>;
  };

  for (const status of ["delivered", "replied"]) {
    it(`${status} -> sent, not degraded, no spoken fallback`, async () => {
      const r = await result(status);
      expect(r).toMatchObject({ sent: true, degraded: false });
      expect(r.verbalRecap).toBeUndefined();
    });
  }

  // Positive controls: the outcomes that genuinely may not have reached the
  // caller still read the address aloud.
  it("sending (gateway timeout) -> sent, degraded", async () => {
    expect(await result("sending")).toMatchObject({ sent: true, degraded: true });
  });
  it("failed -> not sent, degraded, with the spoken fallback", async () => {
    const r = await result("failed");
    expect(r).toMatchObject({ sent: false, degraded: true });
    expect(r.verbalRecap).toEqual(expect.stringContaining("Euclid"));
  });
  it("drafted (held for review) -> not sent, degraded", async () => {
    expect(await result("drafted")).toMatchObject({ sent: false, degraded: true });
  });
});

// Item C's race. dispatchToolCall runs every tool call in one webhook in
// parallel, the orchestrator writes its row only after sendSms returns, and
// idempotency_key is not a unique index, so two recap calls in one turn both
// missed the dedupe and both texted the caller.
describe("two recap calls for the same call in one webhook", () => {
  const twoRecaps = (callId: string, phones: [string, string]) => ({
    type: "tool-calls",
    call: { id: callId },
    toolCalls: phones.map((phone, i) => ({
      id: `tool-call-par-${i}`,
      function: { name: "sendConfirmationSms", arguments: { phone, summary: "Brake inspection today" } },
    })),
  });

  it("reach the orchestrator once, and both report the one send", async () => {
    h.delayMs = 50;
    const res = await postEvent(twoRecaps("call-par-1", ["2165550100", "(216) 555-0100"]));

    expect(res.status).toBe(200);
    expect(h.events).toHaveLength(1);
    const results = (res.body.results ?? []).map((r) => JSON.parse(r.result));
    expect(results).toHaveLength(2);
    for (const r of results) expect(r).toMatchObject({ sent: true, degraded: false });
  });

  // Also the canary for voiceAgent's shared orchestrator import: vitest 3.2.7
  // resolves concurrent dynamic import()s of a vi.mock'ed module past the mock
  // (all but the first get the REAL module), so without loadOrchestrator the
  // second call here reaches the real orchestrator and this count is 1.
  it("to two different numbers still send both", async () => {
    h.delayMs = 50;
    await postEvent(twoRecaps("call-par-2", ["2165550100", "2165550199"]));
    expect(h.events).toHaveLength(2);
  });

  it("run again once the first has finished (the orchestrator's dedupe owns that case)", async () => {
    await postEvent(recapCall("call-par-3"));
    await postEvent(recapCall("call-par-3"));
    expect(h.events).toHaveLength(2);
  });
});
