/**
 * decidePendingAction claims the row before it executes (07-SN-04).
 *
 * THE DEFECT: decidePendingAction read `approval === "pending"`, then ran
 * executeApprovedAction (which replays the rule's side effect -- e.g.
 * auto_followup_expired_quote emails a lead), then wrote the verdict by id.
 * Two approve clicks both read "pending" and both executed; a reject racing an
 * approve overwrote an executed row with "rejected".
 *
 * The in-memory store's updateMany evaluates WHERE against the CURRENT row,
 * so a claim that does not pin `approval` lets the second caller through.
 * executeApprovedAction is mocked: nothing is sent.
 *
 * Races are driven by a gate, not Promise.all: two CONCURRENT first
 * `await import("@/lib/brain/autonomous-engine")` calls from inside the module
 * resolved the mock for one and the REAL engine for the other on this vitest
 * (2026-10-10). Email and fetch are stubbed to throw as a second fence.
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
  const gates: { exec: Promise<void> | null; read: Promise<void> | null } = { exec: null, read: null };
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
  const autonomousAction = {
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      const snapshot = r ? { ...r } : null; // read NOW, deliver later
      if (gates.read) {
        const g = gates.read;
        gates.read = null;
        await g;
      }
      return snapshot;
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
  const executeApprovedAction = vi.fn(async (_id: string) => {
    if (gates.exec) {
      const g = gates.exec;
      gates.exec = null;
      await g;
    }
    return { ok: true, result: "sent" };
  });
  return { rows, approvalHistory, gates, autonomousAction, executeApprovedAction };
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
vi.stubGlobal(
  "fetch",
  vi.fn(async () => {
    throw new Error("network disabled in this test");
  }),
);

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

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  h.approvalHistory.length = 0;
  h.gates.exec = null;
  h.gates.read = null;
});

describe("decidePendingAction is a claim, not a check", () => {
  it("a second approve while the first is executing is refused (409) and executes nothing", async () => {
    seed();
    const g = gate();
    h.gates.exec = g.promise;
    const first = decidePendingAction("a1", "approved");
    await vi.waitFor(() => expect(h.executeApprovedAction).toHaveBeenCalledTimes(1));
    await expect(decidePendingAction("a1", "approved")).rejects.toMatchObject({ status: 409 });
    g.release();
    await first;
    expect(h.executeApprovedAction).toHaveBeenCalledTimes(1);
    expect(h.rows.get("a1")?.approval).toBe("approved");
  });

  it("two approves that read the same pending row: only one claim wins", async () => {
    // The first caller's read is taken, then parked; the second runs start to
    // finish; the first then decides on its STALE "pending". Only the swap's
    // WHERE can stop it -- the pre-check already passed.
    seed();
    const g = gate();
    h.gates.read = g.promise;
    const first = decidePendingAction("a1", "approved");
    await vi.waitFor(() => expect(h.autonomousAction.findUnique).toHaveBeenCalledTimes(1));
    await decidePendingAction("a1", "approved");
    g.release();
    await expect(first).rejects.toMatchObject({ status: 409 });
    expect(h.executeApprovedAction).toHaveBeenCalledTimes(1);
  });

  it("a reject racing an executing approve is refused; an executed row never reads rejected", async () => {
    seed();
    const g = gate();
    h.gates.exec = g.promise;
    const first = decidePendingAction("a1", "approved");
    await vi.waitFor(() => expect(h.executeApprovedAction).toHaveBeenCalledTimes(1));
    await expect(decidePendingAction("a1", "rejected")).rejects.toMatchObject({ status: 409 });
    g.release();
    await first;
    expect(h.approvalHistory).not.toContain("rejected");
    expect(h.rows.get("a1")?.approval).toBe("approved");
  });

  it("the claim pins id + approval=pending and lands before execution", async () => {
    seed();
    await decidePendingAction("a1", "approved");
    expect(h.autonomousAction.updateMany).toHaveBeenCalledWith({
      where: { id: "a1", approval: "pending" },
      data: { approval: "processing" },
    });
    expect(h.autonomousAction.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      h.executeApprovedAction.mock.invocationCallOrder[0],
    );
  });

  it("positive control: a single approve executes once and lands approved", async () => {
    seed();
    const out = await decidePendingAction("a1", "approved");
    expect(h.executeApprovedAction).toHaveBeenCalledWith("a1");
    expect(out.id).toBe("a1");
    expect(h.rows.get("a1")?.approval).toBe("approved");
  });

  it("positive control: a single reject executes nothing and lands rejected", async () => {
    seed();
    await decidePendingAction("a1", "rejected");
    expect(h.executeApprovedAction).not.toHaveBeenCalled();
    expect(h.rows.get("a1")?.approval).toBe("rejected");
  });
});
