/**
 * claimWorkItems TOCTOU & Spin Guard tests · Track B.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  workItem: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
  runnerNode: {
    upsert: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workItem: mocks.workItem,
    runnerNode: mocks.runnerNode,
  },
}));

vi.mock("@/lib/demo-store", () => ({
  getDemoState: vi.fn(() => ({})),
}));
vi.mock("@/lib/runtime", () => ({ isDemoMode: false }));

import { claimWorkItems, heartbeatRunner } from "@/lib/services/runner-state";

describe("claimWorkItems TOCTOU and spin guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runnerNode.upsert.mockResolvedValue({ id: "node-1" });
  });

  it("excludes already attempted items during concurrent race (TOCTOU exclusion)", async () => {
    // 1. First iteration finds "item-1"
    mocks.workItem.findFirst.mockResolvedValueOnce({ id: "item-1", type: "TASK_RUN" });
    // 2. updateMany returns count: 0 (lost the race)
    mocks.workItem.updateMany.mockResolvedValueOnce({ count: 0 });

    // 3. Second iteration finds "item-2" (with item-1 excluded)
    mocks.workItem.findFirst.mockResolvedValueOnce({ id: "item-2", type: "TASK_RUN" });
    // 4. updateMany returns count: 1 (won the race)
    mocks.workItem.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.workItem.findUnique.mockResolvedValueOnce({ id: "item-2", type: "TASK_RUN", status: "CLAIMED" });

    // Let's call with limit = 1
    const result = await claimWorkItems({ nodeKey: "node-key", limit: 1 });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("item-2");

    // Verify findFirst calls and the exclusion list
    expect(mocks.workItem.findFirst).toHaveBeenCalledTimes(2);
    
    // First findFirst call: no exclusion list (empty)
    const call1 = mocks.workItem.findFirst.mock.calls[0][0];
    expect(call1.where.id).toBeUndefined();

    // Second findFirst call: excludes "item-1"
    const call2 = mocks.workItem.findFirst.mock.calls[1][0];
    expect(call2.where.id).toEqual({ notIn: ["item-1"] });
  });

  it("enforces hardCap of limit * 2 to prevent infinite spinning", async () => {
    // limit = 2 -> hardCap = 4
    // We always return a candidate, but updateMany always returns 0 (lost race)
    mocks.workItem.findFirst.mockResolvedValue({ id: "item-x", type: "TASK_RUN" });
    mocks.workItem.updateMany.mockResolvedValue({ count: 0 });

    const result = await claimWorkItems({ nodeKey: "node-key", limit: 2 });

    expect(result).toHaveLength(0);
    // Should have checked findFirst exactly 4 times (hardCap = 2 * 2 = 4) and then bailed
    expect(mocks.workItem.findFirst).toHaveBeenCalledTimes(4);
  });

  it("does not erase runner metadata when claim heartbeat omits metadata", async () => {
    mocks.workItem.findFirst.mockResolvedValue(null);

    await claimWorkItems({ nodeKey: "external-worker:nattynour", limit: 1 });

    const upsert = mocks.runnerNode.upsert.mock.calls[0][0];
    expect(upsert.update).not.toHaveProperty("metadata");
    expect(upsert.create.metadata).toEqual({});
  });

  it("writes explicit heartbeat metadata on both update and create paths", async () => {
    const metadata = {
      externalWorker: { writesEnabled: false, lanes: { "local-qwen": { health: "ready" } } },
    };

    await heartbeatRunner({
      nodeKey: "external-worker:nattynour",
      label: "NOUR External Worker",
      status: "READY",
      version: "external-worker-v1",
      metadata,
    });

    const upsert = mocks.runnerNode.upsert.mock.calls[0][0];
    expect(upsert.update.metadata).toEqual(metadata);
    expect(upsert.create.metadata).toEqual(metadata);
  });
});
