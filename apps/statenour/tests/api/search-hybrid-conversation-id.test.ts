/**
 * search-hybrid attaches conversationId to chat-message hits (audit wave 2,
 * P1 item 6). Without it the command palette could only fall back to
 * `/chat?prompt=` instead of opening the conversation the hit came from.
 * One batched findMany after the merge; a failed lookup leaves hits as they were.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/utils/http", () => ({
  apiHandler: (fn: (req: Request) => unknown) => fn,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: m.queryRaw, chatMessage: { findMany: m.findMany } },
}));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: async () => [0.1, 0.2] }));

import { GET } from "@/app/api/brain/search-hybrid/route";

type Hit = { sourceType: string; sourceId: string; conversationId?: string | null };
const run = async () =>
  (await (GET as unknown as (r: Request) => Promise<{ results: Hit[] }>)(
    new Request("http://localhost/api/brain/search-hybrid?q=brakes"),
  )).results;

beforeEach(() => {
  m.queryRaw.mockReset();
  m.findMany.mockReset();
  // KNN: one memory + one chat hit; FTS: one more chat hit.
  m.queryRaw
    .mockResolvedValueOnce([
      { id: "e1", source_type: "brain_memory", source_id: "mem1", content: "m", distance: 0.1 },
      { id: "e2", source_type: "chat_message", source_id: "msg1", content: "c", distance: 0.2 },
    ])
    .mockResolvedValueOnce([{ id: "msg2", source_id: "msg2", content: "c2", rank: 0.5 }]);
});

describe("search-hybrid conversationId", () => {
  it("a chat hit carries its conversationId, looked up in ONE findMany", async () => {
    m.findMany.mockResolvedValue([
      { id: "msg1", conversationId: "conv_a" },
      { id: "msg2", conversationId: "conv_b" },
    ]);
    const hits = await run();
    expect(m.findMany).toHaveBeenCalledTimes(1);
    const arg = m.findMany.mock.calls[0][0] as { where: { id: { in: string[] } } };
    expect([...arg.where.id.in].sort()).toEqual(["msg1", "msg2"]);
    expect(hits.find((h) => h.sourceId === "msg1")?.conversationId).toBe("conv_a");
    expect(hits.find((h) => h.sourceId === "msg2")?.conversationId).toBe("conv_b");
    expect(hits.find((h) => h.sourceId === "mem1")?.conversationId).toBeUndefined();
  });

  it("a failed lookup leaves the hits unchanged and does not throw", async () => {
    m.findMany.mockRejectedValue(new Error("db down"));
    const hits = await run();
    expect(hits).toHaveLength(3);
    expect(hits.every((h) => h.conversationId === undefined)).toBe(true);
  });
});
