/**
 * /system/crons never shows a phantom `duplicate` row as a run (P2-B2, 2026-10-10).
 *
 * Inngest fires onRunStart once per parallel-step request, so one run can open
 * extra `started` rows AFTER its real row; the reconciler relabels them
 * `duplicate` (lib/inngest/cron-lifecycle.ts reconcileInterruptedRuns). Being
 * newer than the real row, a phantom was shown as the job's last run (null
 * status, null duration), drawn as a 0 ms sparkline bar, and counted in
 * runs/24h.
 *
 * Same in-memory cron_job_logs fake as cron-deck-last-run.test.ts: it answers
 * Prisma calls by their arguments and throws on an operator it does not know.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type LogRow = { jobName: string; status: string; duration: number | null; createdAt: Date };
type Args = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Array<{ jobName: string; status: string; duration: number | null; createdAt: Date }>,
}));

vi.mock("@/lib/prisma", () => {
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  const match = (r: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([k, cond]) => {
      const v = r[k];
      if (cond === null || typeof cond !== "object" || cond instanceof Date) return same(v, cond);
      return Object.entries(cond as Record<string, unknown>).every(([op, x]) => {
        if (op === "in") return (x as unknown[]).some((y) => same(v, y));
        if (op === "gte") return (v as Date).getTime() >= (x as Date).getTime();
        throw new Error(`fake prisma: unsupported operator ${k}.${op}`);
      });
    });
  const read = (args: Args) => db.rows.filter((r) => match(r, args.where as Record<string, unknown>));
  const cronJobLog = {
    findMany: async (args: Args = {}) => {
      const out = [...read(args)].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return typeof args.take === "number" ? out.slice(0, args.take) : out;
    },
    groupBy: async (args: Args) => {
      const by = args.by as Array<keyof LogRow>;
      const groups = new Map<string, LogRow[]>();
      for (const r of read(args)) {
        const key = by.map((k) => String(r[k])).join("\u0000");
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].map((g) => ({
        ...Object.fromEntries(by.map((k) => [k, g[0][k]])),
        _count: { id: g.length, _all: g.length },
        _max: { createdAt: new Date(Math.max(...g.map((r) => r.createdAt.getTime()))) },
      }));
    },
  };
  return { prisma: { cronJobLog, brainMemory: { findMany: async () => [] } } };
});

import { buildCronCommandDeck } from "@/lib/services/system-pages";

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  db.rows = [];
});

describe("buildCronCommandDeck · a duplicate row is not a run", () => {
  it("a phantom newer than the real run is never the last run or a sparkline bar", async () => {
    const real = ago(6 * DAY);
    db.rows = [
      { jobName: "weekly-review", status: "success", duration: 1234, createdAt: real },
      // the same run knocking again 3 s later, relabelled by the reconciler
      { jobName: "weekly-review", status: "duplicate", duration: null, createdAt: new Date(real.getTime() + 3_000) },
    ];

    const row = (await buildCronCommandDeck()).rows.find((r) => r.name === "weekly-review")!;

    expect(row.lastRunAt).toBe(real.toISOString());
    expect(row.lastRunMs).toBe(1234);
    expect(row.lastStatus).toBe("success");
    expect(row.recentDurations).toEqual([1234]);
  });

  it("runs/24h counts real runs only, an in-flight one included", async () => {
    db.rows = [
      { jobName: "busy-poller", status: "started", duration: null, createdAt: ago(0) },
      { jobName: "busy-poller", status: "success", duration: 10, createdAt: ago(1 * HOUR) },
      { jobName: "busy-poller", status: "duplicate", duration: null, createdAt: ago(1 * HOUR - 1_000) },
      { jobName: "busy-poller", status: "failed", duration: 10, createdAt: ago(2 * HOUR) },
      { jobName: "busy-poller", status: "duplicate", duration: null, createdAt: ago(2 * HOUR - 1_000) },
    ];

    const { summary } = await buildCronCommandDeck();

    expect(summary.runs24h).toBe(3);
    expect(summary.failures24h).toBe(1);
  });
});
