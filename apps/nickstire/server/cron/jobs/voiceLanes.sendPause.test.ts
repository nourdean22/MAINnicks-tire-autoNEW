/**
 * The three voice crons skip on send_pause_voice_outbound BEFORE they claim a
 * lead (C5.5). placeVapiOutboundCall also holds, but a hold there arrives after
 * the claim and reads as a dial failure; the cron gate keeps a pause on the
 * existing "Skipped · ..." path. Real sendPause over a fake db; vapi is a fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dbMode: "rows" | "throw" = "rows";
let paused = false;
let otherDbReads = 0;
const vapiCalls: string[] = [];

vi.mock("../../db", () => ({
  getDb: async () => {
    if (dbMode === "throw") throw new Error("connection refused");
    return {
      execute: async (q: unknown) => {
        if (JSON.stringify(q).includes("send_pause_voice_outbound")) return [paused ? [{ v: 1 }] : []];
        otherDbReads++;
        return [[]];
      },
      select: () => { otherDbReads++; throw new Error("not reached in these tests"); },
    };
  },
}));

vi.mock("../../services/vapi", () => ({
  followUpAssistantIdOrNull: () => { vapiCalls.push("followUpAssistantIdOrNull"); return "asst_canary"; },
  resolveVapiPhoneNumberId: async () => { vapiCalls.push("resolveVapiPhoneNumberId"); return null; },
  placeVapiOutboundCall: async () => { vapiCalls.push("placeVapiOutboundCall"); return { success: true, callId: "x" }; },
}));

const LANES = [
  ["voice recovery", "FEATURE_VOICE_RECOVERY", async () => (await import("./voiceRecovery")).runVoiceRecovery()],
  ["confirmation calls", "FEATURE_CONFIRMATION_CALLS", async () => (await import("./confirmationCalls")).runConfirmationCalls()],
  ["follow-up cadence", "FEATURE_FOLLOWUP_CADENCE", async () => (await import("./followupCadence")).runFollowupCadence()],
] as const;

beforeEach(async () => {
  dbMode = "rows";
  paused = false;
  otherDbReads = 0;
  vapiCalls.length = 0;
  vi.stubEnv("VAPI_API_KEY", "canary-key");
  const { _resetSendPauseCacheForTest } = await import("../../services/sendPause");
  _resetSendPauseCacheForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(LANES)("%s · voice_outbound pause", (_name, flag, run) => {
  beforeEach(() => {
    vi.stubEnv(flag, "1");
  });

  it("CONTROL: not paused -> the run goes past the gate to the number lookup", async () => {
    const r = await run();
    expect(vapiCalls).toContain("resolveVapiPhoneNumberId");
    expect(r.details).toBe("Skipped · no VAPI outbound number resolvable");
  });

  it("paused -> Skipped · send_pause:voice_outbound, no vapi call, no lead read or claim", async () => {
    paused = true;
    const r = await run();
    expect(r).toEqual({ recordsProcessed: 0, details: "Skipped · send_pause:voice_outbound" });
    expect(vapiCalls).toEqual([]);
    expect(otherDbReads).toBe(0);
  });

  it("unreadable switch -> fail CLOSED: Skipped · send_pause_unreadable:voice_outbound", async () => {
    dbMode = "throw";
    const r = await run();
    expect(r).toEqual({ recordsProcessed: 0, details: "Skipped · send_pause_unreadable:voice_outbound" });
    expect(vapiCalls).toEqual([]);
  });
});
