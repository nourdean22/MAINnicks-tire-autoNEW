/**
 * placeVapiOutboundCall · send_pause_voice_outbound holds every outbound dial (C5.5).
 *
 * Every voice lane (recovery, confirmation, cadence, the manual follow-up call)
 * dials through placeVapiOutboundCall, so the pause sits there, before the
 * phone-number lookup and the POST /call. Driven with the real sendPause reader
 * over a fake db and a stubbed fetch: no network, 555 numbers, canary env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dbMode: "rows" | "throw" = "rows";
let pausedValue: number | null = null;

vi.mock("../db", () => ({
  getDb: async () => {
    if (dbMode === "throw") throw new Error("connection refused");
    return {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("send_pause_voice_outbound") && pausedValue !== null) return [[{ v: pausedValue }]];
        return [[]];
      },
    };
  },
}));

describe("placeVapiOutboundCall · voice_outbound pause", () => {
  let fetchCalls: string[] = [];

  beforeEach(async () => {
    dbMode = "rows";
    pausedValue = null;
    fetchCalls = [];
    vi.stubEnv("VAPI_API_KEY", "canary-key");
    vi.stubEnv("VAPI_FOLLOWUP_ASSISTANT_ID", "asst_canary");
    vi.stubEnv("VAPI_PHONE_NUMBER_ID", "pn_canary");
    vi.stubGlobal("fetch", async (url: string | URL) => {
      fetchCalls.push(String(url));
      return new Response(JSON.stringify({ id: "call_ok" }), { status: 201 });
    });
    const { _resetSendPauseCacheForTest } = await import("./sendPause");
    _resetSendPauseCacheForTest();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const dial = async (actor?: "operator") => {
    const { placeVapiOutboundCall } = await import("./vapi");
    return placeVapiOutboundCall({
      customerNumber: "+12165550142",
      lane: actor ? "followup_manual" : "voice_recovery",
      ...(actor ? { actor } : {}),
      customerName: "Pat",
      openerBody: "x",
      systemPrompt: "x",
    });
  };

  it("CONTROL: not paused -> the provider call happens as today", async () => {
    const r = await dial();
    expect(r).toEqual({ success: true, callId: "call_ok" });
    expect(fetchCalls.filter((u) => u.includes("/call"))).toHaveLength(1);
  });

  it("paused -> zero provider calls, refused before reaching a customer", async () => {
    pausedValue = 1;
    const r = await dial();
    expect(fetchCalls).toHaveLength(0);
    expect(r).toEqual({ success: false, error: "send_pause:voice_outbound", errorKind: "config" });
  });

  it("unreadable switch -> fail CLOSED for voice: zero provider calls", async () => {
    dbMode = "throw";
    const r = await dial();
    expect(fetchCalls).toHaveLength(0);
    expect(r).toEqual({ success: false, error: "send_pause_unreadable:voice_outbound", errorKind: "config" });
  });

  it("paused row value 0 -> dials (the row exists, the pause is off)", async () => {
    pausedValue = 0;
    const r = await dial();
    expect(r.success).toBe(true);
  });

  it("manual door (actor operator) + unreadable switch -> fail OPEN: the call is placed", async () => {
    dbMode = "throw";
    const r = await dial("operator");
    expect(r).toEqual({ success: true, callId: "call_ok" });
    expect(fetchCalls.filter((u) => u.includes("/call"))).toHaveLength(1);
  });

  it("CONTROL: manual door + paused=true -> still held, zero provider calls", async () => {
    pausedValue = 1;
    const r = await dial("operator");
    expect(fetchCalls).toHaveLength(0);
    expect(r).toEqual({ success: false, error: "send_pause:voice_outbound", errorKind: "config" });
  });
});