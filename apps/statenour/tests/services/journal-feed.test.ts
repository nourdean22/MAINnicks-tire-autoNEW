/**
 * buildJournalFeed pins (audit 2026-07-15).
 *
 * Wave 1 · soft-delete filtering — schema.prisma requires consumers to
 * filter `deletedAt: null` on BrainDump and Reflection; the feed didn't,
 * so soft-deleted entries kept rendering on /journal.
 *
 * Wave 4 (feed v2) · server-side search pushes into SQL; cursor
 * pagination returns nextCursor on a full page; counts.total comes from
 * TRUE count queries (was the capped-fetch size); a failed source query
 * is surfaced in `degraded` instead of silently rendering a partial
 * feed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBrainDumpFindMany = vi.fn();
const mockReflectionFindMany = vi.fn();
const mockSituationLogFindMany = vi.fn();
const mockDecisionReplayFindMany = vi.fn();
const mockBrainMemoryFindMany = vi.fn();
const mockLifeGoalFindMany = vi.fn();
const mockBrainDumpCount = vi.fn();
const mockReflectionCount = vi.fn();
const mockSituationLogCount = vi.fn();
const mockDecisionReplayCount = vi.fn();
const mockBrainMemoryCount = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: {
      findMany: (args: unknown) => mockBrainDumpFindMany(args),
      count: (args: unknown) => mockBrainDumpCount(args),
    },
    reflection: {
      findMany: (args: unknown) => mockReflectionFindMany(args),
      count: (args: unknown) => mockReflectionCount(args),
    },
    situationLog: {
      findMany: (args: unknown) => mockSituationLogFindMany(args),
      count: (args: unknown) => mockSituationLogCount(args),
    },
    decisionReplay: {
      findMany: (args: unknown) => mockDecisionReplayFindMany(args),
      count: (args: unknown) => mockDecisionReplayCount(args),
    },
    brainMemory: {
      findMany: (args: unknown) => mockBrainMemoryFindMany(args),
      count: (args: unknown) => mockBrainMemoryCount(args),
    },
    lifeGoal: { findMany: (args: unknown) => mockLifeGoalFindMany(args) },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  },
}));

import { buildJournalFeed, truncateAtWord } from "@/lib/services/journal-feed";

const dumpRow = (id: string, createdAt: Date) => ({
  id,
  date: createdAt.toISOString().slice(0, 10),
  createdAt,
  rawThoughts: `thought ${id}`,
  summary: null,
  extractedItems: null,
  patterns: null,
  moodBefore: null,
  actionsTaken: 0,
  entryType: null,
  goalId: null,
  missionId: null,
  linkConfidence: null,
  linkStatus: null,
  enrichedAt: null,
});

beforeEach(() => {
  for (const m of [
    mockBrainDumpFindMany,
    mockReflectionFindMany,
    mockSituationLogFindMany,
    mockDecisionReplayFindMany,
    mockBrainMemoryFindMany,
    mockLifeGoalFindMany,
  ]) {
    m.mockReset();
    m.mockResolvedValue([]);
  }
  for (const m of [
    mockBrainDumpCount,
    mockReflectionCount,
    mockSituationLogCount,
    mockDecisionReplayCount,
    mockBrainMemoryCount,
  ]) {
    m.mockReset();
    m.mockResolvedValue(0);
  }
});

describe("buildJournalFeed · soft-delete filters (wave 1)", () => {
  it("excludes soft-deleted brain dumps", async () => {
    await buildJournalFeed({});

    expect(mockBrainDumpFindMany).toHaveBeenCalledTimes(1);
    const args = mockBrainDumpFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.deletedAt).toBeNull();
  });

  it("excludes soft-deleted reflections", async () => {
    await buildJournalFeed({});

    expect(mockReflectionFindMany).toHaveBeenCalledTimes(1);
    const args = mockReflectionFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.deletedAt).toBeNull();
  });

  it("keeps the mission_retro deletedAt filter", async () => {
    await buildJournalFeed({});

    const args = mockBrainMemoryFindMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where.deletedAt).toBeNull();
  });
});

describe("buildJournalFeed · feed v2 (wave 4)", () => {
  it("pushes search into SQL contains-filters on every source", async () => {
    await buildJournalFeed({ search: "pool party" });

    const dumpWhere = (mockBrainDumpFindMany.mock.calls[0][0] as { where: { OR?: unknown[] } }).where;
    expect(dumpWhere.OR).toEqual([
      { rawThoughts: { contains: "pool party", mode: "insensitive" } },
      { summary: { contains: "pool party", mode: "insensitive" } },
    ]);
    const reflWhere = (mockReflectionFindMany.mock.calls[0][0] as { where: { OR?: unknown[] } }).where;
    expect(reflWhere.OR).toBeDefined();
    const sitWhere = (mockSituationLogFindMany.mock.calls[0][0] as { where: { OR?: unknown[] } }).where;
    expect(sitWhere.OR).toBeDefined();
  });

  it("applies the cursor as a strict createdAt upper bound", async () => {
    const cursor = "2026-07-10T12:00:00.000Z";
    await buildJournalFeed({ cursor });

    const dumpWhere = (mockBrainDumpFindMany.mock.calls[0][0] as {
      where: { createdAt?: { lt?: Date } };
    }).where;
    expect(dumpWhere.createdAt?.lt).toEqual(new Date(cursor));
  });

  it("returns nextCursor when a full page is served, null otherwise", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 3 }, (_, i) =>
      dumpRow(`d-${i}`, new Date(now - i * 60_000)),
    );
    mockBrainDumpFindMany.mockResolvedValue(rows);

    const full = await buildJournalFeed({ limit: 3 });
    expect(full.nextCursor).toBe(rows[2].createdAt.toISOString());
    expect(full.counts.hasMore).toBe(true);

    const partial = await buildJournalFeed({ limit: 10 });
    expect(partial.nextCursor).toBeNull();
    expect(partial.counts.hasMore).toBe(false);
  });

  it("counts.total comes from count queries, not the capped fetch", async () => {
    mockBrainDumpFindMany.mockResolvedValue([dumpRow("d-1", new Date())]);
    mockBrainDumpCount.mockResolvedValue(1234);
    mockReflectionCount.mockResolvedValue(6);

    const view = await buildJournalFeed({});

    expect(view.counts.total).toBe(1240);
    expect(view.counts.bySource.dump).toBe(1234);
    expect(view.counts.bySource.reflection).toBe(6);
  });

  it("surfaces a failed source in `degraded` instead of swallowing it", async () => {
    mockReflectionFindMany.mockRejectedValue(new Error("relation gone"));

    const view = await buildJournalFeed({});

    expect(view.degraded).toEqual(["reflection"]);
    // The rest of the feed still renders.
    expect(view.entries).toEqual([]);
  });
});

describe("truncateAtWord", () => {
  it("cuts at a word boundary with an ellipsis (no more mid-word titles)", () => {
    expect(truncateAtWord("Nour woke up early feeling unusually tired", 30)).toBe(
      "Nour woke up early feeling…",
    );
  });

  it("returns short text untouched", () => {
    expect(truncateAtWord("short", 30)).toBe("short");
  });

  it("hard-cuts pathological no-space text instead of over-shortening", () => {
    expect(truncateAtWord("a".repeat(50), 20)).toBe(`${"a".repeat(20)}…`);
  });
});
