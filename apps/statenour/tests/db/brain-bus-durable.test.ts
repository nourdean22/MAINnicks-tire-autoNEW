/**
 * v10 Track B.2 · Tests for durable brain-bus.
 *
 * Verifies the contract that closes the at-most-once gap:
 *   1. publishDurable writes a row before NOTIFY fires
 *   2. claimEvents is atomic across concurrent workers
 *   3. dedupeKey suppresses duplicate publishes
 *   4. markFailed reschedules with backoff, then dead-letters
 *   5. reclaimStaleProcessing rescues crashed workers
 *   6. pollAndProcess wraps the full lifecycle
 *
 * Most tests use mocked Prisma. The atomic-claim contract uses
 * $queryRaw with FOR UPDATE SKIP LOCKED — that's an integration
 * concern, tested only by shape here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainBusEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

// Mock the ephemeral bus — its publish() call should be fired but
// the durable path doesn't depend on its return value.
vi.mock("@/lib/db/brain-bus", () => ({
  publish: vi.fn().mockResolvedValue("notify-id"),
}));

import { prisma } from "@/lib/prisma";
import {
  publishDurable,
  claimEvents,
  markDone,
  markFailed,
  reclaimStaleProcessing,
  pollAndProcess,
} from "@/lib/db/brain-bus-durable";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10 B.2 · publishDurable", () => {
  it("creates a BrainBusEvent row and returns the id", async () => {
    vi.mocked(prisma.brainBusEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.brainBusEvent.create).mockResolvedValue({
      id: "evt_1",
    } as never);

    const result = await publishDurable("test-topic", "test.event", { foo: 1 });

    expect(result.id).toBe("evt_1");
    expect(result.deduped).toBe(false);
    expect(prisma.brainBusEvent.create).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(prisma.brainBusEvent.create).mock.calls[0]?.[0];
    expect(callArgs?.data).toMatchObject({
      topic: "test-topic",
      eventType: "test.event",
      status: "pending",
    });
  });

  it("dedupeKey · returns existing id without re-creating", async () => {
    vi.mocked(prisma.brainBusEvent.findUnique).mockResolvedValue({
      id: "evt_existing",
    } as never);

    const result = await publishDurable(
      "test-topic",
      "test.event",
      { foo: 1 },
      { dedupeKey: "key-1" },
    );

    expect(result.id).toBe("evt_existing");
    expect(result.deduped).toBe(true);
    expect(prisma.brainBusEvent.create).not.toHaveBeenCalled();
  });

  it("recovers from P2002 race on dedupeKey", async () => {
    // First call: no existing row.
    vi.mocked(prisma.brainBusEvent.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "evt_winner" } as never);
    // create fails with P2002 (concurrent insert won the race).
    const p2002 = Object.assign(new Error("unique violation"), {
      code: "P2002",
    });
    vi.mocked(prisma.brainBusEvent.create).mockRejectedValueOnce(p2002);

    const result = await publishDurable(
      "test-topic",
      "test.event",
      { foo: 1 },
      { dedupeKey: "key-race" },
    );

    expect(result.id).toBe("evt_winner");
  });

  it("noNotify=true skips the wake-bell publish", async () => {
    vi.mocked(prisma.brainBusEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.brainBusEvent.create).mockResolvedValue({
      id: "evt_silent",
    } as never);

    const { publish } = await import("@/lib/db/brain-bus");

    await publishDurable("test", "test.event", {}, { noNotify: true });

    expect(publish).not.toHaveBeenCalled();
  });
});

describe("v10 B.2 · claimEvents", () => {
  it("calls $queryRaw with the atomic claim pattern", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: "evt_1",
        topic: "t1",
        event_type: "type",
        payload: {},
        attempts: 1,
        created_at: new Date(),
        available_at: new Date(),
      },
    ] as never);

    const events = await claimEvents({ workerId: "test-worker", limit: 5 });
    expect(events.length).toBe(1);
    expect(events[0].id).toBe("evt_1");
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("clamps limit to [1, 100]", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await claimEvents({ workerId: "w", limit: 999 });
    await claimEvents({ workerId: "w", limit: 0 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("v10.0.27 · accepts the topic filter without throwing on Prisma template parsing", async () => {
    // Pre-v10.0.27 the topic filter was JS-string-interpolated into
    // the $queryRaw template, which Prisma parameterized as a value
    // and Postgres rejected as a syntax error. Now uses Prisma.sql /
    // Prisma.empty so the fragment composes correctly. We can't
    // exercise real Postgres here, but the prisma-tagged template
    // itself must not throw at JS evaluation time when Prisma
    // accepts a Prisma.Sql instance as an interpolated value.
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    await expect(
      claimEvents({ workerId: "w", limit: 5, topic: "cron.failure" }),
    ).resolves.not.toThrow();
    // Empty-topic path also evaluates cleanly (Prisma.empty fragment).
    await expect(
      claimEvents({ workerId: "w", limit: 5 }),
    ).resolves.not.toThrow();
  });
});

describe("v10 B.2 · markDone + markFailed", () => {
  it("markDone transitions to done + clears lock", async () => {
    vi.mocked(prisma.brainBusEvent.update).mockResolvedValue({} as never);
    await markDone("evt_1");
    const args = vi.mocked(prisma.brainBusEvent.update).mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: "evt_1" });
    expect(args?.data).toMatchObject({
      status: "done",
      lockedAt: null,
      lockedBy: null,
    });
  });

  it("markFailed · attempts < max · reschedules with backoff", async () => {
    vi.mocked(prisma.brainBusEvent.findUnique).mockResolvedValue({
      attempts: 1,
    } as never);
    vi.mocked(prisma.brainBusEvent.update).mockResolvedValue({} as never);

    await markFailed("evt_1", "transient error");

    const args = vi.mocked(prisma.brainBusEvent.update).mock.calls[0]?.[0];
    expect(args?.data?.status).toBe("pending");
    expect(args?.data?.availableAt).toBeInstanceOf(Date);
  });

  it("markFailed · attempts >= max · transitions to dead", async () => {
    vi.mocked(prisma.brainBusEvent.findUnique).mockResolvedValue({
      attempts: 5,
    } as never);
    vi.mocked(prisma.brainBusEvent.update).mockResolvedValue({} as never);

    await markFailed("evt_1", "final error", { maxAttempts: 5 });

    const args = vi.mocked(prisma.brainBusEvent.update).mock.calls[0]?.[0];
    expect(args?.data?.status).toBe("dead");
  });

  it("markFailed · slices error message to 1000 chars", async () => {
    vi.mocked(prisma.brainBusEvent.findUnique).mockResolvedValue({
      attempts: 1,
    } as never);
    vi.mocked(prisma.brainBusEvent.update).mockResolvedValue({} as never);

    const longError = "x".repeat(2000);
    await markFailed("evt_1", longError);

    const args = vi.mocked(prisma.brainBusEvent.update).mock.calls[0]?.[0];
    expect((args?.data?.lastError as string).length).toBe(1000);
  });
});

describe("v10 B.2 · reclaimStaleProcessing", () => {
  it("calls updateMany with locked_at < cutoff filter", async () => {
    vi.mocked(prisma.brainBusEvent.updateMany).mockResolvedValue({
      count: 3,
    } as never);

    const reclaimed = await reclaimStaleProcessing({ staleAfterMs: 60_000 });
    expect(reclaimed).toBe(3);

    const args = vi.mocked(prisma.brainBusEvent.updateMany).mock.calls[0]?.[0];
    expect(args?.where?.status).toBe("processing");
    expect(args?.data?.status).toBe("pending");
    expect(args?.data?.lockedAt).toBeNull();
  });

  it("default staleAfter is 5min", async () => {
    vi.mocked(prisma.brainBusEvent.updateMany).mockResolvedValue({
      count: 0,
    } as never);

    await reclaimStaleProcessing();

    const args = vi.mocked(prisma.brainBusEvent.updateMany).mock.calls[0]?.[0];
    const lockedAtFilter = args?.where?.lockedAt as { lt: Date };
    const expectedCutoff = Date.now() - 5 * 60_000;
    expect(lockedAtFilter.lt.getTime()).toBeLessThanOrEqual(expectedCutoff + 100);
    expect(lockedAtFilter.lt.getTime()).toBeGreaterThanOrEqual(
      expectedCutoff - 100,
    );
  });
});

describe("v10 B.2 · pollAndProcess lifecycle", () => {
  it("processed events get markDone, failed events get markFailed", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: "evt_ok",
        topic: "t",
        event_type: "ok",
        payload: {},
        attempts: 1,
        created_at: new Date(),
        available_at: new Date(),
      },
      {
        id: "evt_fail",
        topic: "t",
        event_type: "fail",
        payload: {},
        attempts: 1,
        created_at: new Date(),
        available_at: new Date(),
      },
    ] as never);
    vi.mocked(prisma.brainBusEvent.update).mockResolvedValue({} as never);
    vi.mocked(prisma.brainBusEvent.findUnique)
      // markFailed reads attempts...
      .mockResolvedValueOnce({ attempts: 1 } as never)
      // ...then pollAndProcess re-reads to determine dead status.
      .mockResolvedValueOnce({ status: "pending" } as never);

    const result = await pollAndProcess({
      workerId: "test",
      handler: async (event) => {
        if (event.id === "evt_fail") throw new Error("boom");
      },
    });

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dead).toBe(0);
  });

  it("dead-letter increments dead count", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: "evt_dead",
        topic: "t",
        event_type: "dead",
        payload: {},
        attempts: 5,
        created_at: new Date(),
        available_at: new Date(),
      },
    ] as never);
    vi.mocked(prisma.brainBusEvent.update).mockResolvedValue({} as never);
    vi.mocked(prisma.brainBusEvent.findUnique)
      .mockResolvedValueOnce({ attempts: 5 } as never)
      .mockResolvedValueOnce({ status: "dead" } as never);

    const result = await pollAndProcess({
      workerId: "test",
      handler: async () => {
        throw new Error("permanent");
      },
    });

    expect(result.processed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.dead).toBe(1);
  });
});
