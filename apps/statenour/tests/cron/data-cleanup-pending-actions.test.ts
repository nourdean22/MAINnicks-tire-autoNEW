/**
 * data-cleanup must actually RUN the pending-actions sweep.
 *
 * The autonomous_action approval="pending" queue grew to 468 rows
 * (2026-08-12, BDN-002) precisely because the only sweep was an
 * operator-tap purger on /system — the policy existed, the producer
 * never fired. These tests pin the new producer: the nightly
 * data-cleanup cron delegates to the incumbent purger (one policy,
 * two callers) and reports its count. Consumer-side proof alone is the
 * false-green shape the 2026-08-04 sweep registered — pin the producer.
 *
 * The purger's own behavior is covered by tests/lib/stale-data-purger.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const purgeStaleCategory = vi.fn();

vi.mock("@/lib/system/stale-data-purger", () => ({
  purgeStaleCategory: (...a: unknown[]) => purgeStaleCategory(...a),
}));

// cronHandler pulls in DB + settings; stub to the identity wrapper so the
// tests exercise the ROUTE body, per the tests/cron/* convention.
vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

// The route sweeps ~20 unrelated tables. A Proxy stub answers every model
// access with resolved zero-counts so this test stays pinned to the one
// new producer instead of hand-mocking each retention sweep.
vi.mock("@/lib/prisma", () => {
  const modelStub = () => ({
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
  });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "$queryRaw") return () => Promise.resolve([]);
        return modelStub();
      },
    },
  );
  return { prisma };
});

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/cron/data-cleanup/route");
}

beforeEach(() => purgeStaleCategory.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("data-cleanup cron · pending-actions sweep", () => {
  it("delegates to the incumbent purger with the pending_actions_7d category", async () => {
    purgeStaleCategory.mockResolvedValueOnce({
      category: "pending_actions_7d",
      purged: 424,
      note: "Marked 424 actions rejected (>7d pending)",
    });
    const { GET } = await loadRoute();
    const out = (await GET(new Request("http://x/api/cron/data-cleanup"), {} as never)) as {
      deletedByTable: Record<string, number>;
    };
    expect(purgeStaleCategory).toHaveBeenCalledTimes(1);
    expect(purgeStaleCategory).toHaveBeenCalledWith("pending_actions_7d");
    expect(out.deletedByTable.autonomous_actions_auto_purged).toBe(424);
  });

  it("reports a genuine zero as success, not as an error", async () => {
    purgeStaleCategory.mockResolvedValueOnce({
      category: "pending_actions_7d",
      purged: 0,
      note: "Marked 0 actions rejected (>7d pending)",
    });
    const { GET } = await loadRoute();
    const out = (await GET(new Request("http://x/api/cron/data-cleanup"), {} as never)) as {
      deletedByTable: Record<string, number>;
    };
    expect(out.deletedByTable.autonomous_actions_auto_purged).toBe(0);
  });

  it("does NOT swallow a purger failure — it must land a FAILED cron log", async () => {
    purgeStaleCategory.mockRejectedValueOnce(new Error("neon unreachable"));
    const { GET } = await loadRoute();
    await expect(
      GET(new Request("http://x/api/cron/data-cleanup"), {} as never),
    ).rejects.toThrow(/neon unreachable/);
  });
});
