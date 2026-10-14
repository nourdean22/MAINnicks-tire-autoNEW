/**
 * decidePendingAction when the side effect fails (branch statenour/memory-gsc-approvals-dump).
 *
 * THE DEFECT: executeApprovedAction returned { ok: false }, but the row was still written
 * approval="approved". The owner saw success, the row left the queue, and nothing could
 * retry the side effect. A failed run must leave the row pending, with the error kept.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  ruleName: string;
  trigger: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  approval: string;
  approvedBy: string | null;
  result: string | null;
  error: string | null;
  executedAt: Date | null;
  createdAt: Date;
};

const h = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  const approvalHistory: string[] = [];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
  const autonomousAction = {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      return r ? { ...r } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows.get(where.id);
      if (!r) throw new Error("P2025 record not found");
      if (typeof data.approval === "string") approvalHistory.push(data.approval);
      Object.assign(r, data);
      return { ...r };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows.get(where.id as string);
      if (!r || !matches(r, where)) return { count: 0 };
      if (typeof data.approval === "string") approvalHistory.push(data.approval);
      Object.assign(r, data);
      return { count: 1 };
    }),
  };
  const executeApprovedAction = vi.fn(async (_id: string) => ({ ok: true, result: "sent" }));
  return { rows, approvalHistory, autonomousAction, executeApprovedAction };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    autonomousAction: h.autonomousAction,
    automationPolicy: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/brain/autonomous-engine", () => ({ executeApprovedAction: h.executeApprovedAction }));
vi.mock("@/lib/automation/policy", () => ({ getPolicy: vi.fn(async () => null) }));
vi.mock("@/lib/services/email", () => ({
  sendEmail: vi.fn(async () => {
    throw new Error("a test must never send email");
  }),
}));

import { decidePendingAction } from "@/lib/automation/approval-queue";

function seed(id = "a1") {
  h.rows.set(id, {
    id,
    ruleName: "auto_followup_expired_quote",
    trigger: "quote expired",
    actionType: "send_email",
    targetType: "lead",
    targetId: "L1",
    payload: { deferredItem: { leadId: "L1" } },
    approval: "pending",
    approvedBy: null,
    result: null,
    error: null,
    executedAt: null,
    createdAt: new Date(Date.now() - 60_000),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.approvalHistory.length = 0;
  // clearAllMocks does not drain a queued Once value, so reset the stub outright.
  h.executeApprovedAction.mockReset().mockResolvedValue({ ok: true, result: "sent" });
});

describe("decidePendingAction when the side effect fails", () => {
  it("a failed execution never lands approved: the row goes back to pending with the error", async () => {
    seed();
    h.executeApprovedAction.mockResolvedValueOnce({ ok: false, error: "gmail 401" });
    await decidePendingAction("a1", "approved");
    const row = h.rows.get("a1");
    expect(row?.approval).toBe("pending");
    expect(h.approvalHistory).not.toContain("approved");
    expect(row?.result).toBe("failed");
    expect(row?.error).toBe("gmail 401");
    expect(row?.executedAt).toBeNull();
    expect(row?.approvedBy).toBeNull();
  });

  it("after a failed run, approving again runs the side effect again and lands approved", async () => {
    seed();
    h.executeApprovedAction.mockResolvedValueOnce({ ok: false, error: "gmail 401" });
    await decidePendingAction("a1", "approved");
    await decidePendingAction("a1", "approved");
    expect(h.executeApprovedAction).toHaveBeenCalledTimes(2);
    expect(h.rows.get("a1")?.approval).toBe("approved");
    expect(h.rows.get("a1")?.error).toBeNull();
  });

  it("control: a successful run lands approved with executedAt stamped", async () => {
    seed();
    const out = await decidePendingAction("a1", "approved");
    expect(out.id).toBe("a1");
    expect(h.rows.get("a1")?.approval).toBe("approved");
    expect(h.rows.get("a1")?.executedAt).toBeInstanceOf(Date);
  });
});
