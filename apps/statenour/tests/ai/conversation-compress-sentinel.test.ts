/**
 * Audit 2026-10-10 04-F9 + 04-H3:
 *  - an aiChat outage sentinel ("I'm having trouble connecting...") was cached
 *    as the conversation summary and replayed as context;
 *  - coveredCount was stored as rawMessages.length while the summary only
 *    covered rawMessages.length - KEEP_RECENT, so a reused summary left up to
 *    6 messages in neither the summary nor the verbatim tail;
 *  - recent turns were flattened to text, dropping file/image parts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAiChat = vi.fn();
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  aiChat: (...a: unknown[]) => mockAiChat(...a),
}));

const mockFindFirst = vi.fn();
const mockUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      upsert: (...a: unknown[]) => mockUpsert(...a),
    },
    aiGeneration: { groupBy: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { compressConversation } from "@/lib/ai/conversation-compress";

const SENTINEL = {
  content: "I'm having trouble connecting to my AI providers right now. try again in a moment.",
  provider: "emergency",
  model: "none",
};

const tag = (i: number) => `<<${i}>>`;
function makeMessages(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message ${tag(i)} body` }],
  }));
}

function textOf(messages: Array<{ content: unknown }>): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

beforeEach(() => {
  mockAiChat.mockReset();
  mockFindFirst.mockReset().mockResolvedValue(null);
  mockUpsert.mockReset().mockResolvedValue({});
});

describe("compressConversation - provider sentinel", () => {
  it("rejects a sentinel summary: returns the uncompressed messages and caches nothing", async () => {
    mockAiChat.mockResolvedValue(SENTINEL);
    const raw = makeMessages(24);
    const res = await compressConversation(raw, "conv-sentinel");
    expect(res.compressed).toBe(false);
    expect(res.summary).toBeNull();
    expect(res.messages).toHaveLength(24);
    expect(textOf(res.messages as Array<{ content: unknown }>)).not.toContain("trouble connecting");
    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("compressConversation - coverage (coveredCount)", () => {
  it("a reused summary leaves no message in neither the summary nor the verbatim tail", async () => {
    // Turn A: 22 messages, no cache -> fresh summary of the first 18.
    mockAiChat.mockResolvedValueOnce({ content: "SUMMARY-A", provider: "ollama", model: "m" });
    await compressConversation(makeMessages(22), "conv-cover");
    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const transcriptA = (mockAiChat.mock.calls[0][0] as Array<{ content: string }>)[1].content;
    const stored = mockUpsert.mock.calls[0][0] as {
      create: { content: string; metadata: Record<string, unknown> };
    };

    // Turn B: 24 messages, the row written in turn A is the cache.
    mockFindFirst.mockResolvedValue({ content: stored.create.content, metadata: stored.create.metadata });
    const res = await compressConversation(makeMessages(24), "conv-cover");
    expect(res.compressed).toBe(true);
    const outB = textOf(res.messages as Array<{ content: unknown }>);
    for (let i = 0; i < 24; i++) {
      const covered = transcriptA.includes(tag(i)) || outB.includes(tag(i));
      expect(covered, `message ${i} is in neither the summary nor the recent tail`).toBe(true);
    }
  });
});

describe("compressConversation - recent turns keep their parts", () => {
  it("an image attached in a recent turn survives compression", async () => {
    mockAiChat.mockResolvedValue({ content: "SUMMARY", provider: "ollama", model: "m" });
    const raw = makeMessages(24);
    raw[22] = {
      id: "m22",
      role: "user",
      parts: [
        { type: "text", text: `look at this ${tag(22)}` },
        { type: "file", mediaType: "image/png", url: "data:image/png;base64,iVBORw0KGgo=" },
      ],
    };
    const res = await compressConversation(raw, undefined);
    expect(res.compressed).toBe(true);
    const parts = (res.messages as Array<{ content: unknown }>)
      .flatMap((m) => (Array.isArray(m.content) ? (m.content as Array<{ type?: string }>) : []));
    expect(parts.some((p) => p.type === "file" || p.type === "image")).toBe(true);
  });
});
