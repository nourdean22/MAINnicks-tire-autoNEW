/**
 * 08-F1: an approved tool must never auto-execute twice.
 *
 * Before: the executor's claim accepted `executing` rows older than 5 minutes,
 * and the approval sweeper re-selected them every 5 minutes. `executed` is only
 * written after the side effect, so a crash (or a slow tool) mid-effect left a
 * row the sweeper would run AGAIN (a second real SMS, a second Telegram).
 *
 * After:
 *   - only `approved` is claimable; a stale `executing` row becomes
 *     `needs_review` (the effect may or may not have happened; a human decides),
 *   - the dispatch is keyed by approvalId in the ActionAttempt ledger
 *     (`approval:<id>` through beginAttempt), so a prior attempt blocks a rerun
 *     even if the status row were ever re-armed.
 *
 * The stores below evaluate the real WHERE clauses (status, OR, lt/gt, unique
 * operationKey). A mock that returns canned `{ count }` values could not tell a
 * claim that admits stale rows from one that does not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const { store } = vi.hoisted(() => ({
  store: { approvals: new Map<string, Row>(), attempts: new Map<string, Row>(), attemptCreate: null as null | (() => void) },
}));

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "OR") {
      if (!(cond as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
      continue;
    }
    const v = row[k] as never;
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { lt?: Date; gt?: Date; in?: unknown[] };
      if (c.lt !== undefined && !(v < c.lt)) return false;
      if (c.gt !== undefined && !(v > c.gt)) return false;
      if (c.in !== undefined && !c.in.includes(v)) return false;
    } else if (cond instanceof Date ? (v as Date | null)?.getTime() !== cond.getTime() : v !== cond) {
      return false;
    }
  }
  return true;
}

function table(rows: () => Map<string, Row>) {
  const write = (row: Row, data: Row) => Object.assign(row, data, { updatedAt: new Date() });
  return {
    findUnique: async ({ where }: { where: Row }) => {
      const r = [...rows().values()].find((x) => matches(x, where));
      return r ? { ...r } : null;
    },
    findMany: async ({ where, take }: { where: Row; take?: number }) =>
      [...rows().values()].filter((x) => matches(x, where)).slice(0, take ?? Infinity).map((x) => ({ ...x })),
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
  };
}

vi.mock("@/lib/prisma", () => {
  const attempts = table(() => store.attempts);
  return {
    prisma: {
      approvalRequest: table(() => store.approvals),
      actionAttempt: {
        ...attempts,
        create: async ({ data }: { data: Row }) => {
          store.attemptCreate?.();
          if ([...store.attempts.values()].some((x) => x.operationKey === data.operationKey)) {
            throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
          }
          const id = `att_${store.attempts.size + 1}`;
          store.attempts.set(id, { id, ...data });
          return { id, attemptNo: data.attemptNo };
        },
      },
    },
  };
});

vi.mock("@/lib/ai/tools", () => ({ nourTools: {} }));
vi.mock("@/lib/system/capability-health", () => ({
  recordCapabilityFailure: vi.fn(async () => {}),
  recordCapabilityRecovery: vi.fn(async () => {}),
}));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));

import { executeApprovedToolAsync, withGuardian, pendingExecutions } from "@/lib/tools/guardian";
import { approvalSweeper } from "@/lib/inngest/functions/approval-sweeper";

const TOOL_ID = "test.approval_once";
const tool = vi.fn(async (_payload: unknown) => ({ sent: true }));
withGuardian(TOOL_ID, tool);

const MIN = 60_000;

function seedApproval(id: string, status: string, updatedAgoMs = 0) {
  const now = Date.now();
  store.approvals.set(id, {
    id,
    toolId: TOOL_ID,
    status,
    payload: { to: "customer", body: "hello" },
    createdAt: new Date(now - 10 * MIN),
    updatedAt: new Date(now - updatedAgoMs),
    expiresAt: new Date(now + 60 * MIN),
  });
}

async function runSweeper() {
  const step = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };
  return (approvalSweeper as unknown as { handler: (ctx: unknown) => Promise<unknown> }).handler({ step });
}

beforeEach(() => {
  store.approvals.clear();
  store.attempts.clear();
  store.attemptCreate = null;
  pendingExecutions.clear();
  tool.mockClear();
});

describe("a stale `executing` approval is never re-run", () => {
  it("the executor does not claim a row stuck in executing for 6 minutes: 0 tool invocations", async () => {
    seedApproval("req_stuck", "executing", 6 * MIN);

    await executeApprovedToolAsync("req_stuck");

    expect(tool).toHaveBeenCalledTimes(0);
  });

  it("the sweeper moves it to needs_review and invokes the tool 0 times", async () => {
    seedApproval("req_stuck", "executing", 6 * MIN);

    await runSweeper();

    expect(tool).toHaveBeenCalledTimes(0);
    expect(store.approvals.get("req_stuck")!.status).toBe("needs_review");
  });

  it("the sweeper leaves a fresh `executing` row alone (still in flight)", async () => {
    seedApproval("req_live", "executing", 1 * MIN);

    await runSweeper();

    expect(store.approvals.get("req_live")!.status).toBe("executing");
  });

  it("the sweeper still executes an `approved` row, once", async () => {
    seedApproval("req_ok", "approved");

    await runSweeper();
    await runSweeper();

    expect(tool).toHaveBeenCalledTimes(1);
    expect(store.approvals.get("req_ok")!.status).toBe("executed");
  });
});

describe("the durable executor is keyed by approvalId through beginAttempt", () => {
  it("records an action_attempts row `approval:<id>` settled after the effect", async () => {
    seedApproval("req_led", "approved");

    await executeApprovedToolAsync("req_led");

    const attempt = [...store.attempts.values()].find((a) => a.operationKey === "approval:req_led");
    expect(attempt?.state).toBe("SUCCEEDED_UNVERIFIED");
    expect(attempt?.tool).toBe(TOOL_ID);
  });

  it("a prior attempt for the same approvalId blocks a rerun: 0 invocations, needs_review", async () => {
    store.attempts.set("att_prior", {
      id: "att_prior",
      operationKey: "approval:req_dup",
      state: "EXECUTING",
      attemptNo: 1,
      holdUntil: new Date(Date.now() + 60 * MIN),
    });
    seedApproval("req_dup", "approved");

    await executeApprovedToolAsync("req_dup");

    expect(tool).toHaveBeenCalledTimes(0);
    expect(store.approvals.get("req_dup")!.status).toBe("needs_review");
  });

  it("an unwritable ledger does not drop the approval, and the status claim still stops a second run", async () => {
    store.attemptCreate = () => {
      throw new Error("Connection terminated unexpectedly");
    };
    seedApproval("req_nodb", "approved");

    await executeApprovedToolAsync("req_nodb");
    await executeApprovedToolAsync("req_nodb");

    expect(tool).toHaveBeenCalledTimes(1);
    expect(store.approvals.get("req_nodb")!.status).toBe("executed");
  });

  it("two concurrent calls on one approved row (double tap + sweeper) run the tool once", async () => {
    seedApproval("req_race", "approved");

    await Promise.all([executeApprovedToolAsync("req_race"), executeApprovedToolAsync("req_race")]);

    expect(tool).toHaveBeenCalledTimes(1);
  });
});
