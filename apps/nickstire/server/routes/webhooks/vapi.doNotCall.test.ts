/**
 * Q-45 · the do-not-call MECHANISM, through the real express route.
 *
 * 47 CFR 64.1200(b)(3): when the called person opts out, the mechanism "must
 * automatically record the called person's number to the caller's do-not-call
 * list and immediately terminate the call". Termination is Vapi's side (the
 * tool's request-complete message carries endCallAfterSpokenEnabled — pinned in
 * outboundCallCompliance.test.ts). Recording is ours, and this pins it:
 *
 *   · the `recordDoNotCall` tool writes the DIALLED number (call.customer.number)
 *     into the existing opt-out store — never a number the model supplies;
 *   · an OUTBOUND end-of-call report whose CUSTOMER said "stop calling" records
 *     it even when the model never called the tool;
 *   · the assistant's own "say stop calling" line, an inbound call, and a number
 *     already suppressed do NOT record (the last keeps the ledger at one row).
 *
 * Precedent for the harness: vapi.recapCallId.test.ts (node:http, dev-mode
 * signature, env restored). The store writer is spied, not run: its SQL is
 * pinned in sms.voiceOptOut.test.ts.
 *
 * RED ON MAIN (measured, 3 of 6): there the tool name falls to "Tool not
 * implemented" and nothing reads an end-of-call transcript for an opt-out. The
 * three "does NOT record" cases pass on main by construction — they are the
 * over-recording guards that give the three positives their meaning.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  marked: [] as string[],
  fullMarked: [] as string[],
  ledger: [] as Array<Record<string, unknown>>,
  suppressed: new Set<string>(),
  voicePersisted: true,
  fullPersisted: true,
}));

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
vi.mock("../../sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../sms")>()),
  markPhoneVoiceOptedOut: vi.fn(async (phone: string) => {
    h.marked.push(phone);
    return h.voicePersisted;
  }),
  markPhoneFullyOptedOut: vi.fn(async (phone: string) => {
    h.fullMarked.push(phone);
    return h.fullPersisted;
  }),
  loadSuppressionIndex: vi.fn(async () => ({
    ok: true,
    phones: h.suppressed,
    carrierBlocked: new Set<string>(),
    voiceOnly: new Set<string>(),
    stale: false,
  })),
}));
vi.mock("../../services/complianceLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/complianceLog")>()),
  logSmsOptOut: vi.fn(async (p: Record<string, unknown>) => {
    h.ledger.push(p);
  }),
}));

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
  h.marked = [];
  h.fullMarked = [];
  h.ledger = [];
  h.suppressed = new Set();
  h.voicePersisted = true;
  h.fullPersisted = true;
});

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
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const DIALLED = "+12165550142";
const OPENER = `Hi Pat, this is Nick's Tire and Auto calling. If you'd rather we not call, just say "stop calling" at any time and we'll take you off our list.`;

/** Let the detached end-of-call work run; it is not awaited by the ack. */
const settle = () => new Promise((r) => setTimeout(r, 150));

describe("recordDoNotCall tool", () => {
  it("records the DIALLED number, not the one in the arguments, and tells Vapi the call ends", async () => {
    const res = await postEvent({
      type: "tool-calls",
      call: { id: "call_dnc_1", type: "outboundPhoneCall", customer: { number: DIALLED } },
      toolCalls: [{ id: "tc1", type: "function", function: { name: "recordDoNotCall", arguments: { phone: "+12165550999" } } }],
    });
    expect(res.status).toBe(200);
    expect(h.marked).toEqual(["2165550142"]);
    expect(JSON.parse(res.body.results![0]!.result)).toEqual({ ok: true, endCall: true });
    expect(h.ledger).toEqual([{ phone: "2165550142", via: "voice", keyword: "VOICE_TOOL" }]);
  });

  it("with no dialled number it records nothing, and says so", async () => {
    const res = await postEvent({
      type: "tool-calls",
      call: { id: "call_dnc_2", type: "outboundPhoneCall" },
      toolCalls: [{ id: "tc2", type: "function", function: { name: "recordDoNotCall", arguments: {} } }],
    });
    expect(h.marked).toEqual([]);
    expect(JSON.parse(res.body.results![0]!.result)).toEqual({ ok: false, endCall: true });
  });

  it("does not claim success when the durable do-not-call write fails", async () => {
    h.voicePersisted = false;
    const res = await postEvent({
      type: "tool-calls",
      call: { id: "call_dnc_3", type: "outboundPhoneCall", customer: { number: DIALLED } },
      toolCalls: [{ id: "tc3", type: "function", function: { name: "recordDoNotCall", arguments: {} } }],
    });
    expect(res.status).toBe(200);
    expect(h.marked).toEqual(["2165550142"]);
    expect(JSON.parse(res.body.results![0]!.result)).toEqual({ ok: false, endCall: true, retryable: true });
    expect(h.ledger).toEqual([]);
  });
});

describe("end-of-call transcript check", () => {
  const report = (call: Record<string, unknown>, messages: Array<{ role: string; message: string }>) =>
    postEvent({ type: "end-of-call-report", endedReason: "customer-ended-call", call, artifact: { messages } });

  it("an OUTBOUND call where the customer said \"stop calling me\" is recorded without the tool", async () => {
    const res = await report({ id: "call_eoc_1", type: "outboundPhoneCall", customer: { number: DIALLED } }, [
      { role: "bot", message: OPENER },
      { role: "user", message: "Yeah, please stop calling me." },
    ]);
    expect(res.status).toBe(200);
    expect(h.marked).toEqual(["2165550142"]);
    expect(h.ledger).toEqual([{ phone: "2165550142", via: "voice", keyword: "VOICE_TRANSCRIPT" }]);
  });

  it.each(["Please stop texting me.", "Don't contact me again.", "Unsubscribe me."])(
    "broad customer opt-out %j is persisted as all-contact before ack",
    async (utterance) => {
      const res = await report({ id: `call_full_${utterance.length}`, type: "outboundPhoneCall", customer: { number: DIALLED } }, [
        { role: "user", message: utterance },
      ]);
      expect(res.status).toBe(200);
      expect(h.fullMarked).toEqual(["2165550142"]);
      expect(h.marked).toEqual([]);
      expect(h.ledger).toEqual([{ phone: "2165550142", via: "voice", keyword: "VOICE_TRANSCRIPT_FULL" }]);
    },
  );

  it("returns 503 before ack when transcript persistence fails, then succeeds on retry", async () => {
    const call = { id: "call_eoc_retry", type: "outboundPhoneCall", customer: { number: DIALLED } };
    const messages = [{ role: "user", message: "Please stop calling me." }];
    h.voicePersisted = false;
    const first = await report(call, messages);
    expect(first.status).toBe(503);
    expect(h.ledger).toEqual([]);

    h.voicePersisted = true;
    const second = await report(call, messages);
    expect(second.status).toBe(200);
    expect(h.marked).toEqual(["2165550142", "2165550142"]);
    expect(h.ledger).toEqual([{ phone: "2165550142", via: "voice", keyword: "VOICE_TRANSCRIPT" }]);
  });

  it("the assistant's own \"say stop calling\" line does NOT opt the customer out", async () => {
    await report({ id: "call_eoc_2", type: "outboundPhoneCall", customer: { number: DIALLED } }, [
      { role: "bot", message: OPENER },
      { role: "user", message: "Yeah everything's good, thanks." },
    ]);
    await settle();
    expect(h.marked).toEqual([]);
  });

  it("an INBOUND call is not this rule's business", async () => {
    await report({ id: "call_eoc_3", type: "inboundPhoneCall", customer: { number: DIALLED } }, [
      { role: "user", message: "stop calling me" },
    ]);
    await settle();
    expect(h.marked).toEqual([]);
  });

  it("re-persists a transcript opt-out even when the in-memory suppression set already contains the number", async () => {
    h.suppressed = new Set(["2165550142"]);
    const res = await report({ id: "call_eoc_4", type: "outboundPhoneCall", customer: { number: DIALLED } }, [
      { role: "user", message: "stop calling me" },
    ]);
    expect(res.status).toBe(200);
    expect(h.marked).toEqual(["2165550142"]);
    expect(h.ledger).toEqual([{ phone: "2165550142", via: "voice", keyword: "VOICE_TRANSCRIPT" }]);
  });
});
