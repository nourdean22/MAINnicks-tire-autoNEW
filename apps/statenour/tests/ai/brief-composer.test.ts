/**
 * AG-40 · shared brief-composer contract tests (mocked prisma +
 * tracedAiChat). Locks: cache hit skips the AI call; cache miss
 * composes + writes; the grounding footer rides every system prompt;
 * <think>-scrub + trim; bypassCache skips both cache sides.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
  },
}));

const mockChat = vi.fn();
vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: (...a: unknown[]) => mockChat(...a),
}));

import { composeBrief, scrubThinkTags, GROUNDING_FOOTER } from "@/lib/ai/brief-composer";

const BASE = {
  label: "test-brief",
  cacheCategory: "test_brief",
  cacheKey: "2026-07-09:v1",
  systemPrompt: "Write 2 sentences.",
  signalBlock: "SIGNALS: 3 goals active",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue(null);
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
});

describe("composeBrief", () => {
  it("cache hit returns instantly — no AI call, no write", async () => {
    mockFindFirst.mockResolvedValueOnce({ content: "cached brief" });
    const out = await composeBrief(BASE);
    expect(out).toBe("cached brief");
    expect(mockChat).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("cache miss composes with the grounding footer and writes", async () => {
    mockChat.mockResolvedValueOnce({ content: "fresh brief" });
    const out = await composeBrief(BASE);
    expect(out).toBe("fresh brief");
    const messages = mockChat.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain(GROUNDING_FOOTER.trim());
    expect(messages[1].content).toBe(BASE.signalBlock);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("scrubs <think> scratchpads and trims to maxChars", async () => {
    mockChat.mockResolvedValueOnce({
      content: "<think>secret scratchpad</think>  the actual brief text here",
    });
    const out = await composeBrief({ ...BASE, maxChars: 10 });
    expect(out).toBe("the actual");
    expect(out).not.toContain("scratchpad");
  });

  it("bypassCache skips both cache read and write", async () => {
    mockChat.mockResolvedValueOnce({ content: "fresh" });
    const out = await composeBrief({ ...BASE, bypassCache: true });
    expect(out).toBe("fresh");
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("compose failure degrades to empty (surface self-hides)", async () => {
    mockChat.mockRejectedValueOnce(new Error("provider down"));
    expect(await composeBrief(BASE)).toBe("");
  });
});

describe("scrubThinkTags", () => {
  it("removes multiline think blocks", () => {
    expect(scrubThinkTags("a<think>\nx\ny\n</think>b")).toBe("ab");
  });
});
