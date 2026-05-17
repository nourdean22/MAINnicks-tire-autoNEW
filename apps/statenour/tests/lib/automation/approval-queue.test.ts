/**
 * Approval queue tests · v10.0.153
 *
 * Verifies the read/write spine over AutonomousAction rows where
 * approval = "pending":
 *   · listPendingActions joins with the policy registry correctly
 *   · summarizeQueue rolls up correctly + handles empty case
 *   · decidePendingAction validates state + writes the right verdict
 *
 * Heavy DB-touching paths are mocked at the prisma layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    autonomousAction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    automationPolicy: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));
// v10.0.157 · approval-queue now dynamically imports executeApprovedAction
// from the autonomous-engine on approve. Stub it out so unit tests don't
// pull in the engine's full dependency tree.
vi.mock("@/lib/brain/autonomous-engine", () => ({
  executeApprovedAction: vi.fn(async () => ({ ok: true, result: "stubbed" })),
}));

import {
  listPendingActions,
  summarizeQueue,
  decidePendingAction,
} from "@/lib/automation/approval-queue";

const mkRow = (over: Partial<{ id: string; ruleName: string; createdAt: Date; approval: string }>) => ({
  id: over.id ?? "a1",
  ruleName: over.ruleName ?? "auto_followup_expired_quote",
  trigger: "trig",
  actionType: "send_email",
  targetType: "lead",
  targetId: "L1",
  payload: null,
  approval: over.approval ?? "pending",
  approvedBy: null,
  result: "pending",
  error: null,
  executedAt: null,
  createdAt: over.createdAt ?? new Date("2026-05-03T10:00:00Z"),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listPendingActions", () => {
  it("returns empty array when no pending rows", async () => {
    mockPrisma.autonomousAction.findMany.mockResolvedValueOnce([]);
    const rows = await listPendingActions();
    expect(rows).toEqual([]);
    expect(mockPrisma.automationPolicy.findMany).not.toHaveBeenCalled();
  });

  it("joins each row with its matching AutomationPolicy", async () => {
    mockPrisma.autonomousAction.findMany.mockResolvedValueOnce([
      mkRow({ id: "a1", ruleName: "rule_a" }),
      mkRow({ id: "a2", ruleName: "rule_b" }),
    ]);
    mockPrisma.automationPolicy.findMany.mockResolvedValueOnce([
      {
        id: "autonomous-action.rule_a",
        approvalClass: "pending",
        objective: "obj a",
      },
    ]);
    const rows = await listPendingActions();
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.id === "a1");
    expect(a?.policyId).toBe("autonomous-action.rule_a");
    expect(a?.policyApprovalClass).toBe("pending");
    expect(a?.policyObjective).toBe("obj a");
    const b = rows.find((r) => r.id === "a2");
    expect(b?.policyId).toBeNull(); // rule_b had no registry entry
    expect(b?.policyObjective).toBeNull();
  });
});

describe("summarizeQueue", () => {
  it("returns zero-state when nothing pending", async () => {
    mockPrisma.autonomousAction.findMany.mockResolvedValueOnce([]);
    const s = await summarizeQueue();
    expect(s).toEqual({ total: 0, byRule: [], oldestAgeMin: null });
  });

  it("aggregates byRule counts in descending order", async () => {
    mockPrisma.autonomousAction.findMany.mockResolvedValueOnce([
      { ruleName: "x", createdAt: new Date() },
      { ruleName: "x", createdAt: new Date() },
      { ruleName: "y", createdAt: new Date() },
    ]);
    const s = await summarizeQueue();
    expect(s.total).toBe(3);
    expect(s.byRule[0]).toEqual({ ruleName: "x", count: 2 });
    expect(s.byRule[1]).toEqual({ ruleName: "y", count: 1 });
  });

  it("computes oldestAgeMin from the earliest createdAt", async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    mockPrisma.autonomousAction.findMany.mockResolvedValueOnce([
      { ruleName: "x", createdAt: new Date() },
      { ruleName: "x", createdAt: oneHourAgo },
    ]);
    const s = await summarizeQueue();
    expect(s.oldestAgeMin).toBeGreaterThanOrEqual(59);
    expect(s.oldestAgeMin).toBeLessThanOrEqual(61);
  });
});

describe("decidePendingAction", () => {
  it("404s when the row id doesn't exist", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce(null);
    await expect(decidePendingAction("missing", "approved")).rejects.toThrow(
      /not found/,
    );
  });

  it("409s when the row is not in pending state", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce(
      mkRow({ id: "a1", approval: "approved" }),
    );
    await expect(decidePendingAction("a1", "rejected")).rejects.toThrow(
      /not pending/,
    );
  });

  it("approves: sets approval + approvedBy + executedAt", async () => {
    const row = mkRow({ id: "a1" });
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce(row);
    mockPrisma.autonomousAction.update.mockResolvedValueOnce({
      ...row,
      approval: "approved",
      approvedBy: "nour",
      executedAt: new Date(),
    });
    mockPrisma.automationPolicy.findFirst.mockResolvedValueOnce(null);
    await decidePendingAction("a1", "approved");
    const call = mockPrisma.autonomousAction.update.mock.calls[0][0];
    expect(call.data.approval).toBe("approved");
    expect(call.data.approvedBy).toBe("nour");
    expect(call.data.executedAt).toBeInstanceOf(Date);
  });

  it("rejects: sets approval but leaves executedAt as-was", async () => {
    const existingExecuted = new Date("2026-05-01");
    const row = { ...mkRow({ id: "a1" }), executedAt: existingExecuted };
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce(row);
    mockPrisma.autonomousAction.update.mockResolvedValueOnce({
      ...row,
      approval: "rejected",
    });
    mockPrisma.automationPolicy.findFirst.mockResolvedValueOnce(null);
    await decidePendingAction("a1", "rejected");
    const call = mockPrisma.autonomousAction.update.mock.calls[0][0];
    expect(call.data.approval).toBe("rejected");
    expect(call.data.executedAt).toEqual(existingExecuted); // untouched
  });

  it("folds approval notes into payload without losing existing data", async () => {
    const row = { ...mkRow({ id: "a1" }), payload: { existing: 1 } };
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce(row);
    mockPrisma.autonomousAction.update.mockResolvedValueOnce(row);
    mockPrisma.automationPolicy.findFirst.mockResolvedValueOnce(null);
    await decidePendingAction("a1", "approved", "nour", "looks good");
    const call = mockPrisma.autonomousAction.update.mock.calls[0][0];
    expect(call.data.payload).toEqual({ existing: 1, approvalNote: "looks good" });
  });
});
