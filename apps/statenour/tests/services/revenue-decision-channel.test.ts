/**
 * revenue-decision-channel · service tests · v10.0.526 · Arc C · Feature 1
 *
 * Unit-level. Prisma + bridge + AI + Telegram are all mocked so the
 * 5 covered behaviors (signal fetch, wisdom match, draft shape,
 * Telegram format, approval idempotency) run without external calls.
 *
 * Coverage map:
 *   1. pullBusinessSignals · prefers CEO context + bridge merge
 *   2. matchWisdom · prefers Munger/Bezos/Naval prefixes
 *   3. draftMoves · returns 1-3 well-formed RevenueMove rows
 *   4. formatTelegramApproval · tight 5-line shape
 *   5. decideMove · idempotent on a second decision
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  auditEvent: {
    findFirst: vi.fn(),
  },
  fetchShopSnapshot: vi.fn(),
  tracedAiChat: vi.fn(),
  sendTelegram: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    auditEvent: mocks.auditEvent,
  },
}));

vi.mock("@/lib/services/bridge", () => ({
  fetchShopSnapshot: mocks.fetchShopSnapshot,
}));

vi.mock("@/lib/ai/traced-aichat", () => ({
  tracedAiChat: mocks.tracedAiChat,
}));

vi.mock("@/lib/services/telegram", () => ({
  sendTelegram: mocks.sendTelegram,
  formatTelegramNotification: vi.fn((title: string, body: string) => `${title}\n${body}`),
}));

// Imported AFTER vi.mock so the module picks up the mocked deps.
import {
  decideMove,
  draftMoves,
  formatTelegramApproval,
  matchWisdom,
  pullBusinessSignals,
  type BusinessSignals,
  type RevenueMove,
  type WisdomCitation,
} from "@/lib/services/revenue-decision-channel";

beforeEach(() => {
  mocks.brainMemory.findMany.mockReset();
  mocks.brainMemory.findFirst.mockReset();
  mocks.brainMemory.findUnique.mockReset();
  mocks.brainMemory.upsert.mockReset();
  mocks.brainMemory.update.mockReset();
  mocks.auditEvent.findFirst.mockReset();
  mocks.fetchShopSnapshot.mockReset();
  mocks.tracedAiChat.mockReset();
  mocks.sendTelegram.mockReset();
});

// ── Test 1 · signal fetch ─────────────────────────────────────────

describe("pullBusinessSignals", () => {
  it("merges CEO context + bridge snapshot when both are available", async () => {
    const ceoPayload = {
      revenue: { totalDollars: 3200 },
      declinedWork: { count: 12, safetyItemCount: 4 },
      callbacks: { pendingCount: 3 },
      leads: { totalActive: 25 },
      estimateLeadFunnel: { last7d: { staleNewEstimates: 5 } },
      workOrders: { activeToday: 7 },
      intelligence: { gbpReviewsThisWeek: 2 },
      prioritizedActions: [{ title: "a" }, { title: "b" }, { title: "c" }],
    };
    mocks.auditEvent.findFirst.mockResolvedValueOnce({
      payload: ceoPayload,
      createdAt: new Date("2026-05-12T10:00:00Z"),
    });
    mocks.fetchShopSnapshot.mockResolvedValueOnce({
      timestamp: "2026-05-12T11:00:00Z",
      bookings: { todayCount: 8, newCount: 8, confirmedCount: 0, completedCount: 0 },
      leads: { totalActive: 30, uncontactedCount: 5, urgentCount: 1, thisWeek: 4 },
      callbacks: { pendingCount: 2, totalCount: 2, completedCount: 0 },
      revenue: { todayEstimate: 3200, weekEstimate: 21000 },
      syncHealth: { overall: "healthy", services: {} },
      chat: { totalSessions: 0, thisWeek: 0 },
      recentActivity: { lastBookingAt: null, lastLeadAt: null },
    });

    const signals = await pullBusinessSignals();
    expect(signals.source).toBe("merged");
    expect(signals.lineOfCars).toBe(7); // CEO workOrders.activeToday wins
    expect(signals.declinedWorkDelta).toBe(12);
    expect(signals.pipelineAging).toBe(3);
    expect(signals.gbpReviewDelta).toBe(2);
    expect(signals.alertCount).toBe(3);
    // 25 leads, 5 stale → 1 - 5/25 = 0.8
    expect(signals.algConversionRate).toBeCloseTo(0.8, 2);
    expect(signals.contextAt).toBe("2026-05-12T10:00:00.000Z");
    expect(signals.bridgeAt).toBe("2026-05-12T11:00:00Z");
  });

  it("returns the `empty` shape when both sources are unavailable", async () => {
    mocks.auditEvent.findFirst.mockResolvedValueOnce(null);
    mocks.fetchShopSnapshot.mockResolvedValueOnce(null);

    const signals = await pullBusinessSignals();
    expect(signals.source).toBe("empty");
    expect(signals.lineOfCars).toBe(0);
    expect(signals.declinedWorkDelta).toBe(0);
    expect(signals.alertCount).toBe(0);
    expect(signals.contextAt).toBeNull();
    expect(signals.bridgeAt).toBeNull();
  });
});

// ── Test 2 · wisdom match ─────────────────────────────────────────

describe("matchWisdom", () => {
  it("boosts Munger/Bezos/Naval prefixes and surfaces ≤3 citations", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      {
        id: "w1",
        key: "wisdom_munger_inversion",
        content: "Invert the problem · follow up on every lost estimate",
        confidence: 0.9,
        source: "manual",
      },
      {
        id: "w2",
        key: "wisdom_random_other",
        content: "Speed of follow-up beats clever pitches",
        confidence: 0.9,
        source: "manual",
      },
      {
        id: "w3",
        key: "wisdom_bezos_one_way_door",
        content: "Distinguish reversible from irreversible decisions",
        confidence: 0.9,
        source: "manual",
      },
      {
        id: "w4",
        key: "wisdom_naval_leverage",
        content: "Leverage comes from code, capital, and people",
        confidence: 0.85,
        source: "manual",
      },
      {
        id: "w5",
        key: "wisdom_other_topic",
        content: "Unrelated content",
        confidence: 0.85,
        source: "manual",
      },
    ]);

    const signals: BusinessSignals = {
      lineOfCars: 5,
      declinedWorkDelta: 8,
      pipelineAging: 3,
      gbpReviewDelta: 1,
      algConversionRate: 0.7,
      alertCount: 2,
      source: "ceo_context",
      contextAt: null,
      bridgeAt: null,
    };

    const wisdoms = await matchWisdom(signals, 3);
    expect(wisdoms.length).toBeLessThanOrEqual(3);
    // The top-ranked picks should be from the preferred-prefix set ·
    // we don't pin the exact order (depends on keyword overlap with
    // the LIKE search) but at least 2 of 3 must be from Munger/Bezos/Naval.
    const preferredCount = wisdoms.filter((w) =>
      w.key.startsWith("wisdom_munger_") ||
      w.key.startsWith("wisdom_bezos_") ||
      w.key.startsWith("wisdom_naval_"),
    ).length;
    expect(preferredCount).toBeGreaterThanOrEqual(2);
  });

  it("returns empty when the wisdom corpus is empty", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([]);
    const signals: BusinessSignals = {
      lineOfCars: 0,
      declinedWorkDelta: 0,
      pipelineAging: 0,
      gbpReviewDelta: 0,
      algConversionRate: 0,
      alertCount: 0,
      source: "ceo_context",
      contextAt: null,
      bridgeAt: null,
    };
    const wisdoms = await matchWisdom(signals, 3);
    expect(wisdoms).toEqual([]);
  });
});

// ── Test 3 · draft moves ──────────────────────────────────────────

describe("draftMoves", () => {
  const fakeSignals: BusinessSignals = {
    lineOfCars: 6,
    declinedWorkDelta: 10,
    pipelineAging: 2,
    gbpReviewDelta: 1,
    algConversionRate: 0.7,
    alertCount: 2,
    source: "merged",
    contextAt: null,
    bridgeAt: null,
  };
  const fakeWisdoms: WisdomCitation[] = [
    {
      id: "w1",
      key: "wisdom_munger_inversion",
      excerpt: "Invert · find the lost estimate, work that backward.",
    },
    {
      id: "w2",
      key: "wisdom_bezos_one_way_door",
      excerpt: "Most decisions are reversible.",
    },
  ];

  it("parses JSON output into 1-3 well-formed moves with required fields", async () => {
    const aiJson = JSON.stringify([
      {
        what: "Call the 12 declined-work customers from this week with a 10% safety-item discount.",
        why: "Munger inversion: instead of asking why customers don't return, ask what would make them say no twice — price + urgency.",
        expectedImpact: "$1,200-2,400 recovered",
        oneWayDoor: false,
        wisdomCited: ["wisdom_munger_inversion"],
      },
      {
        what: "Reply to the 2 pending GBP reviews with a templated thank-you including the next-visit discount code.",
        why: "Bezos one-way-door: reply is reversible; silence is not.",
        expectedImpact: "qualitative",
        oneWayDoor: false,
        wisdomCited: ["wisdom_bezos_one_way_door"],
      },
    ]);
    mocks.tracedAiChat.mockResolvedValueOnce({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      content: aiJson,
    });

    const moves = await draftMoves(fakeSignals, fakeWisdoms);
    expect(moves).toHaveLength(2);
    expect(moves[0].moveIndex).toBe(1);
    expect(moves[0].what.length).toBeGreaterThan(0);
    expect(moves[0].why.length).toBeGreaterThan(0);
    expect(moves[0].oneWayDoor).toBe(false);
    expect(moves[0].wisdomCited).toContain("wisdom_munger_inversion");
    expect(moves[1].moveIndex).toBe(2);
  });

  it("returns [] when the AI provider chain collapses (provider=none)", async () => {
    mocks.tracedAiChat.mockResolvedValueOnce({
      provider: "none",
      model: null,
      content: "all providers down",
    });
    const moves = await draftMoves(fakeSignals, fakeWisdoms);
    expect(moves).toEqual([]);
  });

  it("returns [] when wisdoms are empty (skip drafting)", async () => {
    const moves = await draftMoves(fakeSignals, []);
    expect(moves).toEqual([]);
    expect(mocks.tracedAiChat).not.toHaveBeenCalled();
  });
});

// ── Test 4 · Telegram format ──────────────────────────────────────

describe("formatTelegramApproval", () => {
  it("produces the tight header + per-move + footer line shape", () => {
    const moves: RevenueMove[] = [
      {
        moveIndex: 1,
        what: "Call declined-work customers with a discount offer.",
        why: "Munger inversion.",
        expectedImpact: "$1,200-2,400 recovered",
        oneWayDoor: false,
        wisdomCited: ["wisdom_munger_inversion"],
      },
      {
        moveIndex: 2,
        what: "Hire a second tech (long-term commitment).",
        why: "Naval leverage.",
        expectedImpact: "qualitative",
        oneWayDoor: true,
        wisdomCited: ["wisdom_naval_leverage"],
      },
    ];
    const text = formatTelegramApproval(moves, "2026-05-12");
    expect(text).toContain("<b>Revenue moves · 2026-05-12 (2)</b>");
    expect(text).toContain("1) Call declined-work customers");
    expect(text).toContain("reversible");
    expect(text).toContain("2) Hire a second tech");
    expect(text).toContain("one-way");
    expect(text).toContain("/approve_1..2");
    expect(text).toContain("/approve_all");
    expect(text).toContain("/reject_all");
  });

  it("handles the empty-moves case gracefully", () => {
    const text = formatTelegramApproval([], "2026-05-12");
    expect(text).toContain("No moves drafted");
  });
});

// ── Test 5 · approval-callback idempotency ────────────────────────

describe("decideMove · idempotency", () => {
  it("flips a pending move to approved, then the second call returns alreadyDecided=true without mutating again", async () => {
    // First call · move is pending, gets flipped to approved.
    mocks.brainMemory.findUnique.mockResolvedValueOnce({
      id: "m1",
      metadata: {
        what: "call customers",
        why: "munger",
        status: "pending",
        moveIndex: 1,
        date: "2026-05-12",
      },
    });
    mocks.brainMemory.update.mockResolvedValueOnce({ id: "m1" });

    const first = await decideMove("2026-05-12", 1, "approved");
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.alreadyDecided).toBe(false);
      expect(first.status).toBe("approved");
    }
    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);

    // Second call · move is already approved · no update fires.
    mocks.brainMemory.findUnique.mockResolvedValueOnce({
      id: "m1",
      metadata: {
        what: "call customers",
        status: "approved",
        moveIndex: 1,
        date: "2026-05-12",
      },
    });

    const second = await decideMove("2026-05-12", 1, "approved");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.alreadyDecided).toBe(true);
      expect(second.status).toBe("approved");
    }
    // update still only called once (from the first decision).
    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false with reason='move_not_found' when the row doesn't exist", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(null);
    const result = await decideMove("2026-05-12", 99, "approved");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("move_not_found");
    }
  });
});
