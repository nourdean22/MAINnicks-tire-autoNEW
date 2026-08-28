/**
 * tests/agent/follow-up.test.ts — agent-initiated follow-ups (2026-08-28).
 *
 * This is the most dangerous surface in the wave: an agent that can wake
 * itself can spam its owner or bill him in a loop. Every guardrail gets a
 * test that BREAKS when the guardrail is removed, and the suite asserts
 * the safe default (off) as loudly as it asserts the happy path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCount = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockFindUnique = vi.fn();
const mockConvFindUnique = vi.fn();
const mockFindMany = vi.fn();
const mockUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    postTurnOutbox: {
      count: (a: unknown) => mockCount(a),
      findFirst: (a: unknown) => mockFindFirst(a),
      create: (a: unknown) => mockCreate(a),
      findUnique: (a: unknown) => mockFindUnique(a),
      findMany: (a: unknown) => mockFindMany(a),
      updateMany: (a: unknown) => mockUpdateMany(a),
    },
    chatConversation: { findUnique: (a: unknown) => mockConvFindUnique(a) },
  },
}));

import {
  scheduleFollowUp,
  claimDueFollowUps,
  areFollowUpsEnabled,
  FOLLOWUP_DAILY_CAP,
  FOLLOWUP_PER_THREAD_CAP,
  FOLLOWUP_MIN_DELAY_MS,
} from "@/lib/agent/follow-up";

const HOUR = 60 * 60_000;

/** A request that should succeed once the switch is on. */
const OK = {
  conversationId: "conv-1",
  instruction: "check whether the supplier replied",
  dedupeKey: "supplier-reply-check",
  reason: "operator asked to be reminded if no reply",
  runAfterMs: 2 * HOUR,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NICK_AGENT_FOLLOWUPS = "1";
  mockConvFindUnique.mockResolvedValue({ id: "conv-1" });
  mockCount.mockResolvedValue(0);
  mockFindFirst.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "row-1" });
});
afterEach(() => {
  delete process.env.NICK_AGENT_FOLLOWUPS;
});

describe("the switch ships OFF — merging this cannot produce a message", () => {
  it("is disabled unless explicitly enabled", () => {
    delete process.env.NICK_AGENT_FOLLOWUPS;
    expect(areFollowUpsEnabled()).toBe(false);
    process.env.NICK_AGENT_FOLLOWUPS = "0";
    expect(areFollowUpsEnabled()).toBe(false);
    process.env.NICK_AGENT_FOLLOWUPS = "1";
    expect(areFollowUpsEnabled()).toBe(true);
  });

  it("refuses to schedule while disabled, and writes NOTHING", async () => {
    delete process.env.NICK_AGENT_FOLLOWUPS;
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("disabled");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("claims nothing while disabled — a queued row cannot fire after the switch goes off", async () => {
    delete process.env.NICK_AGENT_FOLLOWUPS;
    expect(await claimDueFollowUps()).toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

describe("prompt-injection boundary", () => {
  it("a turn carrying untrusted external content can NEVER schedule autonomous work", async () => {
    const r = await scheduleFollowUp({ ...OK, untrustedOrigin: true });
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("untrusted-origin");
    expect(mockCreate).not.toHaveBeenCalled();
    // Positive control: the identical request without the flag succeeds,
    // so this proves the FLAG is what refused, not a broken happy path.
    const ok = await scheduleFollowUp(OK);
    expect(ok.scheduled).toBe(true);
  });

  it("private turns cannot schedule", async () => {
    const r = await scheduleFollowUp({ ...OK, privateMode: true });
    expect(r.scheduled).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("caps bound a runaway", () => {
  it("global daily cap refuses with the count", async () => {
    mockCount.mockResolvedValue(FOLLOWUP_DAILY_CAP);
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("daily-cap");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("per-thread cap stops one conversation monopolising the budget", async () => {
    // Global count under the cap, thread count at it.
    mockCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(FOLLOWUP_PER_THREAD_CAP);
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("thread-cap");
  });

  it("a duplicate dedupe key collapses to one row", async () => {
    mockFindFirst.mockResolvedValue({ id: "already-queued" });
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("duplicate");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("cannot schedule itself to fire immediately — no tight loops", async () => {
    const r = await scheduleFollowUp({ ...OK, runAfterMs: 1000 });
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("delay-out-of-range");
    expect(FOLLOWUP_MIN_DELAY_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("cannot park work beyond the max horizon", async () => {
    const r = await scheduleFollowUp({ ...OK, runAfterMs: 365 * 24 * HOUR });
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("delay-out-of-range");
  });
});

describe("fails CLOSED", () => {
  it("a DB error refuses rather than allowing — inverting getAiConfig's fail-open", async () => {
    mockCount.mockRejectedValue(new Error("neon unreachable"));
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("error");
    expect(r.reason).toContain("fail closed");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses when the conversation does not exist", async () => {
    mockConvFindUnique.mockResolvedValue(null);
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(false);
    expect(r.refusedBecause).toBe("missing-conversation");
  });
});

describe("the happy path, and what it writes", () => {
  it("queues on the EXISTING outbox with the follow-up kind — no new table", async () => {
    const r = await scheduleFollowUp(OK);
    expect(r.scheduled).toBe(true);
    const arg = mockCreate.mock.calls[0][0] as {
      data: { kind: string; status: string; nextAttemptAt: Date; payload: Record<string, unknown> };
    };
    expect(arg.data.kind).toBe("agent-followup");
    expect(arg.data.status).toBe("pending");
    // nextAttemptAt IS the scheduling primitive — it must be in the future.
    expect(arg.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + HOUR);
    expect(arg.data.payload.conversationId).toBe("conv-1");
    expect(arg.data.payload.dedupeKey).toBe("supplier-reply-check");
  });

  it("truncates instruction and reason so a runaway prompt cannot bloat the row", async () => {
    await scheduleFollowUp({ ...OK, instruction: "x".repeat(9000), reason: "y".repeat(9000) });
    const arg = mockCreate.mock.calls[0][0] as { data: { payload: Record<string, string> } };
    expect(arg.data.payload.instruction.length).toBeLessThanOrEqual(2000);
    expect(arg.data.payload.reason.length).toBeLessThanOrEqual(500);
  });
});

describe("claiming is race-safe and schedule-respecting", () => {
  it("only claims rows whose time has come, oldest first", async () => {
    mockFindMany.mockResolvedValue([]);
    await claimDueFollowUps();
    const arg = mockFindMany.mock.calls[0][0] as {
      where: { kind: string; status: string; nextAttemptAt: { lte: Date } };
      orderBy: { nextAttemptAt: string };
    };
    expect(arg.where.kind).toBe("agent-followup");
    expect(arg.where.status).toBe("pending");
    // The whole point: due-time, NOT an orphan grace window.
    expect(arg.where.nextAttemptAt.lte).toBeInstanceOf(Date);
    expect(arg.orderBy.nextAttemptAt).toBe("asc");
  });

  it("losing the claim race yields nothing — two drains cannot both run one follow-up", async () => {
    mockFindMany.mockResolvedValue([{ id: "row-1" }]);
    mockUpdateMany.mockResolvedValue({ count: 0 }); // another drain won
    expect(await claimDueFollowUps()).toEqual([]);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("winning the claim returns the payload", async () => {
    mockFindMany.mockResolvedValue([{ id: "row-1" }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "row-1",
      payload: { conversationId: "conv-1", instruction: "check", dedupeKey: "k", reason: "r", scheduledAt: "" },
      attempts: 1,
    });
    const claimed = await claimDueFollowUps();
    expect(claimed).toHaveLength(1);
    expect(claimed[0].payload.conversationId).toBe("conv-1");
  });
});
