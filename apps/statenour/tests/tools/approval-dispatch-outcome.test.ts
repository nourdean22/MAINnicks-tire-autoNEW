/**
 * An approved tool's dispatch outcome reads the same in both records (audit
 * 2026-10-10, hostile review of wave 1).
 *
 * THE DEFECT: every dispatch throw settled the `approval:<id>` ledger attempt
 * UNKNOWN (classifyError: () => "unknown", "it may have committed") while the
 * catch wrote the approval row `failed`. The Owner Panel listed "approved X
 * failed" and hid the ledger's "outcome unknown" behind it: the operator was
 * told a send failed when the ledger said it may have gone out.
 *
 * Pinned: one classifier decides both writes. A throw after the tool may have
 * been reached is UNKNOWN in the ledger and `needs_review` on the approval
 * ("may have run"); a failure that provably ran nothing (the dispatcher has no
 * handler for the tool, or the circuit breaker fast-failed) is FAILED and
 * `failed`. A `needs_review` row also blocks an identical re-raise for 24 h,
 * the way `failed` did, so the relabel opens no second run.
 *
 * The store evaluates the real WHERE clauses (status, in/gt/gte, unique
 * operationKey), the same fake as approval-execution-once.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { store } = vi.hoisted(() => ({
  store: { approvals: new Map<string, Row>(), attempts: new Map<string, Row>() },
}));

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k] as never;
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { lt?: Date; gt?: Date; gte?: Date; in?: unknown[] };
      if (c.lt !== undefined && !(v < c.lt)) return false;
      if (c.gt !== undefined && !(v > c.gt)) return false;
      if (c.gte !== undefined && !(v >= c.gte)) return false;
      if (c.in !== undefined && !c.in.includes(v)) return false;
    } else if (cond instanceof Date ? (v as Date | null)?.getTime() !== cond.getTime() : v !== cond) {
      return false;
    }
  }
  return true;
}

function table(rows: () => Map<string, Row>, prefix: string) {
  const write = (row: Row, data: Row) => Object.assign(row, data, { updatedAt: new Date() });
  return {
    findUnique: async ({ where }: { where: Row }) => {
      const r = [...rows().values()].find((x) => matches(x, where));
      return r ? { ...r } : null;
    },
    findFirst: async ({ where }: { where: Row }) => {
      const hit = [...rows().values()]
        .filter((x) => matches(x, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return hit[0] ? { ...hit[0] } : null;
    },
    findMany: async ({ where, take }: { where: Row; take?: number }) =>
      [...rows().values()]
        .filter((x) => matches(x, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
        .slice(0, take ?? Infinity)
        .map((x) => ({ ...x })),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = [...rows().values()].filter((x) => matches(x, where));
      hit.forEach((x) => write(x, data));
      return { count: hit.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const r = rows().get(where.id);
      if (!r) throw Object.assign(new Error("not found"), { code: "P2025" });
      return { ...write(r, data) };
    },
    create: async ({ data }: { data: Row }) => {
      if (prefix === "att" && [...rows().values()].some((x) => x.operationKey === data.operationKey)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const id = `${prefix}_${rows().size + 1}`;
      const row = { id, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows().set(id, row);
      return { ...row };
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    approvalRequest: table(() => store.approvals, "req"),
    actionAttempt: table(() => store.attempts, "att"),
  },
}));
vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({ decision: "require_approval", riskClass: "medium", reason: "test gate" }),
}));
vi.mock("@/lib/ai/tools", () => ({ nourTools: {} }));
vi.mock("@/lib/system/capability-health", () => ({
  recordCapabilityFailure: vi.fn(async () => {}),
  recordCapabilityRecovery: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/nick-agent", () => ({
  executeActionWithoutTracing: vi.fn(async (action: { type: string }) => ({
    action: action.type,
    success: false,
    error: `Unknown action type: ${action.type}`,
  })),
}));

import { __resetGuardianBreakers, executeApprovedToolAsync, pendingExecutions, withGuardian } from "@/lib/tools/guardian";

const MIN = 60_000;

function seedApproval(id: string, toolId: string, status = "approved", payload: unknown = { to: "customer", body: "hi" }) {
  const now = Date.now();
  store.approvals.set(id, {
    id,
    toolId,
    status,
    payload,
    createdAt: new Date(now - 10 * MIN),
    updatedAt: new Date(now - 10 * MIN),
    expiresAt: new Date(now + 60 * MIN),
  });
}

const attempt = (id: string) => [...store.attempts.values()].find((a) => a.operationKey === `approval:${id}`);

beforeEach(() => {
  store.approvals.clear();
  store.attempts.clear();
  pendingExecutions.clear();
  __resetGuardianBreakers();
});

describe("a dispatch throw reads the same in the ledger and on the approval", () => {
  it("a throw after the tool was reached: ledger UNKNOWN and approval needs_review (may have run)", async () => {
    const tool = vi.fn(async () => {
      throw new Error("socket hang up after the provider accepted the request");
    });
    withGuardian("test.dispatch_throws", tool, { maxRetries: 0 });
    seedApproval("req_throw", "test.dispatch_throws");

    await executeApprovedToolAsync("req_throw");

    expect(tool).toHaveBeenCalledTimes(1);
    expect(attempt("req_throw")?.state).toBe("UNKNOWN");
    expect(store.approvals.get("req_throw")!.status).toBe("needs_review");
    expect(String((store.approvals.get("req_throw")!.resultPayload as { error?: string }).error)).toMatch(/socket hang up/);
  });

  it("no handler anywhere for the tool (the dispatcher's unknown-action default): ledger FAILED and approval failed", async () => {
    seedApproval("req_orphan", "tool.never_registered");

    await executeApprovedToolAsync("req_orphan");

    expect(attempt("req_orphan")?.state).toBe("FAILED");
    expect(store.approvals.get("req_orphan")!.status).toBe("failed");
  });

  it("an open circuit fast-fails before the tool runs: ledger FAILED and approval failed", async () => {
    const tool = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    withGuardian("test.dispatch_breaker", tool, { maxRetries: 0, breakerThreshold: 1, breakerCooldownMs: 60 * MIN });
    seedApproval("req_trip", "test.dispatch_breaker", "approved", { n: 1 });
    seedApproval("req_open", "test.dispatch_breaker", "approved", { n: 2 });

    await executeApprovedToolAsync("req_trip");
    await executeApprovedToolAsync("req_open");

    // The first call reached the backend (network error: may have committed).
    expect(store.approvals.get("req_trip")!.status).toBe("needs_review");
    expect(attempt("req_trip")?.state).toBe("UNKNOWN");
    // The second never called the tool.
    expect(tool).toHaveBeenCalledTimes(1);
    expect(store.approvals.get("req_open")!.status).toBe("failed");
    expect(attempt("req_open")?.state).toBe("FAILED");
  });

  it("positive control: a tool that returns lands executed and SUCCEEDED_UNVERIFIED", async () => {
    withGuardian("test.dispatch_ok", vi.fn(async () => ({ sent: true })));
    seedApproval("req_ok", "test.dispatch_ok");

    await executeApprovedToolAsync("req_ok");

    expect(store.approvals.get("req_ok")!.status).toBe("executed");
    expect(attempt("req_ok")?.state).toBe("SUCCEEDED_UNVERIFIED");
  });
});

describe("a needs_review approval still blocks an identical re-raise", () => {
  it("re-raising the same payload within 24 h is refused, and no new approval is created", async () => {
    const tool = vi.fn(async () => ({ sent: true }));
    const guarded = withGuardian("test.reraise", tool);
    seedApproval("req_review", "test.reraise", "needs_review", { to: "customer", body: "hi" });

    await expect(guarded({ to: "customer", body: "hi" } as never)).rejects.toThrow(/may already have run/);

    expect(store.approvals.size).toBe(1);
    expect(tool).not.toHaveBeenCalled();
  });

  it("control: a different payload still raises a fresh approval", async () => {
    const guarded = withGuardian("test.reraise_other", vi.fn(async () => ({ sent: true })));
    seedApproval("req_review2", "test.reraise_other", "needs_review", { to: "customer", body: "hi" });

    await expect(guarded({ to: "customer", body: "a different message" } as never)).rejects.toThrow(/Approval pending/);

    expect(store.approvals.size).toBe(2);
  });
});
