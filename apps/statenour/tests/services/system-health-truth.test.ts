/**
 * /api/health + the cron deck must not report what they did not measure
 * (audit 08-F12, 2026-10-10).
 *
 *  1. The morning-brief readiness check keyed on the UTC date while the writer
 *     (lib/inngest/functions/morning-brief.ts) keys on the ET date, so from
 *     20:00 to 24:00 ET every evening the brief read "not ready".
 *  2. `inngest.functions` was the literal 8 while the registry held ~29.
 *  3. A job with ZERO runs in the window scored a 100% success rate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  cronFindMany: vi.fn(),
  cronGroupBy: vi.fn(),
}));

vi.mock("@/lib/utils/cache", () => ({
  cached: (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
}));
// A three-entry registry: the reported count must FOLLOW the registry.
vi.mock("@/lib/inngest/functions", () => ({ fnA: {}, fnB: {}, fnC: {} }));
vi.mock("@/lib/prisma", () => {
  const empty = () => Promise.resolve([]);
  const prisma = {
    task: { groupBy: empty },
    commitment: { count: () => Promise.resolve(0) },
    smartDevice: { groupBy: empty },
    journalThread: { groupBy: empty },
    brainMemory: {
      findMany: empty,
      count: () => Promise.resolve(0),
      findUnique: (...a: unknown[]) => h.findUnique(...a),
    },
    cronJobLog: {
      findFirst: () => Promise.resolve(null),
      groupBy: (...a: unknown[]) => h.cronGroupBy(...a),
      findMany: (...a: unknown[]) => h.cronFindMany(...a),
    },
  };
  return { prisma, checkDbConnection: () => Promise.resolve({ connected: true, latency_ms: 1 }) };
});

import { buildSystemHealth, buildCronCommandDeck } from "@/lib/services/system-pages";
import { CRONS } from "@/config/crons";

beforeEach(() => {
  h.findUnique.mockReset();
  h.findUnique.mockResolvedValue({ updatedAt: new Date("2026-10-10T01:00:00Z") });
  h.cronFindMany.mockReset();
  h.cronFindMany.mockResolvedValue([]);
  h.cronGroupBy.mockReset();
  h.cronGroupBy.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("buildSystemHealth", () => {
  it("looks up the morning brief by the ET date the writer uses, not the UTC date", async () => {
    // 22:00 EDT on Oct 9 = 02:00 UTC on Oct 10. The writer keyed today's brief
    // "2026-10-09"; a UTC lookup asks for "2026-10-10" and reads NOT READY.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T02:00:00Z"));

    const view = await buildSystemHealth();

    const where = (h.findUnique.mock.calls[0][0] as { where: { category_key: { key: string } } }).where;
    expect(where.category_key.key).toBe("2026-10-09");
    expect(view.morningBrief).toMatchObject({ status: "ok", value: { ready: true, date: "2026-10-09" } });
  });

  it("CONTROL: in the daytime the ET and UTC dates agree and the brief still reads ready", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-10T15:00:00Z"));

    const view = await buildSystemHealth();

    const where = (h.findUnique.mock.calls[0][0] as { where: { category_key: { key: string } } }).where;
    expect(where.category_key.key).toBe("2026-10-10");
    expect(view.morningBrief).toMatchObject({ status: "ok", value: { ready: true } });
  });

  it("reports the Inngest function count from the registry, not a literal", async () => {
    const view = await buildSystemHealth();
    expect(view.inngest.functions).toBe(3);
  });
});

describe("buildCronCommandDeck", () => {
  it("a job with ZERO runs has NO success rate (null), not 100%", async () => {
    const deck = await buildCronCommandDeck();
    expect(deck.rows.length).toBeGreaterThan(0);
    for (const row of deck.rows) {
      expect(row.success14d + row.partial14d + row.fail14d).toBe(0);
      expect(row.successRate, `${row.name} has no runs`).toBeNull();
    }
  });

  it("an in-flight `started` newest row is not shown as a failed last run", async () => {
    const name = CRONS.find((c) => c.mode === "active")!.name;
    const at = new Date();
    // 2026-10-10: the last run is read per job (groupBy _max), then its row.
    h.cronGroupBy.mockImplementation(async (a: { by: string[] }) =>
      a.by.join() === "jobName" ? [{ jobName: name, _max: { createdAt: at } }] : [],
    );
    h.cronFindMany.mockResolvedValue([
      { jobName: name, status: "started", duration: null, createdAt: at },
    ]);
    const deck = await buildCronCommandDeck();
    const row = deck.rows.find((r) => r.name === name)!;
    expect(row.lastRunAt).not.toBeNull();
    expect(row.lastStatus).not.toBe("failed");
  });
});
