/**
 * tests/cron/data-cleanup-decay-dry-run.test.ts · 2026-10-17 (brain W5)
 *
 * data-cleanup REPORTS what memory decay would touch every night and changes
 * nothing. runMemoryDecay() had no caller (its header claimed the nightly run);
 * applying it is Nour's call after a week of counts. These assert the ROUTE:
 * the count is reported, it lands in the audit payload where the week of counts
 * can be read, no brain_memories write is issued, and a failed count is null
 * (unknown), never 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queryUnsafe: [] as { sql: string; params: unknown[] }[],
  executeUnsafe: [] as { sql: string; params: unknown[] }[],
  executeTagged: [] as string[],
  countResult: { value: [{ n: 42 }] as unknown, fail: false },
  groupResult: { value: [{ category: "semantic_edge", n: 30 }, { category: "archive_document", n: 12 }] as unknown, fail: false },
  auditCreate: [] as unknown[],
  brainWrites: [] as unknown[],
}));

const shadowMocks = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock("@/lib/db/embedding-shadow", () => ({ sweepEmbeddingShadow: shadowMocks.sweep }));
vi.mock("@/lib/brain/memory-tombstone", () => ({ dropEmbeddingsForMemories: () => Promise.resolve(0) }));
vi.mock("@/lib/system/stale-data-purger", () => ({
  purgeStaleCategory: () => Promise.resolve({ category: "pending_actions_7d", purged: 0, note: "" }),
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
  const brainMemory = {
    deleteMany: () => Promise.resolve({ count: 0 }),
    count: () => Promise.resolve(0),
    findMany: () => Promise.resolve([]),
    updateMany: (...a: unknown[]) => (h.brainWrites.push({ op: "updateMany", a }), Promise.resolve({ count: 0 })),
    update: (...a: unknown[]) => (h.brainWrites.push({ op: "update", a }), Promise.resolve({})),
    create: (...a: unknown[]) => (h.brainWrites.push({ op: "create", a }), Promise.resolve({})),
  };
  const auditEvent = {
    deleteMany: () => Promise.resolve({ count: 0 }),
    create: (...a: unknown[]) => (h.auditCreate.push(a[0]), Promise.resolve({})),
  };
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "brainMemory") return brainMemory;
        if (prop === "auditEvent") return auditEvent;
        if (prop === "$queryRaw") return () => Promise.resolve([]);
        if (prop === "$executeRaw")
          return (s: TemplateStringsArray) => (h.executeTagged.push(s.join("?")), Promise.resolve(0));
        if (prop === "$queryRawUnsafe")
          return (sql: string, ...params: unknown[]) => {
            h.queryUnsafe.push({ sql, params });
            const r = /GROUP BY/i.test(sql) ? h.groupResult : h.countResult;
            return r.fail ? Promise.reject(new Error("count read failed")) : Promise.resolve(r.value);
          };
        if (prop === "$executeRawUnsafe")
          return (sql: string, ...params: unknown[]) => (h.executeUnsafe.push({ sql, params }), Promise.resolve(0));
        return generic();
      },
    },
  );
  return { prisma };
});

type Out = {
  ok?: boolean;
  reason?: string;
  decayWouldAffect?: number | null;
  decayByCategoryTop5?: Array<{ category: string; count: number }> | null;
  decayDryRunError?: string;
};

type AuditPayload = {
  decayWouldAffect?: number | null;
  decayByCategoryTop5?: Array<{ category: string; count: number }> | null;
  decayDryRunError?: string | null;
};
const auditPayload = (): AuditPayload =>
  (
    h.auditCreate.find(
      (e) => (e as { data?: { eventType?: string } }).data?.eventType === "cron:data_cleanup_completed",
    ) as { data: { payload: AuditPayload } }
  ).data.payload;

async function runRoute(): Promise<Out> {
  vi.resetModules();
  const { GET } = await import("@/app/api/cron/data-cleanup/route");
  return (await GET(new Request("http://x/api/cron/data-cleanup"), {} as never)) as Out;
}

beforeEach(() => {
  h.queryUnsafe.length = 0;
  h.executeUnsafe.length = 0;
  h.executeTagged.length = 0;
  h.auditCreate.length = 0;
  h.brainWrites.length = 0;
  h.countResult.value = [{ n: 42 }];
  h.countResult.fail = false;
  h.groupResult.value = [{ category: "semantic_edge", n: 30 }, { category: "archive_document", n: 12 }];
  h.groupResult.fail = false;
  shadowMocks.sweep.mockReset();
  shadowMocks.sweep.mockResolvedValue({ sources: [], totalMarked: 0, totalCleared: 0, refused: false, dryRun: false });
});


describe("data-cleanup · memory decay is reported as a dry run", () => {
  it("reports decayWouldAffect from the count and the run stays a success", async () => {
    const out = await runRoute();
    expect(out.decayWouldAffect).toBe(42);
    expect(out.ok, "a dry-run report must not file the run as failed").not.toBe(false);
  });

  it("issues the count as a SELECT and NO write to brain_memories (decay is not applied)", async () => {
    await runRoute();

    const counts = h.queryUnsafe.filter(
      (q) => /COUNT\(\*\)/i.test(q.sql) && /brain_memories/.test(q.sql) && !/GROUP BY/i.test(q.sql),
    );
    expect(counts.length, "the count query must actually be sent").toBe(1);
    const grouped = h.queryUnsafe.filter((q) => /GROUP BY/i.test(q.sql));
    expect(grouped.length, "the by-category query must actually be sent").toBe(1);
    expect(grouped[0].sql).toMatch(/^\s*SELECT/i);

    const allSql = [...h.queryUnsafe.map((q) => q.sql), ...h.executeUnsafe.map((q) => q.sql), ...h.executeTagged];
    for (const s of allSql) expect(s, "no UPDATE brain_memories anywhere").not.toMatch(/UPDATE\s+"?brain_memories/i);
    expect(
      h.executeUnsafe.filter((q) => /brain_memories/.test(q.sql)),
      "no unsafe EXECUTE touches brain_memories",
    ).toEqual([]);
    expect(h.brainWrites, "no Prisma write on brainMemory from the decay path").toEqual([]);
  });

  it("records the count in the audit payload, where the week of counts can be read", async () => {
    await runRoute();
    const ev = h.auditCreate.find(
      (e) => (e as { data?: { eventType?: string } }).data?.eventType === "cron:data_cleanup_completed",
    ) as { data: { payload: { decayWouldAffect?: number | null } } };
    expect(ev.data.payload.decayWouldAffect).toBe(42);
  });

  it("breaks the count down by category (top 5) in the result AND the audit payload", async () => {
    const out = await runRoute();
    const expected = [
      { category: "semantic_edge", count: 30 },
      { category: "archive_document", count: 12 },
    ];
    expect(out.decayByCategoryTop5).toEqual(expected);
    expect(auditPayload().decayByCategoryTop5).toEqual(expected);
  });

  it("the by-category query uses the SAME where-clause and parameters as the plain count", async () => {
    await runRoute();
    const count = h.queryUnsafe.find((q) => !/GROUP BY/i.test(q.sql) && /COUNT\(\*\)/i.test(q.sql))!;
    const grouped = h.queryUnsafe.find((q) => /GROUP BY/i.test(q.sql))!;
    const whereOf = (sql: string) => sql.slice(sql.indexOf("WHERE"), /GROUP BY/i.test(sql) ? sql.search(/GROUP BY/i) : undefined).replace(/\s+/g, " ").trim();
    expect(whereOf(grouped.sql)).toBe(whereOf(count.sql));
    // $1 is "now minus 30 days" computed per call, so two calls differ by a few ms:
    // same exempt list, cutoffs within a second.
    const sameParams = (a: unknown[], b: unknown[]) => {
      expect(Math.abs((a[0] as Date).getTime() - (b[0] as Date).getTime())).toBeLessThan(1000);
      expect(a[1]).toEqual(b[1]);
      expect(a).toHaveLength(2);
    };
    sameParams(grouped.params, count.params);
  });

  it("a FAILED by-category read is null (unknown), the plain count still lands, and the run stays a success", async () => {
    h.groupResult.fail = true;
    const out = await runRoute();
    expect(out.decayByCategoryTop5).toBeNull();
    expect(out.decayWouldAffect).toBe(42);
    expect(auditPayload().decayByCategoryTop5).toBeNull();
    expect(out.ok).not.toBe(false);
  });

  it("the dry-run ERROR reaches the audit row, the only durable record (cron_job_logs keeps no response)", async () => {
    h.countResult.fail = true;
    const out = await runRoute();
    expect(out.decayDryRunError).toContain("count read failed");
    expect(auditPayload().decayWouldAffect).toBeNull();
    expect(auditPayload().decayDryRunError).toContain("count read failed");
  });

  it("a clean night carries no error in the audit payload (null, not a stale string)", async () => {
    await runRoute();
    expect(auditPayload().decayDryRunError ?? null).toBeNull();
  });

  it("a FAILED count is null (unknown), never 0, and the cleanup itself still completes", async () => {
    h.countResult.fail = true;
    const out = await runRoute();
    expect(out.decayWouldAffect).toBeNull();
    expect(out.ok).not.toBe(false);
  });

  it("an empty result (no count row) is null (unknown), not 0", async () => {
    h.countResult.value = [];
    const out = await runRoute();
    expect(out.decayWouldAffect).toBeNull();
  });
});
