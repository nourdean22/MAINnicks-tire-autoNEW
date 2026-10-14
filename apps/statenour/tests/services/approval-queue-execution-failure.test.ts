/**
 * decidePendingAction when the side effect fails.
 *
 * THE DEFECT (dbd12704f): a failed run returned the row to pending, so a second approve re-ran
 * the side effect. A provider can accept a send and lose the HTTP response, so a failed run may
 * already have happened and is never re-run. The row stays terminal (needs_review) with result
 * "failed", the error and the payload kept. A failed run is logged to the policy fire-log as a
 * failure, never as a success or a rollback.
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

const POLICY_ID = "autonomous-action.auto_followup_expired_quote";

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
  const getPolicy = vi.fn(async (_id: string): Promise<unknown> => null);
  const logPolicyFire = vi.fn(async (_id: string, _result: string) => undefined);
  return { rows, approvalHistory, autonomousAction, executeApprovedAction, getPolicy, logPolicyFire };
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
vi.mock("@/lib/automation/policy", () => ({ getPolicy: h.getPolicy, logPolicyFire: h.logPolicyFire }));
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

// The policy fire-log is written in a detached promise chain; let it settle before asserting.
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.approvalHistory.length = 0;
  // clearAllMocks does not drain a queued Once value, so reset the stubs outright.
  h.executeApprovedAction.mockReset().mockResolvedValue({ ok: true, result: "sent" });
  h.getPolicy.mockReset().mockResolvedValue(null);
  h.logPolicyFire.mockReset();
});

describe("decidePendingAction when the side effect fails", () => {
  it("a failed run is never approved and never returns to pending: it is needs_review, with the error and payload kept", async () => {
    seed();
    h.executeApprovedAction.mockResolvedValueOnce({ ok: false, error: "gmail 401" });
    await decidePendingAction("a1", "approved");
    const row = h.rows.get("a1");
    expect(row?.approval).toBe("needs_review");
    expect(h.approvalHistory).not.toContain("approved");
    expect(h.approvalHistory).not.toContain("pending");
    expect(row?.result).toBe("failed");
    expect(row?.error).toBe("gmail 401");
    expect(row?.executedAt).toBeNull();
    expect(row?.payload).toEqual({ deferredItem: { leadId: "L1" } });
  });

  it("a failed run is never re-sent: a second approve is refused and the side effect runs once", async () => {
    seed();
    h.executeApprovedAction.mockResolvedValueOnce({ ok: false, error: "gmail 401" });
    await decidePendingAction("a1", "approved");
    await expect(decidePendingAction("a1", "approved")).rejects.toThrow(/not pending/);
    expect(h.executeApprovedAction).toHaveBeenCalledTimes(1);
    expect(h.rows.get("a1")?.approval).toBe("needs_review");
  });

  it("control: a successful run lands approved with executedAt stamped", async () => {
    seed();
    const out = await decidePendingAction("a1", "approved");
    expect(out.id).toBe("a1");
    expect(h.rows.get("a1")?.approval).toBe("approved");
    expect(h.rows.get("a1")?.executedAt).toBeInstanceOf(Date);
  });
});

describe("decidePendingAction policy fire-log", () => {
  it("a failed run writes a failure fire-log entry, so /system/policies does not keep an older success", async () => {
    seed();
    h.getPolicy.mockResolvedValue({ id: POLICY_ID });
    h.executeApprovedAction.mockResolvedValueOnce({ ok: false, error: "gmail 401" });
    await decidePendingAction("a1", "approved");
    await flush();
    expect(h.getPolicy).toHaveBeenCalledWith(POLICY_ID);
    expect(h.logPolicyFire).toHaveBeenCalledTimes(1);
    expect(h.logPolicyFire).toHaveBeenCalledWith(POLICY_ID, "failure");
  });

  it("control: a successful run with a policy logs a success fire", async () => {
    seed();
    h.getPolicy.mockResolvedValue({ id: POLICY_ID });
    await decidePendingAction("a1", "approved");
    await flush();
    expect(h.logPolicyFire).toHaveBeenCalledWith(POLICY_ID, "success");
  });
});
