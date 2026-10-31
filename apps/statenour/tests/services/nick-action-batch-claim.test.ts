/**
 * The Nick action batch core claims each row by compare-and-swap before it acts
 * (skill: claim-before-act). Two callers can hold the same stale read of a row (the in-app
 * Approve's in-place fallback from #3437 and a late `nick-action/approved` event, or the event
 * and the 09:00Z cron): exactly one may run it.
 *
 * The store here is stateful, so the race is real: both callers read the row as unexecuted, then
 * both try the swap; the second swap matches nothing. A claim by id alone (findFirst then update),
 * or a predicate without executedAt, lets both run.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; ruleName: string; actionType: string; targetType: string; targetId: string; payload: unknown; approval: string; executedAt: Date | null; createdAt: Date };

const h = vi.hoisted(() => {
  const rows = new Map<string, Row>();
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v);
  let releaseRead: () => void = () => {};
  const readGate = { wait: Promise.resolve() as Promise<void> };
  const autonomousAction = {
    // Both callers take the same snapshot before either claims (the stale read).
    findMany: vi.fn(async () => {
      const snap = [...rows.values()].filter((r) => r.approval === "approved" && r.executedAt === null).map((r) => ({ ...r }));
      await readGate.wait;
      return snap;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const r = rows.get(where.id as string);
      if (!r || !matches(r, where)) return { count: 0 };
      Object.assign(r, data);
      return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
      const r = rows.get(where.id)!;
      Object.assign(r, data);
      return { ...r };
    }),
    findUnique: vi.fn(async () => null),
  };
  const executeNickAction = vi.fn(async () => ({ ok: true, summary: "done" }));
  return {
    rows, autonomousAction, executeNickAction, readGate,
    hold: () => { readGate.wait = new Promise<void>((r) => { releaseRead = r; }); },
    release: () => releaseRead(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: { autonomousAction: h.autonomousAction } }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn(async () => true) }));
vi.mock("@/lib/ai/execute-actions", () => ({ executeNickAction: h.executeNickAction }));

import { runNickActionBatch } from "@/lib/ai/nick-action-batch";

function seed(id: string, approval = "approved") {
  h.rows.set(id, { id, ruleName: "nick_action_nudge_task", actionType: "nudge_task", targetType: "task", targetId: "T1", payload: {}, approval, executedAt: null, createdAt: new Date() });
}

beforeEach(() => {
  h.rows.clear();
  h.executeNickAction.mockClear();
  h.autonomousAction.updateMany.mockClear();
});

describe("runNickActionBatch · claim before act", () => {
  it("two callers sharing one stale read run the row exactly once", async () => {
    seed("a1");
    h.hold();
    const first = runNickActionBatch({ ids: ["a1"], source: "approval-queue-fallback" });
    const second = runNickActionBatch({ ids: ["a1"], source: "event" });
    h.release();
    const [x, y] = await Promise.all([first, second]);
    expect(h.executeNickAction).toHaveBeenCalledTimes(1);
    expect(x.executed + y.executed).toBe(1);
    expect(x.skipped + y.skipped).toBe(1);
  });

  it("the swap names every field the selection read: id, executedAt null, approval approved", async () => {
    seed("a2");
    await runNickActionBatch({ ids: ["a2"], source: "event" });
    expect(h.autonomousAction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a2", executedAt: null, approval: "approved" } }),
    );
  });

  it("a row rejected after the read is not run", async () => {
    seed("a3");
    h.hold();
    const run = runNickActionBatch({ ids: ["a3"], source: "event" });
    await Promise.resolve();
    h.rows.get("a3")!.approval = "rejected";
    h.release();
    await run;
    expect(h.executeNickAction).not.toHaveBeenCalled();
  });
});
