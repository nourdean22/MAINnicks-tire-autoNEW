/**
 * ApprovalRequest approve / reject are compare-and-swaps on the row they read
 * (audit 2026-10-10, the sibling of the SN-04 AutonomousAction claim).
 *
 * THE DEFECT: both mutations wrote `update({ where: { id } })`. A Reject tapped
 * on a stale list entry rewrote an `executed` row to `rejected` (the audit then
 * said rejected for a tool that ran), and a second Approve that read the same
 * `pending_approval` row reset `executing` back to `approved`, re-arming the
 * executor's claim.
 *
 * Pinned (claim-before-act): the swap's WHERE names every field the decision
 * read (id, status, the updatedAt version, and the expiry deadline); count 0 is
 * CONFLICT with the row's real status, spawns nothing, and edits nothing.
 *
 * Also pinned (item 4): dismissing a reviewed approval settles its own ledger
 * attempt out of EXECUTING (to UNKNOWN: the review does not say whether it ran).
 *
 * The fake store evaluates the WHERE against the CURRENT row; `staleRead`
 * hands one caller an old snapshot, the way a second device would hold one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  approvals: new Map<string, Record<string, unknown>>(),
  attempts: new Map<string, Record<string, unknown>>(),
  staleRead: null as Record<string, unknown> | null,
  spawn: vi.fn(),
  pending: new Map<string, { fn: () => unknown; args: unknown[] }>(),
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (cond !== null && typeof cond === "object") {
      const c = cond as { in?: unknown[]; gt?: Date };
      if (c.in && !c.in.includes(v)) return false;
      if (c.gt && !((v as Date).getTime() > c.gt.getTime())) return false;
      return true;
    }
    return v === cond;
  });
}

vi.mock("@/lib/prisma", () => {
  const model = (rows: () => Map<string, Row>) => ({
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (h.staleRead) {
        const s = h.staleRead;
        h.staleRead = null;
        return { ...s };
      }
      const r = rows().get(where.id);
      return r ? { ...r } : null;
    }),
    findMany: vi.fn(async () => []),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = [...rows().values()].filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data, { updatedAt: new Date(Date.now() + 1) });
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
      const r = rows().get(where.id);
      if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(r, data, { updatedAt: new Date(Date.now() + 1) });
      return { ...r };
    }),
  });
  return { prisma: { approvalRequest: model(() => h.approvals), actionAttempt: model(() => h.attempts) } };
});
vi.mock("@/lib/tools/guardian", () => ({ executeApprovedToolAsync: h.spawn, pendingExecutions: h.pending }));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));

import { router } from "@/lib/trpc/trpc";
import { actionsProcedures } from "@/lib/trpc/routers/system/actions";
import { prisma } from "@/lib/prisma";

const caller = router({ ...actionsProcedures }).createCaller({
  session: { id: "op", email: "op@statenour.local", role: "owner" },
} as never);

const MIN = 60_000;

function seed(id: string, status: string, extra: Row = {}) {
  const row = {
    id,
    toolId: "gmail.sendDraft",
    actionType: "require_approval",
    riskClass: "medium",
    status,
    payload: { draftId: "d1" },
    resultPayload: null,
    createdAt: new Date(Date.now() - 10 * MIN),
    updatedAt: new Date(Date.now() - 5 * MIN),
    expiresAt: new Date(Date.now() + 60 * MIN),
    ...extra,
  };
  h.approvals.set(id, row);
  return { ...row };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.approvals.clear();
  h.attempts.clear();
  h.pending.clear();
  h.staleRead = null;
});

describe("approveApprovalRequest is a claim, not a check", () => {
  it("two approves that read the same pending row: one claims, the loser is CONFLICT and spawns nothing", async () => {
    const pendingRead = seed("a1", "pending_approval");
    await caller.approveApprovalRequest({ id: "a1" });
    // The executor claimed it in between.
    h.approvals.get("a1")!.status = "executing";

    h.staleRead = pendingRead;
    await expect(caller.approveApprovalRequest({ id: "a1" })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.approvals.get("a1")!.status).toBe("executing");
  });

  it("the swap's WHERE names id, status, the updatedAt read, and the expiry deadline", async () => {
    const read = seed("a2", "pending_approval");
    await caller.approveApprovalRequest({ id: "a2" });
    const where = vi.mocked(prisma.approvalRequest.updateMany).mock.calls[0][0]!.where as Row;
    expect(where.id).toBe("a2");
    expect(where.status).toBe("pending_approval");
    expect((where.updatedAt as Date).getTime()).toBe((read.updatedAt as Date).getTime());
    expect(((where.expiresAt as { gt: Date }).gt as Date).getTime()).toBeGreaterThan(Date.now() - 5_000);
    expect(prisma.approvalRequest.update).not.toHaveBeenCalled();
  });

  it("a losing approve does not rewrite the winner's in-memory args", async () => {
    const pendingRead = seed("a3", "pending_approval");
    h.pending.set("a3", { fn: () => undefined, args: [{ draftId: "d1" }] });
    await caller.approveApprovalRequest({ id: "a3" });

    h.staleRead = pendingRead;
    await expect(
      caller.approveApprovalRequest({ id: "a3", editedPayload: { draftId: "EDITED" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(h.pending.get("a3")!.args).toEqual([{ draftId: "d1" }]);
  });

  it("positive control: a pending approve lands approved, patches the edit, and spawns the executor once", async () => {
    seed("a4", "pending_approval");
    h.pending.set("a4", { fn: () => undefined, args: [{ draftId: "d1" }] });

    await expect(caller.approveApprovalRequest({ id: "a4", editedPayload: { draftId: "d2" } })).resolves.toEqual({ success: true });

    expect(h.approvals.get("a4")!.status).toBe("approved");
    expect(h.approvals.get("a4")!.payload).toEqual({ draftId: "d2" });
    expect(h.pending.get("a4")!.args).toEqual([{ draftId: "d2" }]);
    expect(h.spawn).toHaveBeenCalledWith("a4");
  });
});

describe("rejectApprovalRequest is a claim on pending_approval", () => {
  it("a reject on an executed row is CONFLICT and leaves executed + its result untouched", async () => {
    seed("r1", "executed", { resultPayload: { sent: true } });

    await expect(caller.rejectApprovalRequest({ id: "r1" })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(h.approvals.get("r1")!.status).toBe("executed");
    expect(h.approvals.get("r1")!.resultPayload).toEqual({ sent: true });
  });

  it("a reject that read pending while an approve landed is CONFLICT", async () => {
    const pendingRead = seed("r2", "pending_approval");
    await caller.approveApprovalRequest({ id: "r2" });

    h.staleRead = pendingRead;
    await expect(caller.rejectApprovalRequest({ id: "r2" })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(h.approvals.get("r2")!.status).toBe("approved");
  });

  it("positive control: a pending row (expired or not) rejects", async () => {
    seed("r3", "pending_approval", { expiresAt: new Date(Date.now() - MIN) });

    await expect(caller.rejectApprovalRequest({ id: "r3", reason: "no" })).resolves.toEqual({ success: true });

    expect(h.approvals.get("r3")!.status).toBe("rejected");
    expect(h.approvals.get("r3")!.resultPayload).toEqual({ error: "no" });
  });
});

describe("dismissApprovalReview settles the approval's own ledger attempt", () => {
  it("an EXECUTING approval:<id> attempt (the process stopped mid-dispatch) becomes UNKNOWN, not FAILED", async () => {
    seed("d1", "needs_review");
    h.attempts.set("att1", { id: "att1", operationKey: "approval:d1", state: "EXECUTING", reason: null });

    await caller.dismissApprovalReview({ id: "d1" });

    expect(h.approvals.get("d1")!.status).toBe("rejected");
    expect(h.attempts.get("att1")!.state).toBe("UNKNOWN");
    expect(String(h.attempts.get("att1")!.reason)).toMatch(/dismissed by op@statenour\.local/);
  });

  it("an UNKNOWN attempt keeps its state: a review is not a verdict on whether it ran", async () => {
    seed("d2", "needs_review");
    h.attempts.set("att2", { id: "att2", operationKey: "approval:d2", state: "UNKNOWN", reason: "socket hang up" });

    await caller.dismissApprovalReview({ id: "d2" });

    expect(h.attempts.get("att2")!.state).toBe("UNKNOWN");
    expect(h.attempts.get("att2")!.reason).toBe("socket hang up");
  });
});
