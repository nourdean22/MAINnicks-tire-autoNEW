/**
 * W8b · the people engine's run marker is claimed BEFORE the run (claim-before-act), not written after it.
 *
 * Before: the chat path read "any people_intelligence_run in the last 6 h", ran, then wrote the row. Two chat turns
 * a second apart both read nothing and both ran (and burned the model calls twice). The nightly cron wrote no row at
 * all, so /people could not tell a dead engine from a quiet one.
 *
 * Now: one transaction takes the house advisory lock, reads the window, and creates the "running" row; the loser of
 * the race sees the winner's row and skips. The same row is updated with the result (ok / failed / nothing to
 * propose) when the run ends, or with the error when it throws, so a row is never left as a quiet "running" success.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lock: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = { $executeRaw: h.lock, auditEvent: { findFirst: h.findFirst, create: h.create } };
  return {
    prisma: {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      auditEvent: { update: h.update },
    },
  };
});
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { claimPeopleIntelligenceRun, runPeopleIntelligenceClaimed } from "@/lib/brain/people-intelligence-run";

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => {
  vi.clearAllMocks();
  h.lock.mockResolvedValue(1);
  h.create.mockResolvedValue({ id: "run1" });
  h.update.mockResolvedValue({});
});

describe("claimPeopleIntelligenceRun", () => {
  it("locks, reads the window, creates the running row: the predicate names the event type and the window", async () => {
    h.findFirst.mockResolvedValue(null);
    const before = Date.now();
    const r = await claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 });
    expect(r).toEqual({ claimed: true, runId: "run1" });
    expect(sqlOf(h.lock.mock.calls[0])).toMatch(/pg_advisory_xact_lock\(hashtext\(/);
    expect(h.lock.mock.calls[0][1]).toBe("people_intelligence_run");
    const where = h.findFirst.mock.calls[0][0].where;
    expect(where.eventType).toBe("people_intelligence_run");
    const gte = where.createdAt.gte as Date;
    expect(before - gte.getTime()).toBeGreaterThanOrEqual(6 * 3_600_000 - 1_000);
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      eventType: "people_intelligence_run",
      detail: "running",
      payload: { state: "running" },
    });
    // The lock is taken before the read: order is the whole point.
    expect(h.lock.mock.invocationCallOrder[0]).toBeLessThan(h.findFirst.mock.invocationCallOrder[0]);
  });

  it("a row inside the window: not claimed, nothing created, the winner's time reported", async () => {
    h.findFirst.mockResolvedValue({ id: "other", createdAt: new Date("2026-11-03T08:00:00Z") });
    const r = await claimPeopleIntelligenceRun({ windowMs: 6 * 3_600_000 });
    expect(r).toEqual({ claimed: false, lastRunAt: new Date("2026-11-03T08:00:00Z") });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("window 0 (the cron) always claims: no read of the window at all", async () => {
    const r = await claimPeopleIntelligenceRun({ windowMs: 0 });
    expect(r).toEqual({ claimed: true, runId: "run1" });
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("race: two callers, one runs and one skips", async () => {
    // Under the lock the second caller reads the first caller's row.
    h.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "run1", createdAt: new Date() });
    const [a, b] = await Promise.all([
      claimPeopleIntelligenceRun({ windowMs: 3_600_000 }),
      claimPeopleIntelligenceRun({ windowMs: 3_600_000 }),
    ]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});

describe("runPeopleIntelligenceClaimed", () => {
  it("skips without running when the window holds a run", async () => {
    h.findFirst.mockResolvedValue({ id: "x", createdAt: new Date() });
    const r = await runPeopleIntelligenceClaimed({ windowMs: 3_600_000, run: h.run });
    expect(r).toMatchObject({ skipped: "recent_run" });
    expect(h.run).not.toHaveBeenCalled();
  });

  it("records ok with the counts on the claimed row", async () => {
    h.findFirst.mockResolvedValue(null);
    h.run.mockResolvedValue({ profilesUpdated: 2, alerts: ["a"], cadenceProposed: 1, enrichDeferred: 3 });
    const r = await runPeopleIntelligenceClaimed({ windowMs: 3_600_000, run: h.run });
    expect(r).toMatchObject({ profilesUpdated: 2 });
    const upd = h.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "run1" });
    expect(upd.data.payload).toMatchObject({ state: "ok", profilesUpdated: 2, cadenceProposed: 1, enrichDeferred: 3, alerts: 1 });
    expect(upd.data.detail).toBe("Updated 2 profiles, 1 cadence proposed, 1 alerts, 3 enrich deferred");
  });

  it("a read failure inside the run is failed with its reason, even when something was written", async () => {
    h.findFirst.mockResolvedValue(null);
    h.run.mockResolvedValue({ profilesUpdated: 1, alerts: [], enrich: "chat_read_failed", cadenceProposed: 0 });
    await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run });
    expect(h.update.mock.calls[0][0].data.payload).toMatchObject({ state: "failed", reason: "chat_read_failed" });
    h.run.mockResolvedValue({ profilesUpdated: 0, alerts: [], cadence: "ledger_read_failed", cadenceProposed: 0 });
    await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run });
    expect(h.update.mock.calls[1][0].data.payload).toMatchObject({ state: "failed", reason: "ledger_read_failed" });
  });

  it("zero writes and no failure is nothing_to_propose, not ok", async () => {
    h.findFirst.mockResolvedValue(null);
    h.run.mockResolvedValue({ profilesUpdated: 0, alerts: [], cadenceProposed: 0 });
    await runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run });
    expect(h.update.mock.calls[0][0].data.payload).toMatchObject({ state: "nothing_to_propose" });
  });

  it("a thrown run is recorded failed on the row and rethrown: never a quiet running row", async () => {
    h.findFirst.mockResolvedValue(null);
    h.run.mockRejectedValue(new Error("boom"));
    await expect(runPeopleIntelligenceClaimed({ windowMs: 0, run: h.run })).rejects.toThrow("boom");
    expect(h.update.mock.calls[0][0].data.payload).toMatchObject({ state: "failed", reason: "boom" });
  });
});
