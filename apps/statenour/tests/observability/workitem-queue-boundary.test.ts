/**
 * tests/observability/workitem-queue-boundary.test.ts — WP-6 (2026-07-29).
 *
 * WP-6 asked: merge WorkItem into Task, or retire it. Tracing the
 * consumers answered NEITHER — WorkItem is a durable AI-job queue, not
 * a unit of operator work. These tests pin that boundary structurally,
 * so a future refactor cannot quietly re-file it as a task container
 * (which would put machine jobs into the operator's triage inbox and
 * force lease columns onto Task).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCount = vi.fn(() => Promise.resolve(0));
const mockFindFirst = vi.fn(() => Promise.resolve(null));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workItem: {
      count: (a: unknown) => mockCount(a),
      findFirst: (a: unknown) => mockFindFirst(a),
    },
  },
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: () => false }));

import { getWorkItemQueueHealth } from "@/lib/services/runner-state";

beforeEach(() => vi.clearAllMocks());

describe("WorkItem is a QUEUE, reported in the queue vocabulary", () => {
  it("maps queue states the same way the outbox and bus do", async () => {
    mockCount
      .mockResolvedValueOnce(4 as never) // PENDING
      .mockResolvedValueOnce(2 as never) // CLAIMED
      .mockResolvedValueOnce(1 as never); // FAILED
    const h = await getWorkItemQueueHealth();
    expect(h).toMatchObject({ pending: 4, processing: 2, dead: 1 });
    // Exactly the QueueHealth shape fleet-truth renders for the other two.
    expect(Object.keys(h).sort()).toEqual(
      ["dead", "oldestDeadAt", "pending", "processing"].sort(),
    );
  });

  it("a clean queue reports oldestDeadAt null — never a fabricated timestamp", async () => {
    expect((await getWorkItemQueueHealth()).oldestDeadAt).toBeNull();
  });

  it("a long-stalled CLAIMED row surfaces even with zero failures", async () => {
    // The orchestrator only rescues stalled claims on its own schedule,
    // so a stuck lease is a real operator signal, not just noise.
    const stalled = new Date(Date.now() - 60 * 60 * 1000);
    mockFindFirst
      .mockResolvedValueOnce(null as never) // no FAILED
      .mockResolvedValueOnce({ claimedAt: stalled } as never);
    const h = await getWorkItemQueueHealth();
    expect(h.oldestDeadAt).toBe(stalled.toISOString());
  });

  it("reports the OLDER of a failure and a stalled claim", async () => {
    const older = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const newer = new Date(Date.now() - 30 * 60 * 1000);
    mockFindFirst
      .mockResolvedValueOnce({ updatedAt: newer } as never)
      .mockResolvedValueOnce({ claimedAt: older } as never);
    expect((await getWorkItemQueueHealth()).oldestDeadAt).toBe(older.toISOString());
  });

  it("only queries WorkItem — it never reads or writes Task", async () => {
    // The guard against the WP-6 category error: if someone 'merges'
    // WorkItem into Task, this health probe would have to touch Task,
    // and the prisma mock here exposes no task delegate at all.
    await expect(getWorkItemQueueHealth()).resolves.toBeDefined();
  });
});
