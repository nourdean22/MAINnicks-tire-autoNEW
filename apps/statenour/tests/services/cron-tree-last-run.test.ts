/**
 * cron-tree reads lastRunAt and the 24h counts from the whole table, not a 800-row sample
 * (audit 08-F12, 2026-10-11).
 *
 * One `take: 800` newest-rows read fed lastRunAt, drift and the 24h strip. A busy job
 * filled the sample, so a weekly job read lastRunAt null ("never ran") and the 24h
 * counts capped at 800. The sample now feeds only the per-job sparkline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; jobName: string; status: string; duration: number | null; createdAt: Date };
const h = vi.hoisted(() => ({ rows: [] as Row[] }));

const NOW = new Date("2026-10-11T12:00:00Z").getTime();
const MIN = 60_000;

function matchWhere(r: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  if (Array.isArray(where.OR)) return (where.OR as Record<string, unknown>[]).some((w) => matchWhere(r, w));
  for (const [k, v] of Object.entries(where)) {
    const rv = (r as unknown as Record<string, unknown>)[k];
    if (v instanceof Date) {
      if (!(rv instanceof Date) || rv.getTime() !== v.getTime()) return false;
    } else if (v && typeof v === "object") {
      const op = v as { in?: unknown[]; gte?: Date };
      if (op.in && !op.in.includes(rv)) return false;
      if (op.gte && !((rv as Date).getTime() >= op.gte.getTime())) return false;
    } else if (rv !== v) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cronJobLog: {
      findMany: async (a: { where?: Record<string, unknown>; take?: number }) => {
        const hits = h.rows.filter((r) => matchWhere(r, a.where)).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
        return typeof a.take === "number" ? hits.slice(0, a.take) : hits;
      },
      groupBy: async (a: { by: string[]; where?: Record<string, unknown> }) => {
        const groups = new Map<string, Row[]>();
        for (const r of h.rows.filter((x) => matchWhere(x, a.where))) {
          const key = a.by.map((b) => String((r as unknown as Record<string, unknown>)[b])).join("|");
          groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        return [...groups.values()].map((rs) => ({
          ...Object.fromEntries(a.by.map((b) => [b, (rs[0] as unknown as Record<string, unknown>)[b]])),
          _max: { createdAt: new Date(Math.max(...rs.map((r) => r.createdAt.getTime()))) },
          _count: { _all: rs.length, id: rs.length },
        }));
      },
    },
  },
}));
vi.mock("@/lib/services/cron-control", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/cron-control")>()),
  listCronControls: async () => [],
  getCronStats: async () => ({}),
}));

import { buildCronTree } from "@/lib/services/cron-tree";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.rows = [];
  // 900 outbox-drain runs over the last 22.5 hours; the 5 oldest failed.
  for (let i = 0; i < 900; i++) {
    h.rows.push({ id: `o${i}`, jobName: "outbox-drain", status: i >= 895 ? "failed" : "success", duration: 10, createdAt: new Date(NOW - (i + 1) * 1.5 * MIN) });
  }
  // One weekly-review success, 6 days old.
  h.rows.push({ id: "w1", jobName: "weekly-review", status: "success", duration: 4000, createdAt: new Date(NOW - 6 * 24 * 60 * MIN) });
});

describe("buildCronTree: last run and 24h counts", () => {
  it("a weekly job crowded out of the sample still has its lastRunAt and lastStatus", async () => {
    const tree = await buildCronTree();
    const weekly = tree.rows.find((r) => r.name === "weekly-review")!;
    expect(weekly.lastRunAt).toBe(new Date(NOW - 6 * 24 * 60 * MIN).toISOString());
    expect(weekly.lastStatus).toBe("success");
    expect(weekly.lastRunMs).toBe(4000);
  });

  it("the 24h strip counts every row in the window, not the sample", async () => {
    const tree = await buildCronTree();
    expect(tree.summary.runs24h).toBe(900);
    expect(tree.summary.failures24h).toBe(5);
  });

  it("CONTROL: the busy job's last run is its newest row; the sparkline keeps 20 points", async () => {
    const tree = await buildCronTree();
    const busy = tree.rows.find((r) => r.name === "outbox-drain")!;
    expect(busy.lastRunAt).toBe(new Date(NOW - 1.5 * MIN).toISOString());
    expect(busy.recentDurations).toHaveLength(20);
  });
});
