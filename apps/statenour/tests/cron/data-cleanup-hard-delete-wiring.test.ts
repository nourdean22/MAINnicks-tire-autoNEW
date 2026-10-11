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
/** 05-X2: ids the pre-delete read returns; each sweep must drop their embeddings. */
const brainFindMany = vi.fn();
const tombstone = vi.hoisted(() => ({ drop: vi.fn() }));
vi.mock("@/lib/brain/memory-tombstone", () => ({ dropEmbeddingsForMemories: tombstone.drop }));

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
    findMany: (...a: unknown[]) => brainFindMany(...a),
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
  brainFindMany.mockReset();
  brainFindMany.mockImplementation(async (args: { where: { category?: unknown; id?: unknown } }) =>
    args.where.id
      ? [] // the post-delete re-read: every id the delete was given is gone
      : typeof args.where.category === "string"
      ? [{ id: `ret-${args.where.category}` }]
      : [{ id: "gc-1" }, { id: "gc-2" }],
  );
  tombstone.drop.mockReset();
  tombstone.drop.mockResolvedValue(0);
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

  it("BREAKS: a SKIPPED source files the run as FAILED (refused:false is not enough)", async () => {
    // A source the sweep declines individually — missing table, renamed
    // soft-delete column, or the 100%-mark mapping guard — leaves refused:false.
    // In steady state this list is empty, so a skip means the schema moved under
    // the allowlist and that source went unreconciled.
    shadowMocks.sweep.mockResolvedValue({
      ...OK_SWEEP,
      sources: [
        { sourceType: "mission", marked: 0, cleared: 0, skipped: 'table "Mission" does not exist' },
      ],
    });

    const out = await runRoute();

    expect(out.ok).toBe(false);
    expect(String(out.reason)).toContain("mission");
  });

  it("CANARY: sources present WITHOUT a skip leave the run green", async () => {
    shadowMocks.sweep.mockResolvedValue({
      ...OK_SWEEP,
      sources: [{ sourceType: "mission", marked: 3, cleared: 1 }],
    });

    const out = await runRoute();

    expect(out.ok).toBeUndefined();
  });
});

describe("05-X2: a hard delete takes the vector_embeddings copy with it", () => {
  it("GC: reads the ids with the same predicate, deletes by id, drops their embeddings", async () => {
    brainCount = 10;
    await runRoute();
    expect(tombstone.drop).toHaveBeenCalledWith(["gc-1", "gc-2"], "data-cleanup.brain_gc");
    const gcRead = brainFindMany.mock.calls.map(([a]) => a as { where: Record<string, unknown> }).find((a) => "OR" in a.where);
    expect(gcRead, "the GC id read must use the GC predicate").toBeDefined();
    const gcDelete = brainDeleteMany.mock.calls
      .map(([a]) => (a as { where: Record<string, unknown> }).where)
      .find((w) => "OR" in w)!;
    expect(gcDelete.id).toEqual({ in: ["gc-1", "gc-2"] });
  });

  it("retention: each category sweep drops the embeddings of the ids it deleted", async () => {
    brainCount = 10;
    await runRoute();
    expect(tombstone.drop).toHaveBeenCalledWith(["ret-reply_quality"], "data-cleanup.retention.reply_quality");
    expect(tombstone.drop).toHaveBeenCalledWith(["ret-power_panel"], "data-cleanup.retention.power_panel");
  });

  it("CONTROL: an over-cap night reads no ids and drops nothing", async () => {
    brainCount = 54_107;
    await runRoute();
    expect(brainFindMany).not.toHaveBeenCalled();
    expect(tombstone.drop).not.toHaveBeenCalled();
  });
});

// R3-17 #6: ids read before deleteMany went to dropEmbeddingsForMemories even
// when a row stopped matching (e.g. touched or re-confirmed in between) and
// survived the delete, so a live memory lost its vector.
describe("only rows confirmed gone lose their embeddings (R3-17 #6)", () => {
  /** The store after the delete: `survivors` still exist; the id re-read returns them. */
  const withSurvivors = (survivors: string[]) =>
    brainFindMany.mockImplementation(async (args: { where: { category?: unknown; id?: { in: string[] } } }) => {
      if (args.where.id) return args.where.id.in.filter((id) => survivors.includes(id)).map((id) => ({ id }));
      return typeof args.where.category === "string"
        ? [{ id: `ret-${args.where.category}` }, { id: `ret-${args.where.category}-live` }]
        : [{ id: "gc-1" }, { id: "gc-2" }];
    });

  it("GC: a row that survives deleteMany keeps its vector", async () => {
    brainCount = 10;
    withSurvivors(["gc-2"]);
    await runRoute();
    expect(tombstone.drop).toHaveBeenCalledWith(["gc-1"], "data-cleanup.brain_gc");
  });

  it("retention: a row that survives deleteMany keeps its vector", async () => {
    brainCount = 10;
    withSurvivors(["ret-reply_quality-live"]);
    await runRoute();
    expect(tombstone.drop).toHaveBeenCalledWith(["ret-reply_quality"], "data-cleanup.retention.reply_quality");
  });
});
