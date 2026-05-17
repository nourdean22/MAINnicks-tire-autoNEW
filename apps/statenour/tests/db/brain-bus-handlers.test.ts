/**
 * v10 Track B.2.1 · Tests for brain-bus dispatch registry.
 *
 * Verifies:
 *   · Wildcard fallback fires when no specific topic registered.
 *   · The dispatcher resolves consistently for the same topic.
 *   · listRegisteredTopics returns at least the wildcard registration.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      // v10.0.26 — handler now uses findUnique + conditional create
      // for true idempotency (the upsert-with-empty-update was
      // bumping updatedAt and polluting recency sorts).
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "mock" }),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  dispatchDurableEvent,
  listRegisteredTopics,
  _resolveHandlerForTopic,
} from "@/lib/db/brain-bus-handlers";

const ctx = { workerId: "test", fromBackfill: false };

function fakeEvent(topic: string) {
  return {
    id: "e1",
    topic,
    eventType: "test",
    payload: {},
    attempts: 1,
    createdAt: new Date(),
    availableAt: new Date(),
  };
}

describe("v10 B.2.1 · dispatchDurableEvent", () => {
  it("dispatches an event without throwing (wildcard fallback)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(
      dispatchDurableEvent(fakeEvent("unknown.topic"), ctx),
    ).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("returns a function for any topic via _resolveHandlerForTopic", () => {
    expect(typeof _resolveHandlerForTopic("brain.alert")).toBe("function");
    expect(typeof _resolveHandlerForTopic("a.b.c")).toBe("function");
    expect(typeof _resolveHandlerForTopic("")).toBe("function");
  });

  it("resolves the same handler for the same topic across calls (idempotent)", () => {
    const h1 = _resolveHandlerForTopic("foo.bar");
    const h2 = _resolveHandlerForTopic("foo.bar");
    expect(h1).toBe(h2);
  });

  it("listRegisteredTopics includes the wildcard entry", () => {
    const topics = listRegisteredTopics();
    expect(topics.length).toBeGreaterThan(0);
    expect(topics).toContain("*");
  });

  it("propagates handler errors to caller (markFailed contract)", async () => {
    // The dispatcher itself doesn't catch — caller (cron) handles
    // outcome via markFailed/markDone. This test guards that the
    // dispatcher stays transparent if a handler ever throws.
    // v10.0.20 — the wildcard handler now uses logger.info; we
    // simulate an error inside that logger call to verify the
    // dispatcher does NOT swallow it.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const origLog = console.log;
    console.log = () => {
      throw new Error("simulated dispatch failure");
    };
    try {
      await expect(
        dispatchDurableEvent(fakeEvent("unmatched.topic"), ctx),
      ).rejects.toThrow("simulated dispatch failure");
    } finally {
      console.log = origLog;
      errSpy.mockRestore();
    }
  });
});

describe("v10.0.20 · cron.failure handler", () => {
  it("creates a BrainMemory row keyed by event id when none exists", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.brainMemory.create).mockClear();
    const event = {
      id: "evt-123",
      topic: "cron.failure",
      eventType: "cron_run_failed",
      payload: {
        jobName: "weekly-review",
        error: "ECONNREFUSED",
        durationMs: 5230,
        failedAt: new Date().toISOString(),
      },
      attempts: 1,
      createdAt: new Date(),
      availableAt: new Date(),
    };
    await dispatchDurableEvent(event, ctx);
    expect(prisma.brainMemory.create).toHaveBeenCalledTimes(1);
    const args = vi.mocked(prisma.brainMemory.create).mock.calls[0]?.[0];
    expect(args?.data?.category).toBe("system_alert");
    expect(args?.data?.key).toBe("cron-failure-evt-123");
    expect(args?.data?.content).toContain("weekly-review");
    expect(args?.data?.content).toContain("ECONNREFUSED");
  });

  it("repeat dispatch is a true no-op (no second create) — preserves updatedAt", async () => {
    // First call: row doesn't exist → create runs
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValueOnce(null);
    // Second call: row exists from first dispatch → create skipped
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValueOnce({
      id: "existing-row",
    } as never);
    vi.mocked(prisma.brainMemory.create).mockClear();
    const event = {
      id: "evt-456",
      topic: "cron.failure",
      eventType: "cron_run_failed",
      payload: { jobName: "drift-check", error: "boom" },
      attempts: 2,
      createdAt: new Date(),
      availableAt: new Date(),
    };
    await dispatchDurableEvent(event, ctx);
    await dispatchDurableEvent(event, ctx);
    // Only ONE create call across two dispatches — true idempotency.
    expect(prisma.brainMemory.create).toHaveBeenCalledTimes(1);
  });

  it("survives a Prisma create failure without re-throwing", async () => {
    vi.mocked(prisma.brainMemory.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.brainMemory.create).mockRejectedValueOnce(
      new Error("db down"),
    );
    const event = {
      id: "evt-789",
      topic: "cron.failure",
      eventType: "cron_run_failed",
      payload: { jobName: "x", error: "y" },
      attempts: 1,
      createdAt: new Date(),
      availableAt: new Date(),
    };
    await expect(
      dispatchDurableEvent(event, ctx),
    ).resolves.toBeUndefined();
  });
});
