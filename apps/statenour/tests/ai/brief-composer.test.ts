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

import {
  composeBrief,
  scrubThinkTags,
  isProviderSentinel,
  GROUNDING_FOOTER,
} from "@/lib/ai/brief-composer";

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

/**
 * Journal audit 2026-07-15 · provider-sentinel guards.
 *
 * aiChat NEVER throws on total provider-chain failure — it returns an
 * "I'm having trouble connecting…" sentinel with provider "emergency"
 * (lib/ai/provider.ts). Pre-fix, composeBrief treated that sentinel as
 * a valid brief and CACHED it under the day key, poisoning every brief
 * surface for the rest of the day AND leaking the first 50 chars of the
 * signal block into the UI (seen live on /journal 2026-07-15).
 */
const SENTINEL =
  'I\'m having trouble connecting to my AI providers right now. You asked about "ACTIVE_THREADS (0): (none)..." — try again in a moment, or switch to a different mode.';

describe("composeBrief · provider-failure guards", () => {
  it("returns empty and caches nothing when provider is 'emergency'", async () => {
    mockChat.mockResolvedValueOnce({ content: SENTINEL, provider: "emergency", model: "none" });
    expect(await composeBrief(BASE)).toBe("");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns empty and caches nothing when provider is 'none'", async () => {
    mockChat.mockResolvedValueOnce({ content: SENTINEL, provider: "none", model: "none" });
    expect(await composeBrief(BASE)).toBe("");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses sentinel-shaped content even if the provider field looks healthy", async () => {
    mockChat.mockResolvedValueOnce({ content: SENTINEL, provider: "openrouter", model: "gpt" });
    expect(await composeBrief(BASE)).toBe("");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats a cached sentinel as a miss and overwrites it on successful recompose", async () => {
    // 1st findFirst = cache read (poisoned) · 2nd = cache-write existence check
    mockFindFirst
      .mockResolvedValueOnce({ content: SENTINEL })
      .mockResolvedValueOnce({ id: "poisoned-row" });
    mockChat.mockResolvedValueOnce({ content: "REAL BRIEF", provider: "openrouter", model: "gpt" });

    expect(await composeBrief(BASE)).toBe("REAL BRIEF");
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockUpdate.mock.calls[0][0] as { data: { content: string } };
    expect(updateArg.data.content).toBe("REAL BRIEF");
  });
});

describe("isProviderSentinel", () => {
  it("matches the aiChat emergency fallback text (with leading whitespace)", () => {
    expect(isProviderSentinel(SENTINEL)).toBe(true);
    expect(isProviderSentinel("  " + SENTINEL)).toBe(true);
  });

  it("does not match real brief content", () => {
    expect(isProviderSentinel("COMPOUNDING: water thread gaining pace.")).toBe(false);
  });
});
