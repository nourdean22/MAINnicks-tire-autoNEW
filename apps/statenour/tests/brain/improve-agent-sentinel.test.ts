/**
 * Audit 2026-10-10 sentinel sweep (Task 2b): the 182-char outage apology
 * passed improve-agent's `>= 20 chars` check and was persisted as the
 * proposed rule change of an improvement_hypothesis memory. A sentinel must
 * fall back to the static rule text, exactly like a thrown call.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { analyzeJudgmentsWithSynthesis } from "@/lib/brain/improve-agent";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment, or switch to a different mode.",
  provider: "emergency",
  model: "none",
};

const baseRubric = { accuracy: 8, actionability: 8, brevity: 8, tone: 8, evidence: 8 };
const row = (score: number, i: number) => ({
  messageId: `m_${i}`,
  composite: 7,
  rubric: { ...baseRubric, tone: score },
  reasoning: `too flattering ${i}`,
  judgedAt: new Date(),
});
const JUDGMENTS = [
  ...Array.from({ length: 6 }, (_, i) => row(2, i)),
  ...Array.from({ length: 24 }, (_, i) => row(8, i + 10)),
];

beforeEach(() => mockChat.mockReset());

describe("improve-agent synthesis - provider sentinel", () => {
  it("does not adopt the outage text as the proposed rule change", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    const [h] = await analyzeJudgmentsWithSynthesis(JUDGMENTS);
    expect(h.axis).toBe("tone");
    expect(h.proposedRuleChange).not.toContain("trouble connecting");
  });

  it("control: a real synthesized edit is adopted", async () => {
    const edit = "Add to NO_SYCOPHANCY: ban the opener 'Great question' and any praise before the answer.";
    mockChat.mockResolvedValue({ content: edit, provider: "ollama", model: "m" });
    const [h] = await analyzeJudgmentsWithSynthesis(JUDGMENTS);
    expect(h.proposedRuleChange).toBe(edit);
  });
});
