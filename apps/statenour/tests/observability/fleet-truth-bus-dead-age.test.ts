/**
 * fleet-truth's brain-bus oldestDeadAt is the age of a DEAD row (audit 08-X5, 2026-10-11).
 *
 * It was filled from oldestStuckProcessing, so a dead pile with nothing stuck read
 * oldestDeadAt null ("clean") and a stuck row with no dead ones read as a dead age.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ deadAt: null as Date | null, stuckAt: null as Date | null }));

vi.mock("@/lib/prisma", () => {
  const brainBusEvent = {
    count: async ({ where }: { where: { status: string } }) => (where.status === "dead" && h.deadAt ? 1 : 0),
    findFirst: async ({ where }: { where: { status: string } }) => {
      if (where.status === "dead") return h.deadAt ? { createdAt: h.deadAt } : null;
      if (where.status === "processing") return h.stuckAt ? { lockedAt: h.stuckAt } : null;
      return null;
    },
  };
  const anyModel = { findFirst: async () => null, count: async () => 0 };
  return { prisma: new Proxy({ brainBusEvent } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? anyModel }) };
});
vi.mock("@/lib/services/chat/post-turn-outbox", () => ({
  getOutboxHealth: async () => ({ pending: 0, processing: 0, dead: 0, oldestDeadAt: null }),
}));
vi.mock("@/lib/services/runner-state", () => ({
  getWorkItemQueueHealth: async () => ({ pending: 0, processing: 0, dead: 0, oldestDeadAt: null }),
}));

import { getFleetTruth } from "@/lib/observability/fleet-truth";

beforeEach(() => {
  h.deadAt = null;
  h.stuckAt = null;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
});
afterEach(() => vi.unstubAllGlobals());

describe("fleet-truth: brain-bus oldestDeadAt", () => {
  it("one dead row 3h old, nothing stuck -> oldestDeadAt is that row's createdAt", async () => {
    h.deadAt = new Date(Date.now() - 3 * 3_600_000);
    const t = await getFleetTruth();
    expect(t.queues.brainBus?.dead).toBe(1);
    expect(t.queues.brainBus?.oldestDeadAt).toBe(h.deadAt.toISOString());
  });

  it("CONTROL: a stuck processing row with no dead rows is not a dead age", async () => {
    h.stuckAt = new Date(Date.now() - 20 * 60_000);
    const t = await getFleetTruth();
    expect(t.queues.brainBus?.oldestDeadAt).toBeNull();
  });
});
