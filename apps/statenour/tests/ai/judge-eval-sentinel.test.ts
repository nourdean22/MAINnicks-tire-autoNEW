/**
 * Audit 2026-10-10 (00-production-evidence): on a provider outage the live
 * judge logged `judge_unknown_family_discarded judgedBy="emergency:none"` and
 * returned null, so an outage was indistinguishable from "not judged" and no
 * coverage was persisted. A sentinel judge result must persist an UNKNOWN
 * coverage row (judgedBy "unavailable", no scores) and log judge_unavailable.
 * The public judgeReply contract (report or null) is unchanged for scripts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
const mockJudgmentRows = vi.fn();
const mockChatRows = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
    brainMemory: { findMany: (...a: unknown[]) => mockJudgmentRows(...a) },
    chatMessage: { findMany: (...a: unknown[]) => mockChatRows(...a) },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

import { JUDGE_PROMPT_HASH, judgeReply, judgeReplyAsync } from "@/lib/ai/judge-eval";

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

// Audit 2026-10-10 06-X4: a thrown or empty judge call returned null and left no
// coverage row, so "judging failed" read as "never judged".
describe("judge-eval - thrown or empty judge call", () => {
  it("tracedChat rejects -> one coverage row judge_unavailable_<id>", async () => {
    mockChat.mockRejectedValue(new Error("fetch failed"));
    await judgeReplyAsync({ ...ARGS, messageId: "msg-3" });
    expect(mockRemember).toHaveBeenCalledTimes(1);
    const [, key, , , meta] = mockRemember.mock.calls[0] as [string, string, string, string, Record<string, unknown>];
    expect(key).toBe("judge_unavailable_msg-3");
    expect(meta.verdict).toBe("UNKNOWN");
    expect(meta.composite).toBeUndefined();
  });

  it("an empty completion -> one coverage row", async () => {
    mockChat.mockResolvedValue({ content: "   ", provider: "openai", model: "gpt-5.6" });
    await judgeReplyAsync({ ...ARGS, messageId: "msg-4" });
    expect(mockRemember).toHaveBeenCalledTimes(1);
    expect(mockRemember.mock.calls[0][1]).toBe("judge_unavailable_msg-4");
  });

  it("CONTROL: a same-family discard still writes nothing (a refusal, not an outage)", async () => {
    mockChat.mockResolvedValue({ content: JUDGE_JSON, provider: "ollama", model: "deepseek-v4-flash:0731" });
    await judgeReplyAsync({ ...ARGS, messageId: "msg-5" });
    expect(mockRemember).not.toHaveBeenCalled();
  });

  it("public judgeReply still returns null on a throw", async () => {
    mockChat.mockRejectedValue(new Error("fetch failed"));
    await expect(judgeReply(ARGS)).resolves.toBeNull();
  });
});

// Audit 2026-10-10 06-X3: a judge-prompt edit made old and new scores look comparable.
describe("judge-eval - prompt hash rides the scored row", () => {
  it("a scored row carries judgePromptHash", async () => {
    mockChat.mockResolvedValue({ content: JUDGE_JSON, provider: "openai", model: "gpt-5.6" });
    await judgeReplyAsync({ ...ARGS, messageId: "msg-6" });
    const meta = mockRemember.mock.calls[0][4] as Record<string, unknown>;
    expect(meta.judgePromptHash).toBe(JUDGE_PROMPT_HASH);
    expect(JUDGE_PROMPT_HASH).toMatch(/^[0-9a-f]{12}$/);
  });
});

// 06-X4 consumer: the instrument report read a coverage row's judgedBy
// "unavailable" as a judge lane with NaN scores.
describe("report-nick-instruments - coverage rows are not a lane", () => {
  it("skips verdict UNKNOWN and prints how many were not judged", async () => {
    const rubric = { accuracy: 8, actionability: 7, brevity: 9, tone: 8, evidence: 7 };
    mockJudgmentRows.mockResolvedValue([
      { metadata: { verdict: "UNKNOWN", judgedBy: "unavailable", messageId: "m1" } },
      { metadata: { judgedBy: "openai:gpt-5.6", rubric, judgePromptHash: "aaaaaaaaaaaa" } },
    ]);
    mockChatRows.mockResolvedValue([{ content: "Likely (70%), moderate confidence." }]);
    const lines = await runReport();
    expect(lines.some((l) => l.includes("not judged (no provider): 1"))).toBe(true);
    expect(lines.some((l) => l.includes("rows: 1 "))).toBe(true);
    expect(lines.some((l) => l.includes("judge prompt versions: aaaaaaaaaaaa=1"))).toBe(true);
    expect(lines.some((l) => l.includes("unavailable"))).toBe(false);
    expect(process.exitCode).not.toBe(3);
  });

  it("a run that measured nothing exits 3, never 0", async () => {
    mockJudgmentRows.mockResolvedValue([{ metadata: { verdict: "UNKNOWN", judgedBy: "unavailable" } }]);
    mockChatRows.mockResolvedValue([]);
    const lines = await runReport();
    expect(process.exitCode).toBe(3);
    expect(lines.some((l) => l.includes("nothing measured"))).toBe(true);
  });
});

async function runReport(): Promise<string[]> {
  const lines: string[] = [];
  const prevExit = process.exitCode;
  process.exitCode = undefined;
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
  vi.resetModules();
  await import("../../scripts/report-nick-instruments");
  await vi.waitFor(() => expect(lines).toContain("\ndone."), { timeout: 10_000 });
  // let the script's .finally() run before reading exitCode
  await new Promise((r) => setTimeout(r, 0));
  spy.mockRestore();
  afterRun.push(() => (process.exitCode = prevExit));
  return lines;
}

const afterRun: Array<() => void> = [];
afterEach(() => afterRun.splice(0).forEach((f) => f()));
