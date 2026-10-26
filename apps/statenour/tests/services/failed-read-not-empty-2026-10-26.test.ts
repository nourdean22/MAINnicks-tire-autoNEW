/**
 * failed-read-not-empty-2026-10-26.test.ts (job 2026-10-26-since-1024-audit)
 *
 * Two services turned a failed database read into an empty answer, so the panels that already
 * render a failed read never could: getActiveCoachEvents returned [] (the /stats Goals coach
 * banner's failed note never showed) and getLatestLearningJournalEntry returned null (the Journal
 * metacognition row said "No nightly self-assessment yet"). A failed read must reach the caller;
 * an empty table must still read as empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: h.findMany, findFirst: h.findFirst } },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { getActiveCoachEvents } from "@/lib/services/coach-events";
import { getLatestLearningJournalEntry } from "@/lib/brain/learning-journal";

beforeEach(() => {
  h.findMany.mockReset();
  h.findFirst.mockReset();
});

describe("a failed read is not an empty one", () => {
  it("coach events: a database failure rejects instead of resolving to no nudges", async () => {
    h.findMany.mockRejectedValue(new Error("db down"));
    await expect(getActiveCoachEvents({ surface: "stats" as never })).rejects.toThrow("db down");
  });

  it("control: coach events with no rows still resolve to an empty list", async () => {
    h.findMany.mockResolvedValue([]);
    await expect(getActiveCoachEvents({ surface: "stats" as never })).resolves.toEqual([]);
  });

  it("learning journal: a database failure rejects instead of reading as 'no entry yet'", async () => {
    h.findFirst.mockRejectedValue(new Error("db down"));
    await expect(getLatestLearningJournalEntry()).rejects.toThrow("db down");
  });

  it("control: no journal row still reads as null (no entry yet)", async () => {
    h.findFirst.mockResolvedValue(null);
    await expect(getLatestLearningJournalEntry()).resolves.toBeNull();
  });
});
