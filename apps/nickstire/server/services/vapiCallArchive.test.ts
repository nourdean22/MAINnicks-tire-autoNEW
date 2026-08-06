/**
 * VAPI call archive · doctrine tests (pure surface).
 *
 * Pins buildArchivePayload — the mapping that decides what the vault keeps
 * before VAPI's 14-day purge destroys the original. The clipping pins matter
 * most: TiDB runs STRICT_TRANS_TABLES, so an over-width write is REJECTED and
 * the row is LOST — exactly the failure a vault cannot afford.
 */
import { describe, expect, it } from "vitest";
import { buildArchivePayload, type ArchiveSourceRow } from "./vapiCallArchive";

const row: ArchiveSourceRow = {
  vapiCallId: "call-abc",
  phoneNumber: "+14405551234",
  durationSeconds: 93,
  endedReason: "customer-ended-call",
  createdAt: new Date("2026-08-01T14:00:00Z"),
};

const now = new Date("2026-08-05T09:00:00Z");

describe("buildArchivePayload", () => {
  it("maps a full detail — transcript captured, stamp set", () => {
    const p = buildArchivePayload({
      type: "inboundPhoneCall",
      startedAt: "2026-08-01T14:00:05Z",
      endedAt: "2026-08-01T14:01:38Z",
      transcript: "AI: Nick's Tire.\nUser: Do you do alignments?",
      summary: "Caller asked about alignments.",
      messages: [{ role: "bot", message: "Nick's Tire." }],
      recordingUrl: "https://storage.vapi.ai/rec.wav",
      stereoRecordingUrl: "https://storage.vapi.ai/rec-stereo.wav",
      cost: 0.1234,
      analysis: { summary: "Alignment inquiry", successEvaluation: "pass" },
    }, row, now);

    expect(p.transcript).toContain("alignments");
    expect(p.transcriptCapturedAt).toEqual(now);
    expect(p.callType).toBe("inboundPhoneCall");
    expect(p.startedAt).toEqual(new Date("2026-08-01T14:00:05Z"));
    expect(p.endedAt).toEqual(new Date("2026-08-01T14:01:38Z"));
    expect(p.messagesJson).toHaveLength(1);
    expect(p.costTotal).toBe("0.1234");
    expect(p.summary).toBe("Caller asked about alignments.");
  });

  it("falls back to the artifact envelope for transcript/messages/recordings", () => {
    const p = buildArchivePayload({
      artifact: {
        transcript: "artifact transcript",
        messages: [{ role: "user", message: "hi" }],
        recordingUrl: "https://storage.vapi.ai/artifact.wav",
      },
    }, row, now);
    expect(p.transcript).toBe("artifact transcript");
    expect(p.messagesJson).toHaveLength(1);
    expect(p.recordingUrl).toBe("https://storage.vapi.ai/artifact.wav");
  });

  it("empty/whitespace transcript is NOT a capture — retried, never stamped", () => {
    const p = buildArchivePayload({ transcript: "   " }, row, now);
    expect(p.transcript).toBeNull();
    expect(p.transcriptCapturedAt).toBeNull();
  });

  it("falls back to the log row's createdAt when VAPI omits startedAt", () => {
    const p = buildArchivePayload({}, row, now);
    expect(p.startedAt).toEqual(row.createdAt);
    expect(p.endedAt).toBeNull();
  });

  it("clips over-width varchars — STRICT_TRANS_TABLES loses rejected rows", () => {
    const p = buildArchivePayload({
      type: "x".repeat(100),
      recordingUrl: `https://example.com/${"y".repeat(600)}`,
    }, { ...row, endedReason: "z".repeat(100), phoneNumber: "1".repeat(50) }, now);
    expect(p.callType).toHaveLength(32);
    expect(p.recordingUrl).toHaveLength(500);
    expect(p.endedReason).toHaveLength(64);
    expect(p.phoneNumber).toHaveLength(30);
  });

  it("non-numeric cost and non-array messages become NULL, not garbage", () => {
    const p = buildArchivePayload({
      cost: Number.NaN,
      messages: "not-an-array" as unknown as unknown[],
    }, row, now);
    expect(p.costTotal).toBeNull();
    expect(p.messagesJson).toBeNull();
  });
});
