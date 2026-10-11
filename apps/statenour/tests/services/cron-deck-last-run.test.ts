/**
 * /system/crons must show each job's REAL last run and REAL 24h counts
 * (audit 14-live-crons items 1, 2026-10-10).
 *
 * THE DEFECT. buildCronCommandDeck read `lastRunAt` from ONE 800-row sample
 * across every job. Prod writes ~796 rows a day, so the sample covered ~24h
 * and every weekly job read "last never". runs/24h and failures/24h were
 * counted from the same capped sample ("796" was a lower bound, and a failure
 * older than the 800th row vanished). getCronStats had the same shape:
 * lastSuccessAt / lastFailAt came from `take: jobNames.length * 4` across all
 * jobs, so a high-frequency job crowded every low-frequency one out.
 *
 * The fake below is a tiny in-memory cron_job_logs table that answers the
 * Prisma calls by their arguments, so these tests pin what the deck SHOWS for
 * a given table, not which queries produce it. An unsupported operator throws:
 * a fake that silently ignored a filter could make a wrong query look right.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type LogRow = { jobName: string; status: string; duration: number | null; createdAt: Date };
type Args = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Array<{ jobName: string; status: string; duration: number | null; createdAt: Date }>,
  calls: 0,
  failAt: -1,
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
  const read = (args: Args) => {
    const n = db.calls++;
    if (n === db.failAt) throw new Error("db down");
    return db.rows.filter((r) => match(r, args.where as Record<string, unknown>));
  };
  const cronJobLog = {
    findMany: async (args: Args = {}) => {
      let out = read(args);
      if (args.orderBy) {
        const order = args.orderBy as Record<string, string>;
        if (Object.keys(order).join() !== "createdAt") throw new Error("fake prisma: orderBy createdAt only");
        const dir = order.createdAt === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()));
      }
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
    count: async (args: Args = {}) => read(args).length,
  };
  return { prisma: { cronJobLog, brainMemory: { findMany: async () => [] } } };
});

import { buildCronCommandDeck } from "@/lib/services/system-pages";
import { getCronStats } from "@/lib/services/cron-control";

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** 900 rows of one busy job inside the last 24h: more than the old 800-row sample. */
function busyDay(): LogRow[] {
  return Array.from({ length: 900 }, (_, i) => ({
    jobName: "busy-poller",
    status: "success",
    duration: 10,
    createdAt: ago(i * 90_000), // 0 .. 22.5h ago
  }));
}

beforeEach(() => {
  db.rows = [];
  db.calls = 0;
  db.failAt = -1;
});

describe("buildCronCommandDeck · per-job last run", () => {
  it("a weekly job whose only recent run is 6 days old shows that run, not 'never'", async () => {
    const sixDays = ago(6 * DAY);
    db.rows = [
      ...busyDay(),
      { jobName: "weekly-review", status: "success", duration: 1234, createdAt: sixDays },
      { jobName: "weekly-review", status: "failed", duration: 99, createdAt: ago(13 * DAY) },
    ];

    const deck = await buildCronCommandDeck();
    const row = deck.rows.find((r) => r.name === "weekly-review")!;

    expect(row.lastRunAt).toBe(sixDays.toISOString());
    expect(row.lastRunMs).toBe(1234);
    expect(row.lastStatus).toBe("success");
  });

  it("an in-flight newest row is the last run, unclassified, never 'failed'", async () => {
    const started = ago(2 * DAY);
    db.rows = [
      ...busyDay(),
      { jobName: "weekly-review", status: "success", duration: 5, createdAt: ago(9 * DAY) },
      { jobName: "weekly-review", status: "started", duration: null, createdAt: started },
    ];

    const row = (await buildCronCommandDeck()).rows.find((r) => r.name === "weekly-review")!;

    expect(row.lastRunAt).toBe(started.toISOString());
    expect(row.lastStatus).toBeNull();
  });
});

describe("buildCronCommandDeck · 24h header counts", () => {
  it("runs/24h and failures/24h are counts over 24h, not over a capped sample", async () => {
    const day = busyDay();
    // The OLDEST rows inside the window: an 800-row sample never reaches them.
    day[896].status = "failed";
    day[897].status = "failed";
    day[898].status = "interrupted";
    day[899].status = "failed";
    day[895].status = "started"; // in flight: a run, not a failure
    db.rows = [
      ...day,
      // outside the window: counts in neither
      { jobName: "busy-poller", status: "failed", duration: 1, createdAt: ago(30 * HOUR) },
      { jobName: "busy-poller", status: "success", duration: 1, createdAt: ago(31 * HOUR) },
    ];

    const { summary } = await buildCronCommandDeck();

    expect(summary.runs24h).toBe(900);
    expect(summary.failures24h).toBe(4);
  });
});

describe("buildCronCommandDeck · a failed read is unknown, never a confident 'never' or 0", () => {
  it("every cron_job_log read the deck makes rejects the deck when it fails", async () => {
    db.rows = [...busyDay(), { jobName: "weekly-review", status: "success", duration: 1, createdAt: ago(6 * DAY) }];
    await buildCronCommandDeck();
    const reads = db.calls;
    // positive control: the instrument saw the reads it is about to break
    expect(reads).toBeGreaterThanOrEqual(3);

    for (let k = 0; k < reads; k++) {
      db.calls = 0;
      db.failAt = k;
      await expect(buildCronCommandDeck(), `read #${k} failing`).rejects.toThrow("db down");
    }
  });
});

describe("getCronStats · last success / last failure per job", () => {
  it("a low-frequency job keeps its last success and failure when a busy job fills the log", async () => {
    const sixDays = ago(6 * DAY);
    const thirteenDays = ago(13 * DAY);
    db.rows = [
      ...busyDay(),
      { jobName: "weekly-review", status: "success", duration: 1, createdAt: sixDays },
      { jobName: "weekly-review", status: "interrupted", duration: null, createdAt: thirteenDays },
    ];

    const stats = await getCronStats();

    expect(stats["weekly-review"]).toEqual({
      success14d: 1,
      partial14d: 0,
      fail14d: 1,
      lastSuccessAt: sixDays.toISOString(),
      lastFailAt: thirteenDays.toISOString(),
    });
    expect(stats["busy-poller"].lastSuccessAt).toBe(ago(0).toISOString());
    expect(stats["busy-poller"].lastFailAt).toBeNull();
  });
});
