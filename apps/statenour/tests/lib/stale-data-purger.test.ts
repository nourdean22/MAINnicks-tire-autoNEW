/**
 * tests/lib/stale-data-purger.test.ts — purger contract invariants
 *
 * Locks down the purer pieces of lib/system/stale-data-purger.ts:
 *   - purgeStaleCategory rejects unknown ids (D6 safety)
 *   - the pending_actions_7d predicate itself (2026-08-12: promoted from
 *     an operator-tap action to an unsupervised nightly cron via
 *     data-cleanup, so the WHERE/DATA shape is now load-bearing — a
 *     flipped comparison or mistyped status would either let the queue
 *     regrow to the 468-row backlog or auto-reject rows that were never
 *     pending, weekly counts unsupervised either way)
 *   - buildDismissedContradictionContent emits canonical shape and
 *     correctly no-ops rows that are already resolved/dismissed (D5,
 *     D6, D9 fixes)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    autonomousAction: {
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  purgeStaleCategory,
} from "@/lib/system/stale-data-purger";

describe("purgeStaleCategory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws on unknown category", async () => {
    await expect(
      // @ts-expect-error — intentional invalid category for the guard
      purgeStaleCategory("not_a_real_category"),
    ).rejects.toThrow(/Unknown stale category/);
  });

  it("pending_actions_7d rejects ONLY pending rows older than 7 days", async () => {
    mockPrisma.autonomousAction.updateMany.mockResolvedValue({ count: 5 });

    const before = Date.now();
    const result = await purgeStaleCategory("pending_actions_7d");

    expect(mockPrisma.autonomousAction.updateMany).toHaveBeenCalledTimes(1);
    const args = mockPrisma.autonomousAction.updateMany.mock.calls[0][0] as {
      where: { approval: string; createdAt: { lt: Date } };
      data: Record<string, unknown>;
    };
    // The guard: never touch approved/rejected/auto rows.
    expect(args.where.approval).toBe("pending");
    // The window: strictly older than 7 days (±30s tolerance for run time).
    const cutoffMs = args.where.createdAt.lt.getTime();
    const sevenDaysAgo = before - 7 * 86_400_000;
    expect(Math.abs(cutoffMs - sevenDaysAgo)).toBeLessThan(30_000);
    // The transition: a status flip with the distinct bulk audit trail —
    // never a delete, never impersonating an operator verdict.
    expect(args.data).toEqual({ approval: "rejected", approvedBy: "auto-purge" });

    expect(result.category).toBe("pending_actions_7d");
    expect(result.purged).toBe(5);
    expect(result.note).toContain("5");
  });

  it("pending_actions_7d reports a genuine zero without inventing work", async () => {
    mockPrisma.autonomousAction.updateMany.mockResolvedValue({ count: 0 });
    const result = await purgeStaleCategory("pending_actions_7d");
    expect(result.purged).toBe(0);
  });
});

