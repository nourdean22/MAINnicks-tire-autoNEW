/**
 * Audit 2026-10-10 04-H3: the deep-reasoning lane shipped the aiChat outage
 * sentinel ("I'm having trouble connecting...") as the answer at confidence
 * 0.75-0.9 and persisted it as a reasoning trace + recallable conclusion.
 * runDraft / runRefine must treat a sentinel as a failure (throw), and a
 * failed run must not be persisted as a recallable reasoning conclusion
 * (the bookkeeping trace row is still written: cost telemetry reads it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));

const mockMemoryCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: { create: (...a: unknown[]) => mockMemoryCreate(...a) },
    systemMetric: { create: vi.fn().mockResolvedValue({}) },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/ai/pretask-fanout", () => ({
  runFanout: vi.fn().mockResolvedValue({ composite: "" }),
}));
vi.mock("@/lib/ai/greene-message-matcher", () => ({
  pickContextualLawsForMessage: vi.fn().mockResolvedValue([]),
  renderGreeneBlock: () => "",
}));
vi.mock("@/lib/ai/dark-psychology-matcher", () => ({
  pickDarkPsychologyForMessage: vi.fn().mockResolvedValue([]),
  renderDarkPsychologyBlock: () => "",
}));
const mockConclusion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/reasoning/persist-conclusion", () => ({
  persistReasoningConclusion: (...a: unknown[]) => mockConclusion(...a),
}));

import { __internals, reasonStreaming } from "@/lib/ai/reasoning/engine";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const ok = (content: string) => ({ content, provider: "ollama", model: "m" });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockChat.mockReset();
  mockMemoryCreate.mockReset().mockResolvedValue({});
  mockConclusion.mockReset().mockResolvedValue(undefined);
});

describe("reasoning engine - provider sentinel", () => {
  it("runDraft throws on a sentinel instead of returning it as the answer", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(__internals.runDraft("Should I hire?", "ctx")).rejects.toMatchObject({
      name: "AiUnavailableError",
    });
  });

  it("runRefine throws on a sentinel instead of replacing the draft with it", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(
      __internals.runRefine("Should I hire?", "draft text", { issues: ["too vague"], suggestions: [] }),
    ).rejects.toMatchObject({ name: "AiUnavailableError" });
  });

  it("control: runRefine returns a real refined answer", async () => {
    mockChat.mockResolvedValue(ok("Refined: hire one tech in March."));
    await expect(
      __internals.runRefine("Should I hire?", "draft text", { issues: ["too vague"], suggestions: [] }),
    ).resolves.toBe("Refined: hire one tech in March.");
  });

  it("standard tier outage: honest low-confidence answer, no conclusion persisted", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const res = await reasonStreaming({ question: "Should I hire a second tech?", tier: "standard" }, () => {});
    expect(res.trace.answer).not.toContain("trouble connecting");
    expect(res.trace.confidence).toBeLessThanOrEqual(0.2);
    await flush();
    expect(mockConclusion).not.toHaveBeenCalled();
  });

  it("quick tier outage: the sentinel is not shipped or persisted as a conclusion", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const res = await reasonStreaming({ question: "What day is it?", tier: "quick" }, () => {});
    expect(res.trace.answer).not.toContain("trouble connecting");
    expect(res.trace.confidence).toBeLessThanOrEqual(0.2);
    await flush();
    expect(mockConclusion).not.toHaveBeenCalled();
  });

  it("control: a real quick answer is shipped and persisted", async () => {
    mockChat.mockResolvedValue(ok("It is Saturday."));
    const res = await reasonStreaming({ question: "What day is it?", tier: "quick" }, () => {});
    expect(res.trace.answer).toBe("It is Saturday.");
    await flush();
    expect(mockMemoryCreate).toHaveBeenCalled();
    expect(mockConclusion).toHaveBeenCalledTimes(1);
  });
});
