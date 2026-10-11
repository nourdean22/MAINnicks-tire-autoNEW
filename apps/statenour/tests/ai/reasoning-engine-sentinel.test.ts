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
// Deep tier: no real sub-agents; the engine falls back to the (mocked) fanout.
vi.mock("@/lib/ai/multi-agent-orchestrator", () => ({
  runMultiAgent: vi.fn().mockRejectedValue(new Error("not under test")),
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

  // Audit 04-X6 (a): a critic outage parsed as malformed JSON -> "ship" ->
  // stored as a 0.9 "ship as-is" verdict nobody actually gave.
  const isCritic = (msgs: Array<{ content: string }>) => msgs.some((m) => m.content.includes("adversarial critic"));
  const DRAFT = "Hire one tech in March; the bay is idle two days a week.";

  it("deep tier: a critic sentinel is a failed critique (0.75, no ship-as-is step), not a 0.9 ship verdict", async () => {
    mockChat.mockImplementation(async (msgs: Array<{ content: string }>) => (isCritic(msgs) ? SENTINEL : ok(DRAFT)));
    const res = await reasonStreaming({ question: "Should I hire a second tech?", tier: "deep" }, () => {});
    expect(res.trace.answer).toBe(DRAFT);
    expect(res.trace.confidence).toBe(0.75);
    const labels = res.trace.steps.map((s) => s.label);
    expect(labels.some((l) => /^critique \S ship as-is$/.test(l))).toBe(false);
  });

  it("control: a real ship verdict on the deep tier still earns 0.9 and its step", async () => {
    mockChat.mockImplementation(async (msgs: Array<{ content: string }>) =>
      isCritic(msgs) ? ok('{"issues":[],"suggestions":[],"verdict":"ship"}') : ok(DRAFT),
    );
    const res = await reasonStreaming({ question: "Should I hire a second tech?", tier: "deep" }, () => {});
    expect(res.trace.confidence).toBe(0.9);
    expect(res.trace.steps.some((s) => /^critique \S ship as-is$/.test(s.label))).toBe(true);
  });

  it("runPlan returns an empty plan on a sentinel instead of feeding outage prose downstream", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(__internals.runPlan("Should I hire?", "deep")).resolves.toBe("");
  });

  it("control: runPlan returns a real plan", async () => {
    mockChat.mockResolvedValue(ok("1. Count idle bay days."));
    await expect(__internals.runPlan("Should I hire?", "deep")).resolves.toBe("1. Count idle bay days.");
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
