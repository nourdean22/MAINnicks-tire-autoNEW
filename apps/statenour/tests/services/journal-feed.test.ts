/**
 * buildJournalFeed · soft-delete filtering (journal audit 2026-07-15).
 *
 * schema.prisma requires consumers to filter `deletedAt: null` on
 * BrainDump and Reflection, and the feed's own mission_retro branch
 * does — but the brainDump/reflection queries didn't, so soft-deleted
 * entries kept rendering on /journal. These pins keep the filter on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBrainDumpFindMany = vi.fn();
const mockReflectionFindMany = vi.fn();
const mockSituationLogFindMany = vi.fn();
const mockDecisionReplayFindMany = vi.fn();
const mockBrainMemoryFindMany = vi.fn();
const mockLifeGoalFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainDump: { findMany: (args: unknown) => mockBrainDumpFindMany(args) },
    reflection: { findMany: (args: unknown) => mockReflectionFindMany(args) },
    situationLog: { findMany: (args: unknown) => mockSituationLogFindMany(args) },
    decisionReplay: { findMany: (args: unknown) => mockDecisionReplayFindMany(args) },
    brainMemory: { findMany: (args: unknown) => mockBrainMemoryFindMany(args) },
    lifeGoal: { findMany: (args: unknown) => mockLifeGoalFindMany(args) },
  },
}));

import { buildJournalFeed } from "@/lib/services/journal-feed";

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
});

describe("buildJournalFeed · soft-delete filters", () => {
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
