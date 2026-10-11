/**
 * A decision claim that never finished leaves `processing` (audit 2026-10-10,
 * hostile review of SN-04).
 *
 * THE DEFECT: decidePendingAction claims pending -> processing, then replays
 * the side effect and writes the verdict. A throw or a process death after the
 * claim left the row `processing` forever: every reader filters
 * approval="pending", so the row vanished from /system/actions and the Owner
 * Panel, was never executed, rejected, or purged, and nothing said so.
 *
 * Pinned: the claim stamps who decided what, and when (approvedBy, no schema
 * change). The approval sweeper's recoverStuckDecisions finishes what it can
 * prove (a reject ran nothing; an approve whose replay wrote executedAt after
 * the claim finished) and moves the rest to `needs_review`, recorded UNKNOWN in
 * action_attempts so the Owner Panel lists it. It never returns a row to
 * pending and never re-runs the side effect; a fresh claim is left alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  actions: new Map<string, Record<string, unknown>>(),
  attempts: new Map<string, Record<string, unknown>>(),
  approvalHistory: [] as string[],
  failFinalUpdate: false,
  executeApprovedAction: vi.fn(async (_id: string) => ({ ok: true, result: "sent" })),
}));

vi.mock("@/lib/prisma", () => {
  const eq = (row: Row, where: Row) =>
    Object.entries(where).every(([k, v]) => (v instanceof Date ? (row[k] as Date)?.getTime() === v.getTime() : row[k] === v));
  const record = (data: Row) => {
    if (typeof data.approval === "string") h.approvalHistory.push(data.approval);
  };
  return {
    prisma: {
      autonomousAction: {
        findMany: vi.fn(async ({ where }: { where: Row }) => [...h.actions.values()].filter((r) => eq(r, where)).map((r) => ({ ...r }))),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const r = h.actions.get(where.id);
          return r ? { ...r } : null;
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
          const r = h.actions.get(where.id as string);
          if (!r || !eq(r, where)) return { count: 0 };
          record(data);
          Object.assign(r, data);
          return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          if (h.failFinalUpdate) throw new Error("Connection terminated unexpectedly");
          const r = h.actions.get(where.id)!;
          record(data);
          Object.assign(r, data);
          return { ...r };
        }),
      },
      automationPolicy: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
      approvalRequest: { updateMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn(async () => []) },
      actionAttempt: {
        create: vi.fn(async ({ data }: { data: Row }) => {
          if (h.attempts.has(data.operationKey as string)) throw Object.assign(new Error("Unique"), { code: "P2002" });
          const row = { id: `att_${h.attempts.size + 1}`, ...data };
          h.attempts.set(data.operationKey as string, row);
          return { id: row.id, attemptNo: row.attemptNo };
        }),
        findUnique: vi.fn(async ({ where }: { where: { id?: string; operationKey?: string } }) => {
          const r = [...h.attempts.values()].find((x) => (where.id ? x.id === where.id : x.operationKey === where.operationKey));
          return r ? { ...r } : null;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          const r = [...h.attempts.values()].find((x) => x.id === where.id)!;
          Object.assign(r, data);
          return { ...r };
        }),
      },
    },
  };
});
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/brain/autonomous-engine", () => ({ executeApprovedAction: h.executeApprovedAction }));
vi.mock("@/lib/automation/policy", () => ({ getPolicy: vi.fn(async () => null) }));
vi.mock("@/lib/tools/guardian", () => ({ executeApprovedToolAsync: vi.fn() }));
vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));

import { decidePendingAction, recoverStuckDecisions } from "@/lib/automation/approval-queue";
import { approvalSweeper } from "@/lib/inngest/functions/approval-sweeper";
import { prisma } from "@/lib/prisma";

const MIN = 60_000;
const RULE = "auto_followup_expired_quote";

function seed(id: string, over: Row = {}) {
  h.actions.set(id, {
    id,
    ruleName: RULE,
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
    createdAt: new Date(Date.now() - 60 * MIN),
    ...over,
  });
}

const stamp = (claim: string, by: string, at: Date) => JSON.stringify({ claim, by, at: at.toISOString() });
const ledger = (id: string) => h.attempts.get(`autonomous-action:${id}`);

beforeEach(() => {
  vi.clearAllMocks();
  h.actions.clear();
  h.attempts.clear();
  h.approvalHistory.length = 0;
  h.failFinalUpdate = false;
});

describe("a decision that died after its claim is recovered, never re-run", () => {
  it("an approve whose final write failed: left alone while fresh, then needs_review + an UNKNOWN ledger row", async () => {
    seed("a1");
    h.failFinalUpdate = true;
    await expect(decidePendingAction("a1", "approved", "nour")).rejects.toThrow(/Connection terminated/);
    expect(h.actions.get("a1")!.approval).toBe("processing");

    // Five minutes later the replay could still be in flight.
    expect(await recoverStuckDecisions(new Date(Date.now() + 5 * MIN))).toEqual({ finished: 0, needsReview: 0 });
    expect(h.actions.get("a1")!.approval).toBe("processing");

    const out = await recoverStuckDecisions(new Date(Date.now() + 20 * MIN));

    expect(out).toEqual({ finished: 0, needsReview: 1 });
    const row = h.actions.get("a1")!;
    expect(row.approval).toBe("needs_review");
    expect(row.approvedBy).toBe("nour");
    expect(String(row.error)).toMatch(/send_email may or may not have run/);
    expect(ledger("a1")).toMatchObject({ state: "UNKNOWN", tool: `autonomous.${RULE}` });
    expect(h.executeApprovedAction).toHaveBeenCalledTimes(1);
    expect(h.approvalHistory).not.toContain("pending");
  });

  it("an approve whose replay recorded executedAt after the claim is finished as approved", async () => {
    const claimedAt = new Date(Date.now() - 30 * MIN);
    seed("a2", { approval: "processing", approvedBy: stamp("approved", "nour", claimedAt), executedAt: new Date(claimedAt.getTime() + 2_000) });

    expect(await recoverStuckDecisions()).toEqual({ finished: 1, needsReview: 0 });

    expect(h.actions.get("a2")).toMatchObject({ approval: "approved", approvedBy: "nour" });
    expect(ledger("a2")).toBeUndefined();
  });

  it("an executedAt from BEFORE the claim proves nothing: needs_review", async () => {
    const claimedAt = new Date(Date.now() - 30 * MIN);
    seed("a3", { approval: "processing", approvedBy: stamp("approved", "nour", claimedAt), executedAt: new Date(claimedAt.getTime() - 3_600_000) });

    expect(await recoverStuckDecisions()).toEqual({ finished: 0, needsReview: 1 });
    expect(h.actions.get("a3")!.approval).toBe("needs_review");
  });

  it("a replay that lands between the read and the swap wins: no needs_review, no ledger row", async () => {
    seed("race1", { approval: "processing", approvedBy: stamp("approved", "nour", new Date(Date.now() - 30 * MIN)) });
    const staleRead = { ...h.actions.get("race1")! };
    h.actions.get("race1")!.executedAt = new Date(); // the replay finished after our read
    vi.mocked(prisma.autonomousAction.findMany).mockResolvedValueOnce([staleRead] as never);

    expect(await recoverStuckDecisions()).toEqual({ finished: 0, needsReview: 0 });

    expect(h.actions.get("race1")!.approval).toBe("processing");
    expect(ledger("race1")).toBeUndefined();
  });

  it("a stuck reject ran nothing: finished as rejected, no ledger row", async () => {
    seed("r1", { approval: "processing", approvedBy: stamp("rejected", "nour", new Date(Date.now() - 30 * MIN)) });

    expect(await recoverStuckDecisions()).toEqual({ finished: 1, needsReview: 0 });

    expect(h.actions.get("r1")).toMatchObject({ approval: "rejected", approvedBy: "nour" });
    expect(ledger("r1")).toBeUndefined();
    expect(h.executeApprovedAction).not.toHaveBeenCalled();
  });

  it("a claim with no stamp (written before the stamp existed): decision unknown, needs_review", async () => {
    seed("l1", { approval: "processing", approvedBy: null });

    expect(await recoverStuckDecisions()).toEqual({ finished: 0, needsReview: 1 });
    expect(h.actions.get("l1")!.approval).toBe("needs_review");
  });

  it("positive control: a decision that finished is not touched (only processing rows are read)", async () => {
    seed("ok1");
    await decidePendingAction("ok1", "approved", "nour");

    expect(await recoverStuckDecisions(new Date(Date.now() + 60 * MIN))).toEqual({ finished: 0, needsReview: 0 });
    expect(h.actions.get("ok1")).toMatchObject({ approval: "approved", approvedBy: "nour" });
  });
});

describe("the approval sweeper runs the recovery", () => {
  it("a stuck processing row reaches needs_review on a sweeper tick", async () => {
    seed("s1", { approval: "processing", approvedBy: stamp("approved", "nour", new Date(Date.now() - 30 * MIN)) });
    const step = { run: async (_name: string, fn: () => Promise<unknown>) => fn() };

    const out = (await (approvalSweeper as unknown as { handler: (ctx: unknown) => Promise<Row> }).handler({ step })) as Row;

    expect(h.actions.get("s1")!.approval).toBe("needs_review");
    expect(out.stuckDecisions).toEqual({ finished: 0, needsReview: 1 });
  });
});
