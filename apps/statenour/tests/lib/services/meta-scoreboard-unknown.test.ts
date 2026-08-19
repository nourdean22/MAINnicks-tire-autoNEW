/**
 * Unknown-is-not-zero contract for the meta-scoreboard (2026-08-19).
 *
 * Before this, every anchor/detector floored a FAILED read to 0 (or
 * silently vanished), so a dead database rendered as "Open tasks 0 ·
 * Active commitments 0 · calm" — indistinguishable from a genuinely
 * clear board. The revenue mirror also had no recency bound: a
 * week-old ceo_business_context payload rendered as "Revenue today".
 *
 * Contract pinned here:
 *   1. a read that THROWS yields a `measured: false` card with display
 *      "—", anomalous: true — and the board state goes "alive", never
 *      "calm" (unknown never counts as healthy — the fleet-truth rule);
 *   2. the mirror fallback is honest about its age (>=24h → flagged);
 *   3. the pinned "Δ since brief" baseline is bounded to TODAY (ET).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  task: { count: vi.fn() },
  commitment: { count: vi.fn() },
  masteryScore: { findMany: vi.fn() },
  brainMemory: { findFirst: vi.fn(), count: vi.fn() },
  auditEvent: { findFirst: vi.fn() },
  queryNickBatch: vi.fn(),
  readNickRevenue: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: mocks.task,
    commitment: mocks.commitment,
    masteryScore: mocks.masteryScore,
    brainMemory: mocks.brainMemory,
    auditEvent: mocks.auditEvent,
  },
}));

vi.mock("@/lib/nickstire/query", () => ({
  queryNickBatch: mocks.queryNickBatch,
}));

vi.mock("@/lib/nickstire/revenue", () => ({
  readNickRevenue: mocks.readNickRevenue,
}));

vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}));

import { buildMetaScoreboard } from "@/lib/services/meta-scoreboard";

function healthyMocks() {
  mocks.queryNickBatch.mockResolvedValue({
    revenue_today: { data: { totalDollars: 1234 } },
  });
  mocks.task.count.mockResolvedValue(7);
  mocks.commitment.count.mockResolvedValue(3);
  mocks.masteryScore.findMany.mockResolvedValue([]);
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.brainMemory.findFirst.mockResolvedValue(null);
  mocks.auditEvent.findFirst.mockResolvedValue(null);
  mocks.readNickRevenue.mockReturnValue({ todayDollars: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  healthyMocks();
});

describe("meta-scoreboard · unknown is not zero", () => {
  it("healthy reads → measured numbers, calm state", async () => {
    const snap = await buildMetaScoreboard();
    const open = snap.numbers.find((n) => n.key === "open_tasks");
    expect(open?.display).toBe("7");
    expect(open?.measured).toBeUndefined();
    expect(snap.state).toBe("calm");
  });

  it("a failed count renders as an unmeasured anomaly, not a calm zero", async () => {
    mocks.task.count.mockRejectedValue(new Error("db down"));
    mocks.commitment.count.mockRejectedValue(new Error("db down"));
    const snap = await buildMetaScoreboard();

    const open = snap.numbers.find((n) => n.key === "open_tasks");
    expect(open).toBeDefined();
    expect(open?.display).toBe("—");
    expect(open?.measured).toBe(false);
    expect(open?.anomalous).toBe(true);
    expect(open?.why).toMatch(/instrument failure/i);

    const commitments = snap.numbers.find((n) => n.key === "active_commitments");
    expect(commitments?.measured).toBe(false);

    // A board that cannot read itself is not calm.
    expect(snap.state).toBe("alive");
  });

  it("a blind stale-goal detector says so instead of silently never firing", async () => {
    mocks.brainMemory.count.mockRejectedValue(new Error("db down"));
    const snap = await buildMetaScoreboard();
    const stale = snap.numbers.find((n) => n.key === "stale_goals");
    expect(stale?.measured).toBe(false);
    expect(stale?.anomalous).toBe(true);
  });

  it("bridge down + no mirror → revenue is '—', never $0", async () => {
    mocks.queryNickBatch.mockRejectedValue(new Error("bridge down"));
    mocks.auditEvent.findFirst.mockResolvedValue(null);
    const snap = await buildMetaScoreboard();
    const rev = snap.numbers.find((n) => n.key === "revenue_today");
    expect(rev?.display).toBe("—");
    expect(rev?.measured).toBe(false);
    expect(rev?.why).toMatch(/UNKNOWN, not \$0/);
  });

  it("bridge down + old mirror → figure shown but flagged with its age", async () => {
    mocks.queryNickBatch.mockRejectedValue(new Error("bridge down"));
    mocks.auditEvent.findFirst.mockResolvedValue({
      payload: { revenue: { totalDollars: 500 } },
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    });
    mocks.readNickRevenue.mockReturnValue({ todayDollars: 500 });
    const snap = await buildMetaScoreboard();
    const rev = snap.numbers.find((n) => n.key === "revenue_today");
    expect(rev?.display).toBe("$500");
    expect(rev?.measured).toBe(false);
    expect(rev?.anomalous).toBe(true);
    expect(rev?.why).toMatch(/mirror from 3d ago/);
  });

  it("the pinned Δ-since-brief baseline is bounded to today (ET)", async () => {
    await buildMetaScoreboard();
    const pinnedCall = mocks.brainMemory.findFirst.mock.calls.find(
      (c) => c[0]?.where?.category === "scoreboard_pinned",
    );
    expect(pinnedCall, "SCOREBOARD_PINNED read not found").toBeDefined();
    const gte = pinnedCall?.[0]?.where?.updatedAt?.gte;
    expect(gte).toBeInstanceOf(Date);
    // The bound is the start of TODAY — within the last 24h.
    expect(Date.now() - (gte as Date).getTime()).toBeLessThan(24 * 3_600_000 + 1);
  });
});
