/**
 * The hard-delete guard must be WIRED, not merely present.
 *
 * WHY THIS FILE EXISTS. tests/brain/hard-delete-guard.test.ts proves
 * `judgeSweep` and `NEVER_HARD_DELETE_CATEGORIES` are correct — and every one
 * of its ten cases stays GREEN if the guard is ripped out of
 * app/api/cron/data-cleanup/route.ts entirely, because it never loads the
 * route. That is the orphaned-subject shape: a guard with excellent unit tests
 * and no proof that the destructive caller consults it. The 2026-08-28 run
 * that hard-deleted 54,107 rows reported `status: "success"` — this codebase
 * has already paid once for a control nobody verified was connected.
 *
 * So these assert the ROUTE: that it counts before deleting, refuses to delete
 * when the count is over cap, files the run as FAILED rather than reporting a
 * green zero, and carries the category/operator exclusions in the predicate it
 * actually sends to Prisma.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MAX_HARD_DELETE_PER_SWEEP } from "@/lib/brain/hard-delete-guard";

/** Rows the pre-count reports for brain_memories. Set per test. */
let brainCount = 0;
const brainDeleteMany = vi.fn().mockResolvedValue({ count: 7 });
const brainCountFn = vi.fn(() => Promise.resolve(brainCount));

const purgeStaleCategory = vi.fn();
vi.mock("@/lib/system/stale-data-purger", () => ({
  // Indirection through a module-scope fn, matching
  // data-cleanup-pending-actions.test.ts: a resolved value set inside the
  // factory does not survive afterEach's restoreAllMocks.
  purgeStaleCategory: (...a: unknown[]) => purgeStaleCategory(...a),
}));

// 2026-09-18 (review on #2430) · data-cleanup now reconciles vector_embeddings
// and propagates a REFUSED or THROWN sweep into the route's TOP-LEVEL `ok:false`
// -- lib/services/cron-manager.ts reads only the top level, so a nested failure
// would have filed the run as SUCCESS while dead embeddings stayed searchable.
//
// Mocked here so the positive control below describes a NORMAL night. Without
// this the unmocked sweep throws against the partial prisma stub, and "a normal
// night reports success" would assert the failure path by accident.
const shadowMocks = vi.hoisted(() => ({ sweep: vi.fn() }));
vi.mock("@/lib/db/embedding-shadow", () => ({
  sweepEmbeddingShadow: shadowMocks.sweep,
}));
const OK_SWEEP = {
  sources: [],
  totalMarked: 0,
  totalCleared: 0,
  refused: false,
  dryRun: false,
};

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    count: vi.fn().mockResolvedValue(0),
  });
  // brainMemory is the ONLY stable stub — the others are throwaways, so the
  // spies below can only ever have been driven by the brain sweeps.
  const brainMemory = {
    deleteMany: (...a: unknown[]) => brainDeleteMany(...a),
    count: (...a: unknown[]) => brainCountFn(...a),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
  };
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "$queryRaw") return () => Promise.resolve([]);
        if (prop === "$executeRaw") return () => Promise.resolve(0); // plate-retention scrub (ADR-0017)
        if (prop === "brainMemory") return brainMemory;
        return generic();
      },
    },
  );
  return { prisma };
});

async function runRoute() {
  vi.resetModules();
  const { GET } = await import("@/app/api/cron/data-cleanup/route");
  return (await GET(new Request("http://x/api/cron/data-cleanup"), {} as never)) as {
    ok?: boolean;
    reason?: string;
    resultCount?: number;
    deletedByTable: Record<string, number>;
    blockedSweeps: Array<{ allowed: boolean; count: number; cap: number; reason?: string }>;
  };
}

beforeEach(() => {
  brainCount = 0;
  // Re-arm the IMPLEMENTATION, not just the call list: afterEach's
  // restoreAllMocks strips a resolved value set at declaration, after which
  // the route reads `.count` off undefined and every later case dies in the
  // harness rather than on the assertion.
  brainDeleteMany.mockReset();
  brainDeleteMany.mockResolvedValue({ count: 7 });
  // Same re-arm, same reason as the comment above — the shadow sweep mock walked
  // straight into it: with no implementation it returns undefined, the route
  // calls `.catch` on undefined, and every case dies in the harness instead of
  // on its assertion.
  shadowMocks.sweep.mockReset();
  shadowMocks.sweep.mockResolvedValue(OK_SWEEP);
  brainCountFn.mockClear();
  purgeStaleCategory.mockReset();
  purgeStaleCategory.mockResolvedValue({ category: "pending_actions_7d", purged: 0, note: "" });
});
afterEach(() => vi.restoreAllMocks());

describe("data-cleanup route · the hard-delete breaker is actually wired", () => {
  it("BREAKS: an incident-sized sweep deletes NOTHING", async () => {
    brainCount = 54_107; // the real 2026-08-28 volume
    const out = await runRoute();
    expect(brainDeleteMany, "no brain_memories row may be deleted over the cap").not.toHaveBeenCalled();
    expect(out.deletedByTable.brain_memories_gc).toBe(0);
    expect(out.blockedSweeps.length).toBeGreaterThan(0);
  });

  it("BREAKS: a blocked sweep files the run as FAILED, not a green zero", async () => {
    brainCount = 54_107;
    const out = await runRoute();
    // The incident's signature was `status: "success"` on a 54,107-row delete.
    expect(out.ok, "a blocked sweep must not report success").toBe(false);
    expect(out.reason).toMatch(/brain_memories_gc/);
  });

  it("counts BEFORE deleting — the breaker cannot judge what it never measured", async () => {
    brainCount = 10;
    await runRoute();
    expect(brainCountFn).toHaveBeenCalled();
  });

  it("positive control: a normal night still deletes, and reports success", async () => {
    brainCount = 505; // the largest observed normal night
    const out = await runRoute();
    expect(brainDeleteMany, "a normal sweep must still run").toHaveBeenCalled();
    expect(out.ok).toBeUndefined();
    expect(out.blockedSweeps).toEqual([]);
  });

  it("the boundary is enforced at the route, not just in the pure function", async () => {
    brainCount = MAX_HARD_DELETE_PER_SWEEP + 1;
    const blocked = await runRoute();
    expect(blocked.deletedByTable.brain_memories_gc).toBe(0);

    brainDeleteMany.mockClear();
    brainCount = MAX_HARD_DELETE_PER_SWEEP;
    const allowed = await runRoute();
    expect(brainDeleteMany).toHaveBeenCalled();
    expect(allowed.blockedSweeps).toEqual([]);
  });

  it("resultCount is populated — the incident logged NULL and hid its own volume", async () => {
    brainCount = 100;
    const out = await runRoute();
    expect(typeof out.resultCount).toBe("number");
  });

  it("the predicate EXCLUDES protected categories and operator-authored rows", async () => {
    brainCount = 10;
    await runRoute();
    // Assert the SUBJECT: what was actually sent to Prisma, not the verdict.
    const where = brainDeleteMany.mock.calls
      .map(([arg]) => (arg as { where?: Record<string, unknown> })?.where)
      .find((w) => w && "OR" in w) as Record<string, unknown> | undefined;
    expect(where, "the brainGc sweep must have run").toBeDefined();
    const cat = where!.category as { notIn?: string[] };
    expect(cat?.notIn, "durable categories must be excluded by the predicate").toContain("belief");
    expect(JSON.stringify(where!.NOT), "operator-authored rows must be excluded").toMatch(/createdBy/);
  });
});

describe("the embedding reconciliation cannot fail silently", () => {
  it("BREAKS: a REFUSED sweep files the run as FAILED, not a green zero", async () => {
    // cron-manager's reportedFailureReason reads ONLY a top-level `ok: false`,
    // and CronJobLog stores status/error/count — never the response payload. So
    // a refusal reported only under `embeddingShadow` is invisible forever.
    shadowMocks.sweep.mockResolvedValue({
      ...OK_SWEEP,
      refused: true,
      refusedReason: "17720 rows exceeds MAX_NEW_MARKS_PER_RUN=2000; re-run with force",
    });

    const out = await runRoute();

    expect(out.ok).toBe(false);
    expect(String(out.reason)).toContain("MAX_NEW_MARKS_PER_RUN");
  });

  it("BREAKS: a THROWN sweep files the run as FAILED too", async () => {
    shadowMocks.sweep.mockRejectedValue(new Error("connection reset"));

    const out = await runRoute();

    expect(out.ok).toBe(false);
    expect(String(out.reason)).toContain("embedding shadow sweep threw");
  });

  it("CANARY: a clean sweep leaves the run green, so the two above are not vacuous", async () => {
    const out = await runRoute();
    expect(out.ok).toBeUndefined();
  });
});
