/**
 * tests/brain/task-queue-unavailable.test.ts · 2026-09-10
 *
 * The same empty-vs-error split, at the block Nour asks about most
 * directly.
 *
 * `buildTaskContextBlock` returned "" for BOTH an empty queue and a
 * failed read. With no block and no explanation, NICK answers "what am I
 * working on" from an absent context and tells the operator he has
 * nothing in progress -- a false statement about his own work, in NICK's
 * voice, on a turn where the only thing that happened was a database
 * read failing.
 *
 * The control is the load-bearing half: a genuinely empty queue is a real
 * measurement and must stay silent, or every cleared-queue day arrives
 * with a warning stapled to it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { task: { findMany: mocks.findMany } } }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ warn: vi.fn(), info: vi.fn() }) },
}));

import { buildTaskContextBlock, TASK_QUEUE_UNAVAILABLE } from "@/lib/brain/task-context";

beforeEach(() => vi.clearAllMocks());

describe("an unreadable task queue is not an empty one", () => {
  it("CANARY · the read throws => an explicit UNAVAILABLE block", async () => {
    mocks.findMany.mockRejectedValue(new Error("db down"));

    const block = await buildTaskContextBlock();

    expect(block).toBe(TASK_QUEUE_UNAVAILABLE);
    expect(block).toMatch(/UNAVAILABLE/);
    // The instruction is what makes it a control rather than a status line.
    expect(block).toMatch(/NOT an empty queue/i);
    expect(block).toMatch(/do not say he has nothing in progress/i);
    // And it must not be silently droppable by an `if (block)` caller.
    expect(block.trim().length).toBeGreaterThan(0);
  });
});

describe("CONTROL · a genuinely empty queue stays silent", () => {
  it("zero tasks => no block at all", async () => {
    // A real measurement. Warning about it would train the model -- and
    // the operator -- to ignore the warning that matters.
    mocks.findMany.mockResolvedValue([]);

    expect(await buildTaskContextBlock()).toBe("");
  });

  it("a populated queue renders the queue, not a warning", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "t1",
        title: "ship the gate",
        status: "DOING",
        priority: "HIGH",
        createdAt: new Date(),
        updatedAt: new Date(),
        mission: { domain: "personal" },
      },
    ]);

    const block = await buildTaskContextBlock();

    expect(block).toMatch(/task queue \(live\)/i);
    expect(block).not.toMatch(/UNAVAILABLE/);
    expect(block).toMatch(/ship the gate/);
  });
});
