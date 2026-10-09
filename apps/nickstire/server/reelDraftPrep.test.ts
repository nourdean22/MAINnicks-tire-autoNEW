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
const recentSignalsMock = vi.hoisted(() =>
  vi.fn(async () => ({ topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] })),
);
vi.mock("./services/reelBriefGen", () => ({ generateReelBriefAI: genMock }));
vi.mock("./services/visualWorld", () => ({ attachAutonomousVisualWorld: attachMock }));
vi.mock("./services/reelRepetitionHistory", () => ({
  getRecentReelSignals: recentSignalsMock,
  DEFAULT_REPETITION_WINDOW_DAYS: 21,
}));

import { prepareCleanReelBrief, PreflightExhaustedError } from "./services/reelDraftPrep";

function blockingBrief() {
  const b = structuredClone(SAMPLE_REEL_BRIEFS[0]);
  // A beat that depends on a rendered diagnostic screen — M10 blocks it.
  b.storyboardBeats[0].visual = "a diagnostic scanner screen displays the battery voltage reading";
  return b;
}
const cleanBrief = () => structuredClone(SAMPLE_REEL_BRIEFS[0]);

describe("prepareCleanReelBrief", () => {
  beforeEach(() => {
    genMock.mockReset();
    attachMock.mockClear();
    recentSignalsMock.mockReset();
    recentSignalsMock.mockResolvedValue({ topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] });
  });

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

  it("regenerates past a brief that passes preflight but enqueue would refuse (placeholder beat, unsafe claim)", async () => {
    // Review 2026-10-08: these are typed refusals at enqueue, so a brief that
    // reached enqueue with one cost the miner lane its day instead of a retry.
    const placeholder = cleanBrief();
    placeholder.storyboardBeats[1].visual = "Close inspection of the relevant components under clean shop light";
    const unsafe = cleanBrief();
    unsafe.voiceoverScript = "Clear the codes and you'll pass E-Check.";
    genMock
      .mockResolvedValueOnce({ brief: placeholder, rawModel: "m" })
      .mockResolvedValueOnce({ brief: unsafe, rawModel: "m" })
      .mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });
    const res = await prepareCleanReelBrief({ topic: "t" }, { maxAttempts: 3 });
    expect(res.attempts).toBe(3);
    expect(res.rejectedForPreflight[0].join(" ")).toMatch(/ungeneratable beats: 2:needs_subject/);
    expect(res.rejectedForPreflight[1].join(" ")).toMatch(/condemned script: .*echeck readiness truth packet/);
    expect(attachMock).toHaveBeenCalledTimes(1);
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
    expect((caught as PreflightExhaustedError).message).toMatch(/reel brief blocked on all 2 attempts/);
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

  // ScanFinish NT-010: the memory layer was pure logic (buildRepetitionChecks)
  // with nothing supplying it real history — these prove the wiring, not the
  // pure function (that's covered by faceless-reel-studio.test.ts already).
  it("regenerates when the topic repeats real recent history, even though the brief passes preflight", async () => {
    const repeat = cleanBrief();
    const fresh = cleanBrief();
    fresh.topic = "a genuinely new topic not in recent history";
    recentSignalsMock.mockResolvedValue({
      topics: [repeat.topic],
      keywords: [],
      archetypes: [],
      motionLenses: [],
      objectCharacters: [],
    });
    genMock.mockResolvedValueOnce({ brief: repeat, rawModel: "m" }).mockResolvedValueOnce({ brief: fresh, rawModel: "m" });

    const res = await prepareCleanReelBrief({ topic: "t" }, { maxAttempts: 3 });

    expect(res.attempts).toBe(2);
    expect(res.rejectedForPreflight[0].join(" ")).toMatch(/topic repeats a reel from the last 21 days/);
    expect(genMock).toHaveBeenCalledTimes(2);
    expect(attachMock).toHaveBeenCalledTimes(1);
  });

  it("passes real recent topics as avoidTopics on every attempt when the caller supplied none", async () => {
    recentSignalsMock.mockResolvedValue({
      topics: ["bald tires in winter"],
      keywords: [],
      archetypes: [],
      motionLenses: [],
      objectCharacters: [],
    });
    genMock.mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });

    await prepareCleanReelBrief({ topic: "t" });

    expect(genMock).toHaveBeenCalledWith(expect.objectContaining({ avoidTopics: ["bald tires in winter"] }));
  });

  it("an operator-supplied avoidTopics wins over real history", async () => {
    recentSignalsMock.mockResolvedValue({
      topics: ["history topic"],
      keywords: [],
      archetypes: [],
      motionLenses: [],
      objectCharacters: [],
    });
    genMock.mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });

    await prepareCleanReelBrief({ topic: "t", avoidTopics: ["operator topic"] });

    expect(genMock).toHaveBeenCalledWith(expect.objectContaining({ avoidTopics: ["operator topic"] }));
  });

  it("a DB-down/empty history never blocks the pipeline — no repetition finding when there is nothing to compare against", async () => {
    recentSignalsMock.mockResolvedValue({ topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] });
    genMock.mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });

    const res = await prepareCleanReelBrief({ topic: "t" });

    expect(res.attempts).toBe(1);
    expect(res.rejectedForPreflight).toEqual([]);
  });
});

describe("hook fatigue reaches the generator (2026-10-08)", () => {
  beforeEach(() => {
    genMock.mockReset();
    recentSignalsMock.mockReset();
  });
  const base = { topics: [], keywords: [], archetypes: [], motionLenses: [], objectCharacters: [] };

  it("a shape that opened most recent Reels is passed as hookFatigue", async () => {
    recentSignalsMock.mockResolvedValue({
      ...base, available: true,
      hookGrammars: ["symptom_question", "symptom_question", "symptom_question", "symptom_question", "symptom_question", "command", "number_lead", "symptom_question"],
    } as never);
    genMock.mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });
    await prepareCleanReelBrief({ topic: "t" });
    expect(genMock).toHaveBeenCalledWith(expect.objectContaining({ hookFatigue: { grammar: "symptom_question", count: 6, of: 8 } }));
  });

  it("an unreadable history steers nothing", async () => {
    recentSignalsMock.mockResolvedValue({ ...base, available: false, hookGrammars: Array(10).fill("command") } as never);
    genMock.mockResolvedValueOnce({ brief: cleanBrief(), rawModel: "m" });
    await prepareCleanReelBrief({ topic: "t" });
    expect(genMock.mock.calls[0][0]).not.toHaveProperty("hookFatigue");
  });
});
