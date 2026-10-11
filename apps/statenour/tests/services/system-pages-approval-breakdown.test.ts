/**
 * /system/actions approval breakdown (audit P-S5c, 2026-10-10).
 *
 * The approval queue writes "processing" (claimed, executing) and
 * "needs_review" (may have run; check before retrying) besides the original
 * auto/pending/approved/rejected. The breakdown had buckets for the four old
 * values only, so those rows vanished and the buckets no longer summed to the
 * window total. The total itself was recent.length, capped at the 100-row page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ byApproval: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    autonomousAction: {
      findMany: () => Promise.resolve([]),
      groupBy: (a: { by: string[] }) =>
        a.by.join() === "approval" ? h.byApproval() : Promise.resolve([]),
    },
  },
  checkDbConnection: () => Promise.resolve({ connected: true, latency_ms: 1 }),
}));

import { buildAutonomousActionsFeed } from "@/lib/services/system-pages";

const row = (approval: string, n: number) => ({ approval, _count: { id: n } });

beforeEach(() => h.byApproval.mockReset());

describe("buildAutonomousActionsFeed approvalBreakdown", () => {
  it("carries needs_review and processing rows instead of dropping them", async () => {
    h.byApproval.mockResolvedValue([row("auto", 5), row("needs_review", 2), row("processing", 1)]);
    const feed = await buildAutonomousActionsFeed({});
    expect(feed.approvalBreakdown).toMatchObject({ auto: 5, needs_review: 2, processing: 1 });
  });

  it("the buckets sum to the window total, an unlisted status included", async () => {
    h.byApproval.mockResolvedValue([row("auto", 150), row("pending", 3), row("some_new_state", 4)]);
    const feed = await buildAutonomousActionsFeed({});
    const sum = Object.values(feed.approvalBreakdown).reduce((s, n) => s + n, 0);
    expect(feed.approvalBreakdown.other).toBe(4);
    expect(sum).toBe(157);
    expect(feed.totalInWindow).toBe(157); // not the 100-row page length
  });

  it("CONTROL: the original four keys keep their counts", async () => {
    h.byApproval.mockResolvedValue([row("auto", 1), row("pending", 2), row("approved", 3), row("rejected", 4)]);
    const feed = await buildAutonomousActionsFeed({});
    expect(feed.approvalBreakdown).toMatchObject({ auto: 1, pending: 2, approved: 3, rejected: 4 });
  });
});
