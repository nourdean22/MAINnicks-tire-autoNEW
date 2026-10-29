/**
 * The nightly compile sweep must find a stale summary wherever it sits in the
 * window (audit 2026-10-29).
 *
 * findCompileEligibleConversations read only the `limit * 2` OLDEST
 * conversations and filtered for staleness after. Prod that night: 38
 * candidates in the 30-day window, 8 of them stale, all 8 at rank 23 or later,
 * so every run compiled nothing while two of the week's busiest conversations
 * kept a summary that predates their last turns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  convFindMany: vi.fn(),
  memFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatConversation: { findMany: h.convFindMany },
    brainMemory: { findMany: h.memFindMany },
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn() }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined) }));

import { findCompileEligibleConversations } from "@/lib/brain/conversation-memory";

const HOUR = 3_600_000;
const NOW = Date.now();

// 38 conversations oldest-first; the 8 newest moved after their summary.
const CONVS = Array.from({ length: 38 }, (_, i) => ({
  id: `conv-${String(i).padStart(2, "0")}`,
  updatedAt: new Date(NOW - (40 - i) * 12 * HOUR),
}));
const STALE = new Set(CONVS.slice(30).map((c) => c.id));

beforeEach(() => {
  vi.clearAllMocks();
  // Honour orderBy asc + take, the way Postgres would.
  h.convFindMany.mockImplementation(async (args: { take?: number }) =>
    CONVS.slice(0, args.take ?? CONVS.length),
  );
  h.memFindMany.mockImplementation(async (args: { where: { key: { in: string[] } } }) =>
    args.where.key.in.map((key) => {
      const id = key.replace(/^conv_/, "");
      const conv = CONVS.find((c) => c.id === id)!;
      return {
        key,
        deletedAt: null,
        metadata: null,
        // fresh: written after the last turn; stale: written an hour before it
        updatedAt: new Date(conv.updatedAt.getTime() + (STALE.has(id) ? -HOUR : HOUR)),
      };
    }),
  );
});

describe("findCompileEligibleConversations", () => {
  it("returns stale summaries that sit past the oldest page of candidates", async () => {
    const ids = await findCompileEligibleConversations({ limit: 10 });
    expect(ids).toHaveLength(8);
    expect(new Set(ids)).toEqual(STALE);
  });

  it("still caps the batch at the limit, oldest stale first", async () => {
    const ids = await findCompileEligibleConversations({ limit: 3 });
    expect(ids).toEqual(["conv-30", "conv-31", "conv-32"]);
  });

  // Codex P2 on PR 3351: a fixed 500-row pre-filter cap repeats the same
  // oldest page every night once the window outgrows it.
  it("pages past the first page when the window is larger than one read", async () => {
    const BIG = Array.from({ length: 600 }, (_, i) => ({
      id: `big-${String(i).padStart(3, "0")}`,
      updatedAt: new Date(NOW - (700 - i) * HOUR),
    }));
    const bigStale = new Set(BIG.slice(590).map((c) => c.id));
    // Prisma cursor paging over orderBy [updatedAt asc, id asc].
    h.convFindMany.mockImplementation(async (args: { take: number; cursor?: { id: string }; skip?: number }) => {
      const start = args.cursor ? BIG.findIndex((c) => c.id === args.cursor!.id) + (args.skip ?? 0) : 0;
      return BIG.slice(start, start + args.take);
    });
    h.memFindMany.mockImplementation(async (args: { where: { key: { in: string[] } } }) =>
      args.where.key.in.map((key) => {
        const id = key.replace(/^conv_/, "");
        const conv = BIG.find((c) => c.id === id)!;
        return { key, deletedAt: null, metadata: null, updatedAt: new Date(conv.updatedAt.getTime() + (bigStale.has(id) ? -HOUR : HOUR)) };
      }),
    );
    const ids = await findCompileEligibleConversations({ limit: 10 });
    expect(new Set(ids)).toEqual(bigStale);
  });
});
