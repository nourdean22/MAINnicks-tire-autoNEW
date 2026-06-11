/**
 * Weekly-Review Context engine · "Nick remembers the week"
 *
 * Pins the contract of getWeeklyReviewContext():
 *   1. cron-shape rows (wins/misses/patterns/focus metadata) render the
 *      week label + focus + patterns, wins/misses only on the most
 *      recent row
 *   2. ReviewWizard-shape rows (serveText/surpriseText) render the
 *      operator-commitment line from row content
 *   3. two rows render most-recent first (week-over-week continuity)
 *   4. no rows in the window → "" (honest absence, no stale weeks)
 *   5. prisma failure → "" (engine must never break prompt assembly)
 *   6. malformed metadata falls back to the content summary, never throws
 *   7. long fields are clipped (block stays inside its prompt cap)
 *   8. the query is scoped: weekly_review category + soft-delete filter
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: (args: unknown) => mockFindMany(args),
    },
  },
}));

import { getWeeklyReviewContext } from "@/lib/brain/weekly-review-context";

function cronRow(overrides: Partial<{
  key: string;
  content: string;
  metadata: Record<string, unknown> | null;
  source: string | null;
  updatedAt: Date;
}> = {}) {
  return {
    key: "weekly:2026-06-08",
    content: "Full review text…",
    metadata: {
      weekStart: "2026-06-08",
      wins: "Closed the ledger PR; gym 5/7",
      misses: "Skipped journal twice",
      patterns: "Energy dips after late-night work",
      focus: "Ship the admin integration; protect morning blocks",
    },
    source: "cron:weekly-review",
    updatedAt: new Date(Date.now() - 2 * 86_400_000),
    ...overrides,
  };
}

beforeEach(() => {
  mockFindMany.mockReset();
});

describe("getWeeklyReviewContext", () => {
  it("renders a cron-shape review with week label, focus, patterns, wins/misses", async () => {
    mockFindMany.mockResolvedValue([cronRow()]);
    const out = await getWeeklyReviewContext();
    expect(out).toContain("WEEKLY REVIEWS (cross-week memory");
    expect(out).toContain("Week of 2026-06-08");
    expect(out).toContain("2d ago");
    expect(out).toContain("Focus set: Ship the admin integration");
    expect(out).toContain("Patterns: Energy dips after late-night work");
    expect(out).toContain("Wins: Closed the ledger PR");
    expect(out).toContain("Misses: Skipped journal twice");
    // The honesty tail instruction always rides along.
    expect(out).toContain("Never claim a week-over-week pattern");
  });

  it("renders a ReviewWizard commitment row from its content summary", async () => {
    mockFindMany.mockResolvedValue([
      {
        key: "2026-W24",
        content: "serve · call mom Sunday · surprise · flowers for Dania · 2 warnings actioned · 3 pinned",
        metadata: {
          weekKey: "2026-W24",
          serveText: "call mom Sunday",
          surpriseText: "flowers for Dania",
          warningsActioned: 2,
          pickedTaskIds: ["a", "b", "c"],
        },
        source: "review-wizard",
        updatedAt: new Date(),
      },
    ]);
    const out = await getWeeklyReviewContext();
    expect(out).toContain("Operator's own commitment (week 2026-W24");
    expect(out).toContain("call mom Sunday");
  });

  it("renders two weeks most-recent first; older row omits wins/misses", async () => {
    const recent = cronRow();
    const older = cronRow({
      key: "weekly:2026-06-01",
      metadata: {
        weekStart: "2026-06-01",
        wins: "OLDER-WINS-MUST-NOT-RENDER",
        misses: null,
        patterns: "Same energy dip pattern",
        focus: "Old focus line",
      },
      updatedAt: new Date(Date.now() - 9 * 86_400_000),
    });
    mockFindMany.mockResolvedValue([recent, older]);
    const out = await getWeeklyReviewContext();
    expect(out.indexOf("Week of 2026-06-08")).toBeLessThan(out.indexOf("Week of 2026-06-01"));
    // Older row keeps focus+patterns (week-over-week signal)…
    expect(out).toContain("Old focus line");
    expect(out).toContain("Same energy dip pattern");
    // …but drops the verbose wins/misses to stay inside the cap.
    expect(out).not.toContain("OLDER-WINS-MUST-NOT-RENDER");
  });

  it("returns '' when no rows exist in the lookback window", async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await getWeeklyReviewContext()).toBe("");
  });

  it("returns '' when the query fails (never breaks prompt assembly)", async () => {
    mockFindMany.mockRejectedValue(new Error("db down"));
    expect(await getWeeklyReviewContext()).toBe("");
  });

  it("falls back to the content summary on unknown/malformed metadata", async () => {
    mockFindMany.mockResolvedValue([
      cronRow({ key: "weekly:2026-06-08", content: "Fallback summary text", metadata: null }),
      cronRow({ key: "weekly:2026-06-01", content: "Numeric meta", metadata: { patterns: 42, focus: 7 } as never }),
    ]);
    const out = await getWeeklyReviewContext();
    expect(out).toContain("weekly:2026-06-08");
    expect(out).toContain("Fallback summary text");
    // Non-string fields are ignored, not stringified or thrown on.
    expect(out).not.toContain("42");
    expect(out).toContain("Numeric meta");
  });

  it("clips long fields so the block stays prompt-cap friendly", async () => {
    mockFindMany.mockResolvedValue([
      cronRow({
        metadata: {
          weekStart: "2026-06-08",
          wins: "w".repeat(500),
          misses: "m".repeat(500),
          patterns: "p".repeat(500),
          focus: "f".repeat(500),
        },
      }),
    ]);
    const out = await getWeeklyReviewContext();
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(900);
  });

  it("scopes the query to weekly_review, excludes soft-deleted, bounds recency", async () => {
    mockFindMany.mockResolvedValue([]);
    await getWeeklyReviewContext();
    const args = mockFindMany.mock.calls[0][0] as {
      where: { category: string; deletedAt: null; updatedAt: { gte: Date } };
      take: number;
    };
    expect(args.where.category).toBe("weekly_review");
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.updatedAt.gte).toBeInstanceOf(Date);
    expect(args.take).toBe(3);
  });
});
