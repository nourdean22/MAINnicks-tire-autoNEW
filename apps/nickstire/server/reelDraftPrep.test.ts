/**
 * prepareCleanReelBrief — regenerate-on-preflight-block loop. The M10 preflight
 * runs for REAL against a known-blocking sample (a diagnostic-screen beat, the
 * same block the CC2 acceptance suite uses); only the non-deterministic LLM and
 * the credit-spending visual-world attach are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";

const genMock = vi.hoisted(() => vi.fn());
const attachMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./services/reelBriefGen", () => ({ generateReelBriefAI: genMock }));
vi.mock("./services/visualWorld", () => ({ attachAutonomousVisualWorld: attachMock }));

import { prepareCleanReelBrief, PreflightExhaustedError } from "./services/reelDraftPrep";

function blockingBrief() {
  const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
  // A beat that depends on a rendered diagnostic screen — M10 blocks it.
  b.storyboardBeats[0].visual = "a diagnostic scanner screen displays the battery voltage reading";
  return b;
}
const cleanBrief = () => structuredClone(SAMPLE_REEL_BRIEFS[0]);

describe("prepareCleanReelBrief", () => {
  beforeEach(() => { genMock.mockReset(); attachMock.mockClear(); });

  it("retries past a preflight-blocking brief and returns the first clean one", async () => {
    genMock
      .mockResolvedValueOnce({ brief: blockingBrief(), rawModel: "m" })
      .mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });

    const res = await prepareCleanReelBrief({ topic: "t" }, { maxAttempts: 3 });

    expect(res.attempts).toBe(2);
    expect(res.rejectedForPreflight.length).toBe(1);
    expect(res.rejectedForPreflight[0].join(" ")).toMatch(/in-frame text|Seedance cannot spell/i);
    expect(genMock).toHaveBeenCalledTimes(2);
    // visual world attached + prompt pack built ONLY for the clean brief.
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(res.brief.higgsfieldPromptPack).toBeTruthy();
  });

  it("does not attach the visual world (no credit spend) for rejected briefs", async () => {
    genMock.mockResolvedValueOnce({ brief: blockingBrief(), rawModel: "m" }).mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });
    await prepareCleanReelBrief({ topic: "t" }, { maxAttempts: 3 });
    // One rejected + one clean => attach called exactly once (for the clean one).
    expect(attachMock).toHaveBeenCalledTimes(1);
  });

  it("throws a typed PreflightExhaustedError after exhausting attempts (so the daily cron can distinguish it from an outage)", async () => {
    genMock.mockResolvedValue({ brief: blockingBrief(), rawModel: "m" });
    let caught: unknown;
    try { await prepareCleanReelBrief({ topic: "t" }, { maxAttempts: 2 }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PreflightExhaustedError);
    expect((caught as PreflightExhaustedError).message).toMatch(/preflight blocked on all 2 attempts/);
    expect((caught as PreflightExhaustedError).rejected.length).toBe(2);
    expect(genMock).toHaveBeenCalledTimes(2);
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("returns immediately (attempt 1) for a clean first brief", async () => {
    genMock.mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });
    const res = await prepareCleanReelBrief({ topic: "t" });
    expect(res.attempts).toBe(1);
    expect(res.rejectedForPreflight).toEqual([]);
    expect(genMock).toHaveBeenCalledTimes(1);
  });
});
