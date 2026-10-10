/**
 * Audit 2026-10-10 (00-production-evidence): on a provider outage the live
 * judge logged `judge_unknown_family_discarded judgedBy="emergency:none"` and
 * returned null, so an outage was indistinguishable from "not judged" and no
 * coverage was persisted. A sentinel judge result must persist an UNKNOWN
 * coverage row (judgedBy "unavailable", no scores) and log judge_unavailable.
 * The public judgeReply contract (report or null) is unchanged for scripts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  makeTracedAiChat: () => (...a: unknown[]) => mockChat(...a),
}));
// Guardian retry/receipt machinery is not under test: pass the fn through.
vi.mock("@/lib/tools/guardian", () => ({
  withGuardian: (_id: string, fn: unknown) => fn,
}));
const mockRemember = vi.fn();
vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: { remember: (...a: unknown[]) => mockRemember(...a) },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) } },
}));

import { judgeReply, judgeReplyAsync } from "@/lib/ai/judge-eval";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};
const ARGS = {
  userQuery: "How many open estimates?",
  assistantReply: "You have 12 open estimates.",
  generatedByProvider: "ollama",
  generatedByModel: "deepseek-v4-flash:0731",
};
const JUDGE_JSON = JSON.stringify({
  accuracy: 8,
  actionability: 7,
  brevity: 9,
  tone: 8,
  evidence: 7,
  obedience: 9,
  nonSycophancy: 8,
  calibration: 8,
  reasoning: "solid",
});

beforeEach(() => {
  mockChat.mockReset();
  mockRemember.mockReset().mockResolvedValue({});
});

describe("judge-eval - provider sentinel", () => {
  it("persists an UNKNOWN coverage row instead of discarding silently", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await judgeReplyAsync({ ...ARGS, messageId: "msg-1" });
    expect(mockRemember).toHaveBeenCalledTimes(1);
    const [category, key, , source, meta] = mockRemember.mock.calls[0] as [
      string,
      string,
      string,
      string,
      Record<string, unknown>,
    ];
    expect(category).toBe("reply_judgment");
    expect(source).toBe("judge-eval");
    expect(meta.verdict).toBe("UNKNOWN");
    expect(meta.judgedBy).toBe("unavailable");
    expect(meta.messageId).toBe("msg-1");
    // a coverage row is not a score: no rubric / composite for any reader to average
    expect(meta.rubric).toBeUndefined();
    expect(meta.composite).toBeUndefined();
    // must not occupy the real judgment key (the persona backfill reads
    // judge_<id> as "already judged")
    expect(key).not.toBe("judge_msg-1");
  });

  it("public judgeReply still returns null on a sentinel", async () => {
    mockChat.mockResolvedValue(SENTINEL);
    await expect(judgeReply(ARGS)).resolves.toBeNull();
  });

  it("control: a real cross-family judgment is persisted with its scores", async () => {
    mockChat.mockResolvedValue({ content: JUDGE_JSON, provider: "openai", model: "gpt-5.6" });
    await judgeReplyAsync({ ...ARGS, messageId: "msg-2" });
    expect(mockRemember).toHaveBeenCalledTimes(1);
    const [, key, , , meta] = mockRemember.mock.calls[0] as [string, string, string, string, Record<string, unknown>];
    expect(key).toBe("judge_msg-2");
    expect(meta.composite).toBe(7.8);
    expect(meta.judgedBy).toBe("openai:gpt-5.6");
  });
});
