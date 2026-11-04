/**
 * W8b · the people engine claims its run BEFORE the run (claim-before-act), one run at a time for every caller.
 *
 * Before: the chat path read the window, ran, then wrote the row, and the nightly cron wrote no row at all. Then
 * (manager round 1, items 4 + 16) the cron passed window 0, which checked nothing, and pg_advisory_xact_lock is
 * released at the claim transaction's commit, so it covered the insert and not the run. A test scripted with
 * mockResolvedValueOnce passed without the lock.
 *
 * Now the claim refuses while a fresh "running" row exists, whatever the window; a stale one (the process died) is
 * closed by a compare-and-swap and replaced. These tests run against a fake store that ENFORCES the rule: claims
 * queue one at a time like the lock does, and the second claim reads the first one's row.
 *
 * The row is updated with the result (ok / failed / nothing to propose) when the run ends, or with the error when it
 * throws, so a row is never left as a quiet "running" success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; eventType: string; detail: string; createdAt: Date; payload: unknown };
const h = vi.hoisted(() => {
  const rows: Row[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const newest = (where: { eventType: string }) =>
    rows.filter((r) => r.eventType === where.eventType).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const tx = {
    $executeRaw: vi.fn(async (..._args: unknown[]) => 1),
    auditEvent: {
      findFirst: vi.fn(async ({ where }: { where: { eventType: string } }) => newest(where)),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        const row = { ...data, id: `run${rows.length + 1}`, createdAt: new Date() };
        rows.push(row);
        return { id: row.id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; detail: string; createdAt: Date }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id && r.detail === where.detail && r.createdAt.getTime() === where.createdAt.getTime());
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
  return {
    rows,
    tx,
    // One transaction at a time, the way the advisory lock orders them.
    transaction: (fn: (t: typeof tx) => Promise<unknown>): Promise<unknown> => {
      const next = queue.then(() => fn(tx));
      queue = next.catch(() => undefined);
      return next;
    },
    update: vi.fn(),
    logError: vi.fn(),
    run: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: (fn: never) => h.transaction(fn), auditEvent: { update: h.update } },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: h.logError }));

import { PEOPLE_RUN_STALE_MS, claimPeopleIntelligenceRun, runPeopleIntelligenceClaimed } from "@/lib/brain/people-intelligence-run";

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");
const seed = (detail: string, ageMs: number, id = "old") => {
  const row = { id, eventType: "people_intelligence_run", detail, createdAt: new Date(Date.now() - ageMs), payload: {} };
  h.rows.push(row);
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.length = 0;
  h.update.mockResolvedValue({});
});

describe("claimPeopleIntelligenceRun", () => {
  it("locks before it reads, then creates the running row", async () => {
    const r = await claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 });
    expect(r).toEqual({ claimed: true, runId: "run1" });
    expect(sqlOf(h.tx.$executeRaw.mock.calls[0])).toMatch(/pg_advisory_xact_lock\(hashtext\(/);
    expect(h.tx.$executeRaw.mock.calls[0][1]).toBe("people_intelligence_run");
    expect(h.tx.auditEvent.create.mock.calls[0][0].data).toMatchObject({ eventType: "people_intelligence_run", detail: "running", payload: { state: "running" } });
    expect(h.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(h.tx.auditEvent.findFirst.mock.invocationCallOrder[0]);
  });

  it("a finished run inside the window: not claimed, recent_run, the time reported", async () => {
    const prior = seed("Updated 1 profiles", 3_600_000);
    const r = await claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 });
    expect(r).toEqual({ claimed: false, reason: "recent_run", lastRunAt: prior.createdAt });
    expect(h.rows).toHaveLength(1);
  });

  it("a finished run outside the window, or window 0: claimed", async () => {
    seed("Updated 1 profiles", 7 * 3_600_000);
    expect((await claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 })).claimed).toBe(true);
    h.rows.length = 0;
    seed("Updated 1 profiles", 1_000);
    expect((await claimPeopleIntelligenceRun({ windowMs: 0 })).claimed).toBe(true);
  });

  it("two concurrent claims with window 0 (the cron): one runs, one is refused with a reason", async () => {
    const [a, b] = await Promise.all([claimPeopleIntelligenceRun({ windowMs: 0 }), claimPeopleIntelligenceRun({ windowMs: 0 })]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);
    expect([a, b].find((c) => !c.claimed)).toMatchObject({ reason: "running" });
    expect(h.rows).toHaveLength(1);
  });

  it("a fresh running row refuses every caller, whatever its window", async () => {
    seed("running", 60_000);
    expect(await claimPeopleIntelligenceRun({ windowMs: 0 })).toMatchObject({ claimed: false, reason: "running" });
    expect(await claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 })).toMatchObject({ claimed: false, reason: "running" });
    expect(h.rows).toHaveLength(1);
  });

  it("a stale running row is closed by a compare-and-swap on id, detail and createdAt, and retaken once", async () => {
    const stale = seed("running", PEOPLE_RUN_STALE_MS + 60_000);
    const [a, b] = await Promise.all([claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 }), claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 })]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);
    expect(h.tx.auditEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(h.tx.auditEvent.updateMany.mock.calls[0][0].where).toEqual({ id: stale.id, detail: "running", createdAt: stale.createdAt });
    expect(stale.detail).toBe("failed");
    expect(stale.payload).toMatchObject({ state: "failed", reason: "did not finish" });
    expect(h.rows).toHaveLength(2);
  });

  it("a lost swap on the stale row refuses: it never runs beside the winner", async () => {
    seed("running", PEOPLE_RUN_STALE_MS + 60_000);
    h.tx.auditEvent.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await claimPeopleIntelligenceRun({ windowMs: 0 })).toMatchObject({ claimed: false, reason: "running" });
    expect(h.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe("runPeopleIntelligenceClaimed", () => {
  it("skips with the claim's reason: never runs while the window holds a run, or while another run is running", async () => {
    seed("Updated 1 profiles", 1_000);
    expect(await runPeopleIntelligenceClaimed({ windowMs: 3_600_000, run: h.run })).toMatchObject({ skipped: "recent_run" });
    h.rows.length = 0;
    seed("running", 1_000);
    expect(await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run })).toMatchObject({ skipped: "running" });
    expect(h.run).not.toHaveBeenCalled();
  });

  it("records ok with the counts on the claimed row", async () => {
    h.run.mockResolvedValue({ profilesUpdated: 2, alerts: ["a"], cadenceProposed: 1, enrichDeferred: 3 });
    const r = await runPeopleIntelligenceClaimed({ windowMs: 3_600_000, run: h.run });
    expect(r).toMatchObject({ profilesUpdated: 2 });
    const upd = h.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "run1" });
    expect(upd.data.payload).toMatchObject({ state: "ok", profilesUpdated: 2, cadenceProposed: 1, enrichDeferred: 3, alerts: 1 });
    expect(upd.data.detail).toBe("Updated 2 profiles, 1 cadence proposed, 1 alerts, 3 enrich deferred");
  });

  it("a read failure inside the run is failed with its reason, even when something was written", async () => {
    h.run.mockResolvedValue({ profilesUpdated: 1, alerts: [], enrich: "chat_read_failed", cadenceProposed: 0 });
    await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run });
    expect(h.update.mock.calls[0][0].data.payload).toMatchObject({ state: "failed", reason: "chat_read_failed" });
    h.rows.length = 0;
    h.run.mockResolvedValue({ profilesUpdated: 0, alerts: [], cadence: "ledger_read_failed", cadenceProposed: 0 });
    await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run });
    expect(h.update.mock.calls[1][0].data.payload).toMatchObject({ state: "failed", reason: "ledger_read_failed" });
  });

  it("zero writes and no failure is nothing_to_propose, not ok", async () => {
    h.run.mockResolvedValue({ profilesUpdated: 0, alerts: [], cadenceProposed: 0 });
    await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run });
    expect(h.update.mock.calls[0][0].data.payload).toMatchObject({ state: "nothing_to_propose" });
  });

  it("a thrown run is recorded failed on the row and rethrown: never a quiet running row", async () => {
    h.run.mockRejectedValue(new Error("boom"));
    await expect(runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run })).rejects.toThrow("boom");
    expect(h.update.mock.calls[0][0].data.payload).toMatchObject({ state: "failed", reason: "boom" });
  });

  // Item 14: the row is bookkeeping. A failed settle is logged and never replaces the result or the run's own error.
  it("a failed settle is logged, and a good run still returns its result", async () => {
    h.update.mockRejectedValue(new Error("db down"));
    h.run.mockResolvedValue({ profilesUpdated: 1, alerts: [], cadenceProposed: 0 });
    await expect(runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run })).resolves.toMatchObject({ profilesUpdated: 1 });
    expect(h.logError).toHaveBeenCalledWith("brain.people-intelligence", expect.any(Error), { fn: "runPeopleIntelligenceClaimed.settle" });
  });

  it("a thrown run rethrows its own error when the settle fails too", async () => {
    h.update.mockRejectedValue(new Error("db down"));
    h.run.mockRejectedValue(new Error("boom"));
    await expect(runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run })).rejects.toThrow("boom");
    expect(h.logError).toHaveBeenCalledTimes(1);
  });
});
