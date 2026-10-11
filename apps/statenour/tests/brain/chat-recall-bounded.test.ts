/**
 * 08-F16: the turn-pair read runs on every chat turn, and each OR clause
 * bounded only ONE side of createdAt: "every user row before this reply" in
 * the whole conversation. The neighbour is always minutes away, so each
 * clause now carries a 24h window on the open side.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ semanticSearch: vi.fn(), findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { chatMessage: { findMany: m.findMany } } }));
vi.mock("@/lib/brain/embedding-utils", () => ({ semanticSearch: m.semanticSearch }));

import { getRelevantExchanges } from "@/lib/brain/chat-recall";

const DAY = 86_400_000;
const A_AT = new Date("2026-10-01T12:00:00Z");
const U_AT = new Date("2026-10-02T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.semanticSearch.mockResolvedValue([
    { sourceId: "a1", similarity: 0.8 },
    { sourceId: "u1", similarity: 0.7 },
  ]);
  m.findMany
    .mockResolvedValueOnce([
      { id: "a1", role: "assistant", content: "reply", createdAt: A_AT, conversationId: "c1", conversation: { title: "t" } },
      { id: "u1", role: "user", content: "question", createdAt: U_AT, conversationId: "c2", conversation: { title: "t" } },
    ])
    .mockResolvedValueOnce([]);
});

describe("getRelevantExchanges / the pair read is bounded on both sides", () => {
  it("every OR clause's createdAt has both bounds", async () => {
    await getRelevantExchanges("what did we decide about the shop");
    const where = m.findMany.mock.calls[1][0].where as {
      OR: Array<{ role: string; createdAt: Record<string, Date> }>;
    };
    const before = where.OR.find((c) => c.role === "user")!.createdAt;
    const after = where.OR.find((c) => c.role === "assistant")!.createdAt;
    expect(before).toEqual({ lt: A_AT, gte: new Date(A_AT.getTime() - DAY) });
    expect(after).toEqual({ gt: U_AT, lte: new Date(U_AT.getTime() + DAY) });
  });
});
