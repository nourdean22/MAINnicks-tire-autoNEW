/**
 * data-cleanup · the cron_job_logs keeper read must be REAL, and a failed
 * keeper read must never widen the delete (audit 08-F9, 2026-10-10).
 *
 * CronJobLog has no @map, so its columns are "jobName" / "createdAt". The
 * keeper SQL spelled them job_name / created_at -> 42703 on every run, and
 * `.catch(() => [])` turned that error into "no keepers", so the delete ran
 * with NO exclusion: "keep last success + last failure per job forever"
 * (config/retention.ts) never held once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  cronDeleteMany: vi.fn(),
}));

vi.mock("@/lib/system/stale-data-purger", () => ({
  purgeStaleCategory: () => Promise.resolve({ category: "pending_actions_7d", purged: 0, note: "" }),
}));
vi.mock("@/lib/db/embedding-shadow", () => ({
  sweepEmbeddingShadow: () =>
    Promise.resolve({ sources: [], totalMarked: 0, totalCleared: 0, refused: false, dryRun: false }),
}));
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    deleteMany: () => Promise.resolve({ count: 0 }),
    updateMany: () => Promise.resolve({ count: 0 }),
    create: () => Promise.resolve({}),
    count: () => Promise.resolve(0),
  });
  const cronJobLog = { deleteMany: (...a: unknown[]) => h.cronDeleteMany(...a) };
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "$queryRaw") return (...a: unknown[]) => h.queryRaw(...a);
        if (prop === "$executeRaw") return () => Promise.resolve(0);
        if (prop === "cronJobLog") return cronJobLog;
        return generic();
      },
    },
  );
  return { prisma };
});

type CleanupResult = { ok?: boolean; reason?: string; deletedByTable: Record<string, number> };

async function runRoute(): Promise<CleanupResult> {
  vi.resetModules();
  const { GET } = await import("@/app/api/cron/data-cleanup/route");
  return (await GET(new Request("http://x/api/cron/data-cleanup"), {} as never)) as CleanupResult;
}

/** The SQL text of the keeper read (the tagged-template strings joined). */
function keeperSql(): string {
  const call = h.queryRaw.mock.calls.find(([strings]) =>
    Array.isArray(strings) && (strings as string[]).join("").includes("cron_job_logs"),
  );
  return call ? (call[0] as string[]).join("?") : "";
}

beforeEach(() => {
  h.queryRaw.mockReset();
  h.cronDeleteMany.mockReset();
  h.cronDeleteMany.mockResolvedValue({ count: 4 });
});
afterEach(() => vi.restoreAllMocks());

describe("data-cleanup · cron_job_logs keepers", () => {
  it("names the REAL camelCase columns (no @map on CronJobLog)", async () => {
    h.queryRaw.mockResolvedValue([{ id: "keep-1" }]);
    await runRoute();
    const sql = keeperSql();
    expect(sql, "the keeper read must have run").not.toBe("");
    expect(sql).toContain('"jobName"');
    expect(sql).toContain('"createdAt"');
    expect(sql).not.toMatch(/job_name|created_at/);
  });

  it("CONTROL: a successful keeper read deletes old rows EXCEPT the keepers", async () => {
    h.queryRaw.mockResolvedValue([{ id: "keep-1" }, { id: "keep-2" }]);
    const out = await runRoute();
    expect(h.cronDeleteMany).toHaveBeenCalledTimes(1);
    const where = (h.cronDeleteMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.id).toEqual({ notIn: ["keep-1", "keep-2"] });
    expect(out.deletedByTable.cron_job_logs).toBe(4);
    expect(out.ok).toBeUndefined();
  });

  it("BREAKS: a FAILED keeper read deletes NOTHING from cron_job_logs", async () => {
    h.queryRaw.mockRejectedValue(new Error('column "job_name" does not exist'));
    const out = await runRoute();
    expect(h.cronDeleteMany, "a failed read must never widen the delete").not.toHaveBeenCalled();
    expect(out.deletedByTable.cron_job_logs).toBe(0);
  });

  it("BREAKS: a FAILED keeper read files the run as FAILED, not a green skip", async () => {
    h.queryRaw.mockRejectedValue(new Error("connection reset"));
    const out = await runRoute();
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/cron_job_logs/);
  });

  it("a measured-empty keeper set is a real answer: the delete still runs", async () => {
    // No success/failed rows at all -> nothing to keep. That is a successful
    // read returning zero rows, not an error, so retention proceeds.
    h.queryRaw.mockResolvedValue([]);
    const out = await runRoute();
    expect(h.cronDeleteMany).toHaveBeenCalledTimes(1);
    expect(out.ok).toBeUndefined();
  });
});
