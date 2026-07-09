/**
 * AG-42 · approval-request dedupe window (2026-07-09).
 *
 * Pre-fix, withGuardian's require_approval dedupe matched identical
 * payloads with NO time bound: a `rejected` row from weeks ago
 * permanently blocked the same action, and an old `executed` row
 * replayed its stale resultPayload as if fresh. These tests pin the
 * 24h window on the findFirst query and the behavior on both sides
 * of a match.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({
    decision: "require_approval",
    riskClass: "medium",
    reason: "mocked approval gate",
  }),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      findFirst: vi.fn(),
      create: vi.fn(async () => ({ id: "req_new" })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  withGuardian,
  GuardianApprovalPendingError,
  pendingExecutions,
  durableToolExecutors,
} from "@/lib/tools/guardian";

const PAYLOAD = { target: "x", destructive: false };

beforeEach(() => {
  vi.clearAllMocks();
  pendingExecutions.clear();
  durableToolExecutors.clear();
  prismaMock.approvalRequest.findFirst.mockResolvedValue(null);
});

describe("withGuardian · approval dedupe 24h window", () => {
  it("bounds the dedupe lookup to the last 24h", async () => {
    const guarded = withGuardian("test-tool-window", async () => "ok");
    await expect(guarded(PAYLOAD)).rejects.toThrow(GuardianApprovalPendingError);

    expect(prismaMock.approvalRequest.findFirst).toHaveBeenCalledTimes(1);
    const where = prismaMock.approvalRequest.findFirst.mock.calls[0][0].where;
    expect(where.createdAt?.gte).toBeInstanceOf(Date);
    const boundMs = Date.now() - (where.createdAt.gte as Date).getTime();
    // ~24h ago, with generous slack for test runtime.
    expect(boundMs).toBeGreaterThan(24 * 3600_000 - 10_000);
    expect(boundMs).toBeLessThan(24 * 3600_000 + 10_000);
  });

  it("a fresh executed row inside the window still short-circuits with its result", async () => {
    prismaMock.approvalRequest.findFirst.mockResolvedValueOnce({
      id: "req_1",
      status: "executed",
      payload: PAYLOAD,
      resultPayload: { done: true },
    });
    const guarded = withGuardian("test-tool-window", async () => "ok");
    await expect(guarded(PAYLOAD)).resolves.toEqual({ done: true });
    expect(prismaMock.approvalRequest.create).not.toHaveBeenCalled();
  });

  it("no in-window match → a NEW approval request is created (stale rows no longer block)", async () => {
    // findFirst returns null — exactly what the 24h bound produces for
    // a payload last seen weeks ago. The old behavior would have
    // matched the ancient row and thrown "rejected by operator".
    const guarded = withGuardian("test-tool-window", async () => "ok");
    await expect(guarded(PAYLOAD)).rejects.toThrow(GuardianApprovalPendingError);
    expect(prismaMock.approvalRequest.create).toHaveBeenCalledTimes(1);
  });
});
