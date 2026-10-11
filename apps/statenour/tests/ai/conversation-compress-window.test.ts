/**
 * Long threads (audit 04-F15, 2026-10-10).
 *
 * The gate refuses more than 200 messages, so from message 201 every send in
 * a conversation failed with a 400. The client now sends only its last 150
 * messages plus `historyOffset` (how many older ones it left out). The cached
 * summary counts ABSOLUTE positions, so compressConversation shifts by that
 * offset: otherwise the count-based cache never matches a windowed request
 * and every turn re-summarizes (or reuses a summary at the wrong cutoff).
 *
 * Also pinned here (audit 04-X4): the summary block tells the model that the
 * verbatim recent messages win where they disagree with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { parseHistoryOffset } from "@/lib/ai/chat/gate";

const tag = (i: number) => `<<${i}>>`;
/** Absolute messages [from, to): the slice a windowed client sends. */
function abs(from: number, to: number): Array<Record<string, unknown>> {
  return Array.from({ length: to - from }, (_, j) => {
    const i = from + j;
    return { id: `m${i}`, role: i % 2 === 0 ? "user" : "assistant", parts: [{ type: "text", text: `message ${tag(i)} body` }] };
  });
}
const cachedRow = (coveredCount: number) => ({
  content: "CACHED-SUMMARY",
  metadata: { coveredCount, coverage: "cutoff", compressedAt: "2026-10-10T00:00:00Z" },
});
const textOf = (messages: Array<{ content: unknown }>) =>
  messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");

beforeEach(() => {
  mockAiChat.mockReset().mockResolvedValue({ content: "FRESH-SUMMARY", provider: "ollama", model: "m" });
  mockFindFirst.mockReset().mockResolvedValue(null);
  mockUpsert.mockReset().mockResolvedValue({});
});

describe("compressConversation - a windowed request (historyOffset)", () => {
  it("reuses the cached summary at its absolute cutoff: no summarizer call, tail = abs[246..250)", async () => {
    mockFindFirst.mockResolvedValue(cachedRow(246));
    const res = await compressConversation(abs(100, 250), "conv-long", 100);
    expect(mockAiChat).not.toHaveBeenCalled();
    expect(res.compressed).toBe(true);
    const tail = textOf(res.messages.slice(1) as Array<{ content: unknown }>);
    for (let i = 246; i < 250; i++) expect(tail).toContain(tag(i));
    expect(tail).not.toContain(tag(245));
    expect(res.messages).toHaveLength(1 + 4);
  });

  it("a fresh summary is stored with its ABSOLUTE coverage (offset + cutoff)", async () => {
    await compressConversation(abs(100, 250), "conv-long", 100);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockAiChat).toHaveBeenCalledTimes(1);
    const stored = mockUpsert.mock.calls[0]![0] as { create: { metadata: { coveredCount: number } } };
    expect(stored.create.metadata.coveredCount).toBe(246);
  });

  it("a cached summary that ends before the window starts is rebuilt (messages in between would be lost)", async () => {
    mockFindFirst.mockResolvedValue(cachedRow(90));
    await compressConversation(abs(100, 250), "conv-long", 100);
    expect(mockAiChat).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - an unwindowed request (offset 0) keeps today's behaviour", async () => {
    mockFindFirst.mockResolvedValue(cachedRow(18));
    const res = await compressConversation(abs(0, 24), "conv-short", 0);
    expect(mockAiChat).not.toHaveBeenCalled();
    const tail = textOf(res.messages.slice(1) as Array<{ content: unknown }>);
    for (let i = 18; i < 24; i++) expect(tail).toContain(tag(i));
  });
});

describe("gate - historyOffset is a client claim, parsed defensively", () => {
  it("a non-negative integer passes through", () => {
    expect(parseHistoryOffset({ historyOffset: 100 })).toBe(100);
    expect(parseHistoryOffset({ historyOffset: 0 })).toBe(0);
  });

  it("absent or malformed degrades to 0 (today's unwindowed behaviour), never throws", () => {
    expect(parseHistoryOffset({})).toBe(0);
    expect(parseHistoryOffset({ historyOffset: -5 })).toBe(0);
    expect(parseHistoryOffset({ historyOffset: 2.5 })).toBe(0);
    expect(parseHistoryOffset({ historyOffset: "100" })).toBe(0);
    expect(parseHistoryOffset({ historyOffset: Number.POSITIVE_INFINITY })).toBe(0);
  });
});

describe("compressConversation - the summary yields to the recent messages (04-X4)", () => {
  it("the summary block says the recent messages are current where they conflict", async () => {
    const res = await compressConversation(abs(0, 24), "conv-x4");
    expect(res.compressed).toBe(true);
    expect(String(res.messages[0]!.content)).toContain(
      "Where this summary conflicts with the recent messages, the recent messages are current.",
    );
  });
});
