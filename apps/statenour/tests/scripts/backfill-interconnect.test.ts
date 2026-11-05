/**
 * W13 backfill (job 2026-11-02-nour-os-interconnect) · scripts/backfill-interconnect.ts.
 *
 * The script writes to Nour's production data, so the tests pin the guard first (prod-db-guard: the 870-row dry
 * run checked its flag after the delete):
 *   · a dry run (the default) makes ZERO Prisma write calls, DDL included; a write needs `--execute`, the plan file
 *     a dry run wrote, its token, AND BACKFILL_EXECUTE=1, and then a `_bak_` copy in one snapshot first (the
 *     scripts/people-backfill.ts shape); every gate arm has a CONTROL that does write, so zero is never vacuous;
 *   · the script never loads the fuzzy resolver or journal-link (journal person ids are W8b's own script): the
 *     resolver writes a people_intelligence_merge BrainMemory row on any non-exact match, even with createIfMissing:false;
 *   · a mission links by embedding score only (W8c's stored same-model vectors): a goal title inside a mission
 *     title never links; the score must clear MIN_SCORE and beat the runner-up by MARGIN;
 *   · only the anchored GENERIC_NOTE backfill notes are rewritten;
 *   · plan files and receipts carry ids only; receipts never overwrite an older one; the per-pass cap holds.
 * Prisma is a stub that records every write call; no test touches a database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Fixture = (args: any) => unknown;

const h = vi.hoisted(() => {
  const state = {
    prismaLoads: 0,
    resolverLoads: 0,
    journalLinkLoads: 0,
    fixtures: {} as Record<string, Record<string, (args: any) => unknown>>,
    /** Every write call (row writes, raw SQL, transactions) and every receipt write, in order. */
    log: [] as Array<{ kind: "write" | "receipt"; model: string; method: string; args: any }>,
    /** Ids whose compare-and-swap write matches nothing (the row changed since the plan). */
    lost: new Set<string>(),
    /** Make the backup copy come back one row short. */
    backupShort: false,
    zeroSource: false,
    files: new Map<string, string>(),
    /** When set, row writes go here (a stateful table) instead of the count-1 default. */
    writeImpl: null as null | ((model: string, method: string, args: any) => { count: number }),
  };
  const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  const RAW_WRITES = new Set(["$executeRaw", "$executeRawUnsafe"]);
  const delegate = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return async (args: any) => {
            if (WRITES.has(method)) {
              state.log.push({ kind: "write", model, method, args });
              if (state.writeImpl) return state.writeImpl(model, method, args);
              const id = args?.where?.id;
              return { count: typeof id === "string" && state.lost.has(id) ? 0 : 1 };
            }
            const read = state.fixtures[model]?.[method];
            if (!read) throw new Error(`unstubbed read ${model}.${method}`);
            return read(args);
          };
        },
      },
    );
  const tx = {
    $executeRawUnsafe: async (sql: string) => {
      state.log.push({ kind: "write", model: "$tx", method: "$executeRawUnsafe", args: sql });
      return 0;
    },
    $queryRawUnsafe: async (sql: string) => [{ n: state.zeroSource ? 0 : state.backupShort && sql.includes("_bak_") ? 6 : 7 }],
  };
  const prisma = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== "string" || key === "then") return undefined;
        if (key === "$disconnect") return async () => {};
        if (key === "$transaction") {
          return async (fn: (t: typeof tx) => Promise<unknown>, opts: unknown) => {
            state.log.push({ kind: "write", model: "$", method: "$transaction", args: opts });
            return fn(tx);
          };
        }
        if (RAW_WRITES.has(key)) {
          return async (...args: unknown[]) => {
            state.log.push({ kind: "write", model: "$", method: key, args });
            return 0;
          };
        }
        return delegate(key);
      },
    },
  );
  return { state, prisma };
});

vi.mock("@/lib/prisma", () => {
  h.state.prismaLoads++;
  const s = h.state as unknown as { prismaReads: number };
  s.prismaReads = 0;
  return {
    get prisma() {
      s.prismaReads++;
      return h.prisma;
    },
  };
});
// FACT (R1 audit): the fuzzy resolver writes a people_intelligence_merge row on a non-exact match. Loading it at all fails.
vi.mock("@/lib/brain/person-profile-fuzzy", () => {
  h.state.resolverLoads++;
  return { resolvePersonByName: () => Promise.reject(new Error("the backfill must never call the resolver")) };
});
vi.mock("@/lib/services/people/journal-link", () => {
  h.state.journalLinkLoads++;
  return { linkJournalPeople: () => Promise.reject(new Error("the backfill must never call journal-link")) };
});
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    mkdirSync: () => undefined,
    writeFileSync: (path: unknown, data: unknown, opts?: { flag?: string }) => {
      const p = String(path);
      if (opts?.flag === "wx" && h.state.files.has(p)) {
        throw Object.assign(new Error(`EEXIST: ${p}`), { code: "EEXIST" });
      }
      h.state.files.set(p, String(data));
      if (p.split("\\").join("/").includes("/.completion/")) h.state.log.push({ kind: "receipt", model: "fs", method: "writeFileSync", args: JSON.parse(String(data)).status });
    },
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      const p = String(path);
      if (h.state.files.has(p)) return h.state.files.get(p);
      return (real.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    },
  };
});

const load = () => import("../../scripts/backfill-interconnect");

const NOW = new Date("2026-11-03T16:00:00Z");
/** Every fixture mission's updatedAt, as the plan file carries it. */
const T0 = "2026-10-21T12:00:00.000Z";
const SPACE = "cohere:embed-v4.0";
const writes = () => h.state.log.filter((e) => e.kind === "write");
const rowWrites = () => writes().filter((w) => !w.model.startsWith("$"));
const set = (model: string, method: string, fn: Fixture) => {
  (h.state.fixtures[model] ??= {})[method] = fn;
};
/** A unit vector at cosine `c` to [1, 0]. */
const at = (c: number) => [c, Math.sqrt(1 - c * c)];
const vrow = (sourceType: string, sourceId: string, v: number[], model = SPACE) => ({
  sourceType,
  sourceId,
  embedding: JSON.stringify(v),
  model,
});

const goal = (id: string, title: string, why: string | null = null) => ({ id, title, why });
const mission = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  id,
  title,
  successMetric: null,
  completionCriteria: null,
  systemKind: null,
  updatedBy: "user",
  createdAt: new Date("2026-10-20T15:00:00Z"),
  updatedAt: new Date(T0),
  planData: null,
  tasks: [],
  ...over,
});

beforeEach(() => {
  h.state.fixtures = {};
  h.state.log = [];
  h.state.lost = new Set();
  h.state.backupShort = false;
  h.state.zeroSource = false;
  h.state.files = new Map();
  h.state.writeImpl = null;
});

describe("loading the script", () => {
  it("imports without loading Prisma (a hoisted lib/prisma import binds before any gate)", async () => {
    await load();
    expect(h.state.prismaLoads).toBe(0);
  });
});

describe("arguments: refused before anything runs", () => {
  it.each([
    [[], {}, false],
    [["--execute"], {}, false],
    [[], { BACKFILL_EXECUTE: "1" }, false],
    [["--execute"], { BACKFILL_EXECUTE: "true" }, false],
    [["--execute"], { BACKFILL_EXECUTE: "1" }, true],
  ])("isExecute(%j, %j) is %s", async (argv, env, want) => {
    const { isExecute } = await load();
    expect(isExecute(argv as string[], env as NodeJS.ProcessEnv)).toBe(want);
  });

  it("parseArgs refuses unknown flags, bad values and an --execute without its plan file and token", async () => {
    const { parseArgs } = await load();
    expect(() => parseArgs(["--pass", "all", "--exceute"])).toThrow(/unknown/);
    expect(() => parseArgs(["--pass", "everything"])).toThrow(/--pass/);
    expect(() => parseArgs(["--pass", "notes", "--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs([])).toThrow(/--pass/);
    expect(() => parseArgs(["--pass", "journal-people"])).toThrow(/backfill-journal-person-ids/);
    expect(() => parseArgs(["--execute", "--token", "abc"])).toThrow(/--plan-file/);
    expect(() => parseArgs(["--execute", "--plan-file", "p.json"])).toThrow(/--token/);
    expect(parseArgs(["--pass", "all", "--limit", "5", "--out", "p.json"])).toMatchObject({
      mode: "dry",
      passes: ["orphan", "missions", "notes"],
      limit: 5,
      out: "p.json",
    });
  });
});

describe("decide: threshold and margin", () => {
  it("links only above MIN_SCORE and MARGIN clear of the runner-up", async () => {
    const { decide, MIN_SCORE, MARGIN } = await load();
    const r = (a: number, b?: number) => ({
      basis: "embedding" as const,
      ranked: [{ goalId: "g1", score: a }, ...(b === undefined ? [] : [{ goalId: "g2", score: b }])],
    });
    expect(decide(r(MIN_SCORE + 0.2, MIN_SCORE + 0.2 - MARGIN - 0.01))).toEqual({ decision: "link", goalId: "g1" });
    expect(decide(r(MIN_SCORE + 0.2, MIN_SCORE + 0.2 - MARGIN / 2))).toEqual({ decision: "list", reason: "within_margin" });
    expect(decide(r(MIN_SCORE - 0.01))).toEqual({ decision: "list", reason: "below_threshold" });
    expect(decide({ basis: "words", ranked: [{ goalId: "g1", score: 1 }] })).toEqual({
      decision: "list",
      reason: "no_comparable_embedding",
    });
    expect(decide({ basis: "embedding", ranked: [] })).toEqual({ decision: "list", reason: "no_active_goals" });
  });
});

function missionsFixture() {
  set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit", "feel strong"), goal("goal_cash0002", "Hit $15K revenue")]);
  set("mission", "findMany", () => [
    mission("mis_link0001", "Gym three times a week"),
    mission("mis_near0002", "Morning routine"),
    mission("mis_text0003", "Plan: Get fit by June"),
    mission("mis_inbx0004", "Inbox"),
    mission("mis_anch0005", "Health", { systemKind: "GENERAL" }),
    mission("mis_oldv0006", "Get fit at the old gym"),
  ]);
  set("vectorEmbedding", "findMany", () => [
    vrow("life_goal", "goal_fit0001", [1, 0]),
    vrow("life_goal", "goal_cash0002", [0, 1]),
    vrow("mission", "mis_link0001", at(0.9)), // 0.90 vs 0.44: links to goal_fit0001
    vrow("mission", "mis_near0002", [Math.SQRT1_2, Math.SQRT1_2]), // 0.707 vs 0.707: within margin
    vrow("mission", "mis_text0003", [0, -1]), // names the goal, scores nothing
    vrow("mission", "mis_oldv0006", [1, 0], "venice-bge-m3"), // another model's space: no cosine at all
  ]);
}

describe("PASS missions (plan: reads only)", () => {
  it("plans the one clear link and writes nothing", async () => {
    missionsFixture();
    const { planPass } = await load();
    const r = await planPass("missions", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([
      { missionId: "mis_link0001", lifeGoalId: "goal_fit0001", priorUpdatedBy: "user", basis: "embedding", score: expect.closeTo(0.9, 5), updatedAt: T0 },
    ]);
    expect(writes()).toHaveLength(0);
  });

  it("a goal title inside a mission title never links; the rest are listed with their top two", async () => {
    missionsFixture();
    const { planPass } = await load();
    const r = await planPass("missions", { prisma: h.prisma as never, now: NOW });
    const byId = Object.fromEntries(r.decisions!.map((d) => [d.missionId, d]));
    expect(byId.mis_text0003).toMatchObject({ basis: "embedding", decision: "list", reason: "below_threshold" });
    expect(byId.mis_near0002).toMatchObject({ decision: "list", reason: "within_margin" });
    expect(byId.mis_near0002.top).toHaveLength(2);
    // A vector from another model is no match: the rank falls back to labelled word overlap and never links.
    // Round 1 item 6: that case has its own reason (wrong_model), apart from "the linker never ran".
    expect(byId.mis_oldv0006).toMatchObject({ basis: "words", decision: "list", reason: "wrong_model" });
    expect(byId.mis_oldv0006.top[0].goalId).toBe("goal_fit0001");
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { id: "mis_inbx0004", reason: "inbox_or_anchor" },
        { id: "mis_anch0005", reason: "inbox_or_anchor" },
      ]),
    );
  });
});

describe("PASS orphan (the 2026-11-02 Plan it mission)", () => {
  function orphanFixture() {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]);
    set("vectorEmbedding", "findMany", () => []);
    set("mission", "findMany", () => [
      // Plan it copies the goal title verbatim; 2026-11-02 17:00 ET.
      mission("mis_orph0001", "Get fit", {
        createdAt: new Date("2026-11-02T22:00:00Z"),
        planData: { phases: [{ name: "Base" }, { name: "Build" }] },
        tasks: [{ phaseName: "Base", goalId: null }],
      }),
      // 2026-11-01 23:30 ET: the day before.
      mission("mis_prev0002", "Hit $15K revenue", { createdAt: new Date("2026-11-02T04:30:00Z") }),
      // Has tasks beyond phase 1: not the failed-plan shape.
      mission("mis_full0003", "Hit $15K revenue", {
        createdAt: new Date("2026-11-02T15:00:00Z"),
        planData: { phases: [{ name: "Leads" }, { name: "Close" }] },
        tasks: [{ phaseName: "Close", goalId: null }],
      }),
      // Its task names one goal by id and its title names another: listed, never guessed.
      mission("mis_conf0004", "Get fit", {
        createdAt: new Date("2026-11-02T16:00:00Z"),
        planData: { phases: [{ name: "Base" }] },
        tasks: [{ phaseName: "Base", goalId: "goal_cash0002" }],
      }),
    ]);
  }

  it("plans the exact-title link only and writes nothing", async () => {
    orphanFixture();
    const { planPass } = await load();
    const r = await planPass("orphan", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([expect.objectContaining({ missionId: "mis_orph0001", lifeGoalId: "goal_fit0001", basis: "exact_title" })]);
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { id: "mis_prev0002", reason: "not_created_2026-11-02_et" },
        { id: "mis_full0003", reason: "not_plan_it_shape" },
        { id: "mis_conf0004", reason: "task_goal_conflict" },
      ]),
    );
    expect(writes()).toHaveLength(0);
  });
});

function notesFixture() {
  set("relationshipLedger", "findMany", () => [
    {
      id: "led_generic1",
      note: "interaction reported in chat (call)",
      metadata: { auto: true, via: "backfill:conversation_digest", conversationId: "conv_1" },
      person: { name: "Dania", deletedAt: null },
    },
    {
      id: "led_generic2",
      note: "Interaction reported in chat (text)",
      metadata: { via: "backfill:conversation_digest", conversationId: "conv_2" },
      person: { name: "Sam", deletedAt: null },
    },
    {
      // Not anchored at the start: his own note that quotes the phrase stays his.
      id: "led_hisnote3",
      note: "Called him back. interaction reported in chat (call)",
      metadata: { via: "backfill:conversation_digest", conversationId: "conv_3" },
      person: { name: "Dania", deletedAt: null },
    },
    {
      // The live digest writer, not the 2026-10-30 backfill.
      id: "led_livedig4",
      note: "interaction reported in chat (call)",
      metadata: { via: "conversation_digest", conversationId: "conv_4" },
      person: { name: "Dania", deletedAt: null },
    },
    {
      id: "led_nosnip05",
      note: "interaction reported in chat (other)",
      metadata: { via: "backfill:conversation_digest", conversationId: "conv_5" },
      person: { name: "Lee", deletedAt: null },
    },
  ]);
}
const SNIPS: Record<string, string[]> = {
  conv_1: ["told Dania the lease is signed", "Dania wants the keys friday"],
  conv_2: ["x".repeat(300)],
};
const snippets = vi.fn(async (_name: string, _max: number, conversationId?: string) => SNIPS[conversationId ?? ""] ?? []);

describe("PASS notes (only the generic backfill notes)", () => {
  it("the anchored GENERIC_NOTE and a backfill via pick the rows; the plan holds a hash, not the text", async () => {
    notesFixture();
    const { planPass, noteLine } = await load();
    const { fileToken } = await import("@/lib/services/people/backfill-apply");
    const r = await planPass("notes", { prisma: h.prisma as never, now: NOW, snippets });
    expect(r.rows).toEqual([
      { ledgerId: "led_generic1", noteSha: fileToken("told Dania the lease is signed | Dania wants the keys friday") },
      { ledgerId: "led_generic2", noteSha: fileToken("x".repeat(120)) },
    ]);
    expect(noteLine(["x".repeat(300), "y\nz"])).toBe(`${"x".repeat(120)} | y z`);
    expect(r.skipped).toEqual(
      expect.arrayContaining([
        { id: "led_hisnote3", reason: "not_generic" },
        { id: "led_livedig4", reason: "not_backfill" },
        { id: "led_nosnip05", reason: "no_snippet" },
      ]),
    );
    expect(snippets).toHaveBeenCalledWith("Dania", 3, "conv_1");
    expect(writes()).toHaveLength(0);
  });
});

describe("the cap", () => {
  it("--limit 1 plans 1 and reports the rest over_cap; PASS_CAP bounds any limit", async () => {
    notesFixture();
    const { planPass, effectiveCap, PASS_CAP } = await load();
    const r = await planPass("notes", { prisma: h.prisma as never, now: NOW, snippets, limit: 1 });
    expect(r.rows.map((x) => (x as { ledgerId: string }).ledgerId)).toEqual(["led_generic1"]);
    expect(r.skipped.filter((s) => s.reason === "over_cap")).toEqual([{ id: "led_generic2", reason: "over_cap" }]);
    expect(effectiveCap(undefined)).toBe(PASS_CAP);
    expect(effectiveCap(PASS_CAP * 10)).toBe(PASS_CAP);
    expect(effectiveCap(2)).toBe(2);
  });
});

describe("backupInOneSnapshot: the copied table is a closed set (it is interpolated into SQL)", () => {
  it("refuses any source outside BACKUP_SOURCES and any backup name outside _bak*, before a transaction opens", async () => {
    const { backupInOneSnapshot, BACKUP_SOURCES } = await import("@/lib/services/people/backfill-apply");
    const inTransaction = vi.fn(async (fn: (q: { exec(s: string): Promise<unknown>; count(t: string): Promise<number> }) => Promise<unknown>) =>
      fn({ exec: async () => 0, count: async () => 3 }),
    );
    const io = { inTransaction } as never;
    for (const bad of ["relationship_ledger; DROP TABLE person_profiles", "Mission", "brain_dumps", "person_profiles"]) {
      await expect(backupInOneSnapshot(io, "_bak_x", bad as never)).rejects.toThrow(/BACKUP_SOURCES/);
    }
    await expect(backupInOneSnapshot(io, 'x"; DROP TABLE "Mission', "relationship_ledger")).rejects.toThrow(/must match/);
    expect(inTransaction).not.toHaveBeenCalled();
    // CONTROL: each allowed source runs.
    for (const ok of BACKUP_SOURCES) expect(await backupInOneSnapshot(io, "_bak_x", ok)).toEqual({ source: 3, backup: 3 });
    expect(inTransaction).toHaveBeenCalledTimes(BACKUP_SOURCES.length);
  });
});

describe("chatSnippets: the engine's reader, scoped to the row's conversation", () => {
  it("adds the conversation filter only when asked", async () => {
    const findMany = vi.fn(async () => [{ content: "met Dania for coffee" }]);
    set("chatMessage", "findMany", findMany);
    const { chatSnippets } = await import("@/lib/brain/people-intelligence");
    expect(await chatSnippets("Dania", 3, "conv_9")).toEqual(["met Dania for coffee"]);
    expect((findMany.mock.calls[0] as unknown as [any])[0].where).toEqual({
      role: "user",
      content: { contains: "Dania", mode: "insensitive" },
      conversationId: "conv_9",
    });
    await chatSnippets("Dania", 3);
    expect((findMany.mock.calls[1] as unknown as [any])[0].where).toEqual({ role: "user", content: { contains: "Dania", mode: "insensitive" } });
  });
});

function allFixtures() {
  missionsFixture();
  notesFixture();
  // The real chatSnippets runs in main: every user message it reads names Dania.
  set("chatMessage", "findMany", async () => [{ content: "told Dania the lease is signed" }]);
}
const quiet = () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  return {
    printed: () => [...log.mock.calls, ...err.mock.calls].map((c) => c.join(" ")).join("\n"),
    restore: () => {
      log.mockRestore();
      err.mockRestore();
    },
  };
};
const PLAN = "/r/w13-plan.json";
async function dryRunWithPlan() {
  const { main } = await load();
  const { fileToken } = await import("@/lib/services/people/backfill-apply");
  const q = quiet();
  const code = await main(["--pass", "all", "--out", PLAN], {}, NOW);
  q.restore();
  expect(code).toBe(0);
  return fileToken(h.state.files.get(PLAN)!);
}

describe("main: the gate end to end", () => {
  it.each([
    [["--pass", "all"], {}],
    [["--pass", "all", "--dry-run"], { BACKFILL_EXECUTE: "1" }],
    [["--pass", "all"], { BACKFILL_EXECUTE: "1" }],
  ])("argv %j env %j: zero writes, no files, exit 0", async (argv, env) => {
    allFixtures();
    const { main } = await load();
    const q = quiet();
    expect(await main(argv as string[], env as NodeJS.ProcessEnv, NOW)).toBe(0);
    q.restore();
    expect(writes()).toHaveLength(0);
    expect(h.state.files.size).toBe(0);
  });

  it("--out writes the plan file (ids only) and still no database write", async () => {
    allFixtures();
    await dryRunWithPlan();
    expect(writes()).toHaveLength(0);
    const plan = h.state.files.get(PLAN)!;
    for (const leak of ["Gym", "Get fit", "Dania", "Sam", "lease", "interaction reported", "move"]) expect(plan).not.toContain(leak);
    expect(JSON.parse(plan).passes.missions).toEqual([expect.objectContaining({ missionId: "mis_link0001", lifeGoalId: "goal_fit0001" })]);
  });

  it.each([
    ["no BACKFILL_EXECUTE", (t: string) => ["--execute", "--plan-file", PLAN, "--token", t], {}],
    ["a wrong token", () => ["--execute", "--plan-file", PLAN, "--token", "000000000000"], { BACKFILL_EXECUTE: "1" }],
    ["an unknown flag", (t: string) => ["--execute", "--plan-file", PLAN, "--token", t, "--force"], { BACKFILL_EXECUTE: "1" }],
  ])("--execute with %s: refused, exit 2, zero writes", async (_label, argv, env) => {
    allFixtures();
    const token = await dryRunWithPlan();
    const { main } = await load();
    const q = quiet();
    expect(await main(argv(token), env as NodeJS.ProcessEnv, NOW)).toBe(2);
    q.restore();
    expect(writes()).toHaveLength(0);
  });

  it("CONTROL: the full gate writes exactly the plan's rows, each pass after its own _bak_ copy, receipts in .completion", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    const { main, NOTE_MARKER } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    const printed = q.printed();
    q.restore();
    expect(rowWrites().map((w) => [w.model, w.args])).toEqual([
      [
        "mission",
        {
          // Round 1 item 2: a compare-and-swap on everything the plan read; item 1: the pass's own marker (28 chars, VarChar(64)).
          where: { id: "mis_link0001", lifeGoalId: null, deletedAt: null, status: { not: "KILLED" }, updatedAt: new Date(T0) },
          data: { lifeGoalId: "goal_fit0001", updatedBy: "backfill:2026-11-03:missions" },
        },
      ],
      [
        "relationshipLedger",
        {
          where: { id: "led_generic1", note: "interaction reported in chat (call)" },
          data: {
            note: "told Dania the lease is signed",
            metadata: {
              auto: true,
              via: "backfill:conversation_digest",
              conversationId: "conv_1",
              noteVia: NOTE_MARKER,
              originalNote: "interaction reported in chat (call)",
            },
          },
        },
      ],
    ]);
    // Each table is copied, in one REPEATABLE READ snapshot, before its first row write.
    const ddl = writes().filter((w) => w.model === "$tx").map((w) => String(w.args));
    expect(ddl).toEqual([
      'CREATE TABLE "_bak_mission_w13_missions_20261103" AS SELECT * FROM "Mission"',
      'CREATE TABLE "_bak_relationship_ledger_w13_notes_20261103" AS SELECT * FROM relationship_ledger',
    ]);
    expect(writes().find((w) => w.method === "$transaction")!.args).toMatchObject({ isolationLevel: "RepeatableRead" });
    const order = writes().map((w) => (w.model === "$tx" ? "bak" : w.model));
    expect(order.indexOf("bak")).toBeLessThan(order.indexOf("mission"));
    const paths = [...h.state.files.keys()].map((p) => p.replace(/\\/g, "/"));
    for (const pass of ["missions", "notes"]) {
      expect(paths.some((p) => p.endsWith(`/.completion/backfill-${pass}-2026-11-03.json`))).toBe(true);
    }
    // Printout and receipts carry ids and counts, never names, titles, notes or chat text.
    const receipts = [...h.state.files.entries()].filter(([p]) => p.replace(/\\/g, "/").includes("/.completion/")).map(([, c]) => c);
    for (const leak of ["Gym", "Get fit", "Dania", "lease", "interaction reported"]) {
      expect(printed).not.toContain(leak);
      expect(receipts.join("\n")).not.toContain(leak);
    }
    expect(h.state.resolverLoads).toBe(0);
    expect(h.state.journalLinkLoads).toBe(0);
  });

  it("a short backup copy stops the run before any row write", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    h.state.backupShort = true;
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(1);
    q.restore();
    expect(rowWrites()).toHaveLength(0);
  });

  it("a row changed since the plan is reported lost, never forced; a lost row exits 1 (round 1 item 5)", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    h.state.lost.add("mis_link0001");
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--pass", "missions", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(1);
    q.restore();
    const receipt = JSON.parse([...h.state.files.entries()].find(([p]) => p.includes("backfill-missions"))![1]);
    expect(receipt).toMatchObject({ pass: "missions", status: "applied", written: [], lost: [{ id: "mis_link0001", reason: "swap_lost" }] });
  });
});

describe("receipts", () => {
  it("never overwrite an older receipt of the same day", async () => {
    const { makeReceiptWriter } = await load();
    const first = makeReceiptWriter("/r", "notes", NOW);
    first({ a: 1 });
    first({ a: 2 });
    makeReceiptWriter("/r", "notes", NOW)({ b: 1 });
    const keys = [...h.state.files.keys()];
    expect(keys.map((p) => p.replace(/\\/g, "/"))).toEqual(["/r/backfill-notes-2026-11-03.json", "/r/backfill-notes-2026-11-03-2.json"]);
    expect(JSON.parse(h.state.files.get(keys[0])!)).toEqual({ a: 2 });
  });
});

describe("revert by receipt", () => {
  it("dry run writes nothing; the gated run undoes only rows still holding what the backfill wrote", async () => {
    const { main, NOTE_MARKER } = await load();
    const { fileToken } = await import("@/lib/services/people/backfill-apply");
    const receipts: Record<string, string> = {
      "/r/m.json": JSON.stringify({ pass: "missions", status: "applied", rows: [{ missionId: "mis_link0001", lifeGoalId: "goal_fit0001", priorUpdatedBy: "user" }] }),
      "/r/n.json": JSON.stringify({ pass: "notes", status: "applied", rows: [{ ledgerId: "led_generic1" }] }),
    };
    for (const [p, c] of Object.entries(receipts)) h.state.files.set(p, c);
    set("relationshipLedger", "findMany", () => [
      {
        id: "led_generic1",
        note: "told Dania the lease is signed",
        metadata: { via: "backfill:conversation_digest", noteVia: NOTE_MARKER, originalNote: "interaction reported in chat (call)" },
      },
    ]);
    const q = quiet();
    for (const f of Object.keys(receipts)) expect(await main(["--revert", f], {}, NOW)).toBe(0);
    expect(writes()).toHaveLength(0);
    expect(await main(["--revert", "/r/m.json", "--execute", "--token", "000000000000"], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(2);
    expect(writes()).toHaveLength(0);
    for (const [f, c] of Object.entries(receipts)) {
      expect(await main(["--revert", f, "--execute", "--token", fileToken(c)], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    }
    q.restore();
    expect(rowWrites().map((w) => [w.model, w.args])).toEqual([
      ["mission", { where: { id: "mis_link0001", lifeGoalId: "goal_fit0001", updatedBy: "backfill:2026-11-03:missions" }, data: { lifeGoalId: null, updatedBy: "user" } }],
      [
        "relationshipLedger",
        {
          where: { id: "led_generic1", note: "told Dania the lease is signed" },
          data: { note: "interaction reported in chat (call)", metadata: { via: "backfill:conversation_digest" } },
        },
      ],
    ]);
  });
});

describe("the resolver tripwire can fire (positive control, runs last)", () => {
  it("importing the fuzzy resolver counts, so the zero counts above are a measurement", async () => {
    expect(h.state.resolverLoads).toBe(0);
    await import("@/lib/brain/person-profile-fuzzy");
    expect(h.state.resolverLoads).toBe(1);
  });
});

// ── mutation-kill tests (reader 2 of round 1: each kills a mutant the suite above let survive) ──────

describe("gate arms the suite did not pin", () => {
  it("T1 --revert --execute with the right token but no BACKFILL_EXECUTE is refused, zero writes", async () => {
    const { main } = await load();
    const { fileToken } = await import("@/lib/services/people/backfill-apply");
    const c = JSON.stringify({ pass: "missions", status: "applied", rows: [{ missionId: "mis_link0001", lifeGoalId: "goal_fit0001", priorUpdatedBy: "user" }] });
    h.state.files.set("/r/m.json", c);
    const q = quiet();
    expect(await main(["--revert", "/r/m.json", "--execute", "--token", fileToken(c)], {}, NOW)).toBe(2);
    q.restore();
    expect(writes()).toHaveLength(0);
  });

  it("T17 --execute together with --dry-run is refused", async () => {
    const { parseArgs } = await load();
    expect(() => parseArgs(["--execute", "--dry-run", "--plan-file", "p.json", "--token", "t"])).toThrow(/together/);
  });

  it("T15 a refused --execute never imports lib/prisma", async () => {
    allFixtures();
    const reads = () => (h.state as unknown as { prismaReads?: number }).prismaReads ?? 0;
    const r0 = reads();
    await dryRunWithPlan();
    // CONTROL: a run past the gate does read the prisma binding, so the counter is a measurement.
    expect(reads()).toBeGreaterThan(r0);
    const before = reads();
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", "000000000000"], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(2);
    q.restore();
    expect(reads()).toBe(before);
  });
});

describe("execute-time checks", () => {
  it("T2 a note whose rebuilt line no longer matches the planned hash is lost, never written", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    set("chatMessage", "findMany", async () => [{ content: "Dania moved the date to monday" }]);
    const { main } = await load();
    const q = quiet();
    // Round 1 item 5: a lost row exits 1 and carries its own reason.
    expect(await main(["--execute", "--pass", "notes", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(1);
    q.restore();
    expect(rowWrites().filter((w) => w.model === "relationshipLedger")).toHaveLength(0);
    const receipt = JSON.parse([...h.state.files.entries()].find(([p]) => p.includes("backfill-notes"))![1]);
    expect(receipt).toMatchObject({ written: [], lost: [{ id: "led_generic1", reason: "snippet_changed" }] });
  });

  it("T14 --execute --pass missions runs only that pass (no ledger write, no notes receipt)", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--pass", "missions", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    q.restore();
    expect(rowWrites().map((w) => w.model)).toEqual(["mission"]);
    expect([...h.state.files.keys()].some((p) => p.includes("backfill-notes"))).toBe(false);
  });

  it("T10 the planned receipt is on disk before the first row write, the applied one after the last", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--pass", "missions", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    q.restore();
    const seq = h.state.log
      .filter((e) => e.kind === "receipt" || (e.kind === "write" && !e.model.startsWith("$")))
      .map((e) => (e.kind === "receipt" ? `receipt:${e.args}` : `write:${e.model}`));
    expect(seq).toEqual(["receipt:planned", "write:mission", "receipt:applied"]);
  });

  it("T18 an empty source table (0 rows: a wrong database) refuses the pass, zero row writes, exit 1", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    h.state.zeroSource = true;
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(1);
    q.restore();
    expect(rowWrites()).toHaveLength(0);
  });

  it("T4 a short or empty copy throws INSIDE the transaction (a real $transaction rolls the _bak_ table back)", async () => {
    const { backupInOneSnapshot } = await import("@/lib/services/people/backfill-apply");
    for (const [src, bak] of [[3, 2], [0, 0]] as const) {
      let threw = false;
      const io = {
        inTransaction: async (fn: (q: { exec(s: string): Promise<unknown>; count(t: string): Promise<number> }) => Promise<unknown>) => {
          try {
            return await fn({ exec: async () => 0, count: async (t) => (t.includes("_bak_") ? bak : src) });
          } catch (e) {
            threw = true;
            throw e;
          }
        },
      } as never;
      expect(await backupInOneSnapshot(io, "_bak_x", '"Mission"')).toEqual({ source: src, backup: bak });
      expect(threw).toBe(true);
    }
  });

  it("T5 an orphan plan executes after its OWN Mission copy (_bak_mission_w13_orphan_*)", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]);
    set("vectorEmbedding", "findMany", () => []);
    set("mission", "findMany", () => [
      mission("mis_orph0001", "Get fit", { createdAt: new Date("2026-11-02T22:00:00Z"), planData: { phases: [{ name: "Base" }] }, tasks: [{ phaseName: "Base", goalId: null }] }),
    ]);
    const { main } = await load();
    const { fileToken } = await import("@/lib/services/people/backfill-apply");
    const q = quiet();
    expect(await main(["--pass", "orphan", "--out", PLAN], {}, NOW)).toBe(0);
    const token = fileToken(h.state.files.get(PLAN)!);
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    q.restore();
    expect(writes().filter((w) => w.model === "$tx").map((w) => String(w.args))).toEqual([
      'CREATE TABLE "_bak_mission_w13_orphan_20261103" AS SELECT * FROM "Mission"',
    ]);
    expect(rowWrites().map((w) => [w.model, w.args])).toEqual([
      [
        "mission",
        {
          where: { id: "mis_orph0001", lifeGoalId: null, deletedAt: null, status: { not: "KILLED" }, updatedAt: new Date(T0) },
          data: { lifeGoalId: "goal_fit0001", updatedBy: "backfill:2026-11-03:orphan" },
        },
      ],
    ]);
  });
});

describe("revert", () => {
  it("T3 a ledger row without this backfill's noteVia is never reverted, even with an originalNote", async () => {
    const { main } = await load();
    const { fileToken } = await import("@/lib/services/people/backfill-apply");
    const c = JSON.stringify({ pass: "notes", status: "applied", rows: [{ ledgerId: "led_other07" }] });
    h.state.files.set("/r/n2.json", c);
    set("relationshipLedger", "findMany", () => [
      { id: "led_other07", note: "his own words", metadata: { noteVia: "some-other-writer", originalNote: "interaction reported in chat (call)" } },
    ]);
    const q = quiet();
    expect(await main(["--revert", "/r/n2.json", "--execute", "--token", fileToken(c)], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    q.restore();
    expect(rowWrites()).toHaveLength(0);
  });
});

describe("decide pins the literal bars", () => {
  it("T7 0.55 links at the bar, 0.50 never links, a 0.04 lead never links", async () => {
    const { decide, MIN_SCORE, MARGIN } = await load();
    expect(MIN_SCORE).toBe(0.55);
    expect(MARGIN).toBe(0.05);
    const r = (a: number, b?: number) => ({ basis: "embedding" as const, ranked: [{ goalId: "g1", score: a }, ...(b === undefined ? [] : [{ goalId: "g2", score: b }])] });
    expect(decide(r(0.55))).toEqual({ decision: "link", goalId: "g1" });
    expect(decide(r(0.5))).toEqual({ decision: "list", reason: "below_threshold" });
    expect(decide(r(0.7, 0.66))).toEqual({ decision: "list", reason: "within_margin" });
  });
});

describe("reads that decide what is eligible", () => {
  it("T11 missions read only live unlinked non-KILLED missions; goals read only active undeleted goals", async () => {
    missionsFixture();
    const goalArgs: any[] = [];
    const missionArgs: any[] = [];
    set("lifeGoal", "findMany", (a) => (goalArgs.push(a), [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]));
    set("mission", "findMany", (a) => (missionArgs.push(a), [mission("mis_link0001", "Gym three times a week")]));
    const { planPass } = await load();
    await planPass("missions", { prisma: h.prisma as never, now: NOW });
    expect(goalArgs[0].where).toEqual({ status: "active", deletedAt: null });
    expect(missionArgs[0].where).toEqual({ deletedAt: null, lifeGoalId: null, status: { not: "KILLED" } });
  });

  it("T12 orphan: a task goal that is not an active goal is listed, never linked", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit")]);
    set("vectorEmbedding", "findMany", () => []);
    set("mission", "findMany", () => [
      mission("mis_gone0005", "Read more", { createdAt: new Date("2026-11-02T22:00:00Z"), planData: { phases: [{ name: "Base" }] }, tasks: [{ phaseName: "Base", goalId: "goal_gone0009" }] }),
    ]);
    const { planPass } = await load();
    const r = await planPass("orphan", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([]);
    expect(r.skipped).toEqual([{ id: "mis_gone0005", reason: "task_goal_not_active" }]);
  });

  it("T13 orphan: two active goals with the same title are listed as ambiguous", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_fit0002", "Get fit")]);
    set("vectorEmbedding", "findMany", () => []);
    set("mission", "findMany", () => [mission("mis_twin0006", "Get fit", { createdAt: new Date("2026-11-02T22:00:00Z"), planData: { phases: [{ name: "Base" }] } })]);
    const { planPass } = await load();
    const r = await planPass("orphan", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([]);
    expect(r.skipped).toEqual([{ id: "mis_twin0006", reason: "ambiguous_title" }]);
  });
});

describe("notes scoping end to end", () => {
  it("T8 main hands the row's conversationId to the real chatSnippets reader", async () => {
    allFixtures();
    const seen: unknown[] = [];
    set("chatMessage", "findMany", async (a) => (seen.push(a.where.conversationId), [{ content: "told Dania the lease is signed" }]));
    await dryRunWithPlan();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => typeof c === "string")).toBe(true);
    expect(seen).toContain("conv_1");
  });

  it("T9 a backfill row with no conversationId is skipped, and no chat is read for it", async () => {
    set("relationshipLedger", "findMany", () => [
      { id: "led_noconv6", note: "interaction reported in chat (call)", metadata: { via: "backfill:conversation_digest" }, person: { name: "Dania", deletedAt: null } },
    ]);
    const snips = vi.fn(async () => ["told Dania the lease is signed"]);
    const { planPass } = await load();
    const r = await planPass("notes", { prisma: h.prisma as never, now: NOW, snippets: snips });
    expect(r.rows).toEqual([]);
    expect(r.skipped).toEqual([{ id: "led_noconv6", reason: "no_conversation" }]);
    expect(snips).not.toHaveBeenCalled();
  });

  it("T16 a row whose person is soft-deleted is skipped", async () => {
    set("relationshipLedger", "findMany", () => [
      { id: "led_delp0007", note: "interaction reported in chat (call)", metadata: { via: "backfill:conversation_digest", conversationId: "conv_1" }, person: { name: "Dania", deletedAt: new Date("2026-11-01T00:00:00Z") } },
    ]);
    const { planPass } = await load();
    const r = await planPass("notes", { prisma: h.prisma as never, now: NOW, snippets });
    expect(r.rows).toEqual([]);
    expect(r.skipped).toEqual([{ id: "led_delp0007", reason: "person_deleted" }]);
  });
});

// ── round 1 (manager rulings on d180583ba1): each test was red on that head, or under the mutant named ─────────

type MRow = { id: string; lifeGoalId: string | null; updatedBy: string | null; deletedAt: Date | null; status: string; updatedAt: Date };
/** A stateful Mission table: updateMany applies only when every where field still holds, like Postgres would. */
function missionTable(rows: Array<Partial<MRow> & { id: string }>, throwOn?: { id: string; err: Error }) {
  const table = new Map<string, MRow>(
    rows.map((r) => [r.id, { lifeGoalId: null, updatedBy: "user", deletedAt: null, status: "ACTIVE", updatedAt: new Date(T0), ...r }]),
  );
  const holds = (row: MRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const have = (row as unknown as Record<string, unknown>)[k];
      if (v instanceof Date) return have instanceof Date && have.getTime() === v.getTime();
      if (v && typeof v === "object" && "not" in v) return have !== (v as { not: unknown }).not;
      return have === v;
    });
  h.state.writeImpl = (model, method, args) => {
    if (model !== "mission" || method !== "updateMany") return { count: 1 };
    if (throwOn && args.where.id === throwOn.id) throw throwOn.err;
    const row = table.get(args.where.id);
    if (!row || !holds(row, args.where)) return { count: 0 };
    Object.assign(row, args.data, { updatedAt: new Date(row.updatedAt.getTime() + 1000) });
    return { count: 1 };
  };
  return table;
}
const link = (missionId: string, lifeGoalId: string, over: Record<string, unknown> = {}) => ({
  missionId,
  lifeGoalId,
  priorUpdatedBy: "user",
  basis: "embedding",
  score: 0.9,
  updatedAt: T0,
  ...over,
});
/** A plan file written by hand (the shape a dry run writes), and its token. */
async function handPlan(passes: Record<string, unknown[]>) {
  const { fileToken } = await import("@/lib/services/people/backfill-apply");
  const c = JSON.stringify({ job: "w13-backfill", generatedAt: NOW.toISOString(), passes });
  h.state.files.set(PLAN, c);
  return fileToken(c);
}
const receiptOf = (pass: string) => {
  const hit = [...h.state.files.entries()].find(([p]) => p.replace(/\\/g, "/").includes(`/.completion/backfill-${pass}-`));
  return hit ? { path: hit[0], body: hit[1], json: JSON.parse(hit[1]) } : null;
};
const goalsAndNoVectors = (...ids: string[]) => {
  set("lifeGoal", "findMany", () => ids.map((id) => goal(id, `goal ${id}`)));
  set("vectorEmbedding", "findMany", () => []);
};
const EXEC = { BACKFILL_EXECUTE: "1" };

describe("round 1 item 1: each link pass reverts only its own writes", () => {
  it("orphan links M, missions loses M; reverting the missions receipt leaves M linked, reverting the orphan receipt unlinks it", async () => {
    goalsAndNoVectors("goal_fit0001");
    const table = missionTable([{ id: "mis_both0001" }]);
    const token = await handPlan({
      orphan: [link("mis_both0001", "goal_fit0001", { basis: "exact_title", score: null })],
      missions: [link("mis_both0001", "goal_fit0001")],
    });
    const { main } = await load();
    const { fileToken } = await import("@/lib/services/people/backfill-apply");
    const q = quiet();
    await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW);
    expect(table.get("mis_both0001")).toMatchObject({ lifeGoalId: "goal_fit0001", updatedBy: "backfill:2026-11-03:orphan" });
    const missions = receiptOf("missions")!;
    const orphan = receiptOf("orphan")!;
    expect(missions.json).toMatchObject({ marker: "backfill:2026-11-03:missions", written: [], lost: [{ id: "mis_both0001" }] });
    expect(orphan.json).toMatchObject({ marker: "backfill:2026-11-03:orphan", written: ["mis_both0001"] });
    expect(await main(["--revert", missions.path, "--execute", "--token", fileToken(missions.body)], EXEC, NOW)).toBe(0);
    expect(table.get("mis_both0001")).toMatchObject({ lifeGoalId: "goal_fit0001" });
    expect(await main(["--revert", orphan.path, "--execute", "--token", fileToken(orphan.body)], EXEC, NOW)).toBe(0);
    const printed = q.printed();
    q.restore();
    expect(printed).toContain("revert · missions · reverted 0");
    expect(printed).toContain("revert · orphan · reverted 1");
    expect(table.get("mis_both0001")).toMatchObject({ lifeGoalId: null, updatedBy: "user" });
  });
});

describe("round 1 item 2: the mission write swaps on what the plan read", () => {
  it("a mission edited after the plan (updatedAt moved) or KILLED since is lost, never linked; the other is written", async () => {
    goalsAndNoVectors("goal_fit0001");
    const table = missionTable([
      { id: "mis_edit0001", updatedAt: new Date("2026-11-03T15:00:00Z") },
      { id: "mis_kill0002", status: "KILLED" },
      { id: "mis_okay0003" },
    ]);
    const token = await handPlan({ missions: [link("mis_edit0001", "goal_fit0001"), link("mis_kill0002", "goal_fit0001"), link("mis_okay0003", "goal_fit0001")] });
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(1);
    q.restore();
    expect(table.get("mis_edit0001")).toMatchObject({ lifeGoalId: null, updatedBy: "user" });
    expect(table.get("mis_kill0002")).toMatchObject({ lifeGoalId: null, updatedBy: "user" });
    expect(table.get("mis_okay0003")).toMatchObject({ lifeGoalId: "goal_fit0001" });
    expect(receiptOf("missions")!.json).toMatchObject({
      written: ["mis_okay0003"],
      lost: [
        { id: "mis_edit0001", reason: "swap_lost" },
        { id: "mis_kill0002", reason: "swap_lost" },
      ],
    });
  });

  it("a plan row without the updatedAt it read is refused before any connection", async () => {
    const { updatedAt: _dropped, ...noStamp } = link("mis_okay0003", "goal_fit0001");
    const token = await handPlan({ missions: [noStamp] });
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(2);
    q.restore();
    expect(writes()).toHaveLength(0);
  });
});

describe("round 1 item 3: a Prisma failure prints its code and cause, never its arguments", () => {
  it("empty first line, the args in the middle, the cause last", async () => {
    goalsAndNoVectors("goal_fit0001");
    const err = Object.assign(
      new Error(
        '\nInvalid `prisma.mission.updateMany()` invocation:\n\n{\n  where: { title: "Gym three times a week" }\n}\n\nTransaction already closed: the timeout for this transaction was 120000 ms.',
      ),
      { code: "P2028" },
    );
    missionTable([{ id: "mis_okay0003" }], { id: "mis_okay0003", err });
    const token = await handPlan({ missions: [link("mis_okay0003", "goal_fit0001")] });
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(1);
    const printed = q.printed();
    q.restore();
    expect(printed).toContain("failed: P2028 Transaction already closed: the timeout for this transaction was 120000 ms.");
    expect(printed).not.toContain("Gym");
  });
});

describe("round 1 item 4: a crash mid-loop leaves an honest receipt", () => {
  it("a throw on row 2 of 3: receipt status aborted, written = row 1, its path printed before the first write", async () => {
    goalsAndNoVectors("goal_fit0001");
    missionTable([{ id: "mis_row00001" }, { id: "mis_row00002" }, { id: "mis_row00003" }], { id: "mis_row00002", err: new Error("connection reset") });
    const token = await handPlan({ missions: ["mis_row00001", "mis_row00002", "mis_row00003"].map((id) => link(id, "goal_fit0001")) });
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(1);
    const printed = q.printed();
    q.restore();
    const r = receiptOf("missions")!;
    expect(r.json).toMatchObject({ status: "aborted", written: ["mis_row00001"] });
    expect(printed).toContain(r.path);
  });
});

describe("round 1 item 5: every lost row has its own reason", () => {
  it("a planned ledger row that is gone is lost as ledger_row_gone; the run exits 1", async () => {
    allFixtures();
    const token = await handPlan({ notes: [{ ledgerId: "led_gone0009", noteSha: "000000000000" }] });
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(1);
    q.restore();
    expect(receiptOf("notes")!.json).toMatchObject({ written: [], lost: [{ id: "led_gone0009", reason: "ledger_row_gone" }] });
    expect(rowWrites()).toHaveLength(0);
  });
});

describe("round 1 item 6: vector coverage is printed, and an unparsable vector is its own reason", () => {
  it("one unparsable goal vector: unparsable 1 in the coverage line, reason unparsable_vector (not no_comparable_embedding)", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]);
    set("mission", "findMany", () => [mission("mis_link0001", "Gym three times a week")]);
    set("vectorEmbedding", "findMany", () => [
      vrow("life_goal", "goal_fit0001", [1, 0]),
      { sourceType: "life_goal", sourceId: "goal_cash0002", embedding: "[0.1, 0.2", model: SPACE },
      vrow("mission", "mis_link0001", at(0.9)),
    ]);
    const { planPass } = await load();
    const r = await planPass("missions", { prisma: h.prisma as never, now: NOW });
    expect(r.decisions![0]).toMatchObject({ basis: "words", decision: "list", reason: "unparsable_vector" });
    expect(r.lines.join("\n")).toContain(`mission vectors 1/1 · goals with a vector in ${SPACE} 1/2 · unparsable 1`);
  });

  it("the execute prints the coverage line too", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--pass", "missions", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(0);
    const printed = q.printed();
    q.restore();
    expect(printed).toMatch(/mission vectors \d+\/\d+ · goals with a vector in/);
  });
});

describe("round 1 item 7: the goal is re-checked at execute", () => {
  it("a goal paused after the plan: its row is lost as goal_not_active and never written; the other row is", async () => {
    const goalArgs: any[] = [];
    set("lifeGoal", "findMany", (a) => (goalArgs.push(a), [goal("goal_fit0001", "Get fit")]));
    set("vectorEmbedding", "findMany", () => []);
    const table = missionTable([{ id: "mis_fit00001" }, { id: "mis_cash0002" }]);
    const token = await handPlan({ missions: [link("mis_fit00001", "goal_fit0001"), link("mis_cash0002", "goal_cash0002")] });
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], EXEC, NOW)).toBe(1);
    q.restore();
    expect(rowWrites().map((w) => w.args.where.id)).toEqual(["mis_fit00001"]);
    expect(table.get("mis_cash0002")).toMatchObject({ lifeGoalId: null });
    expect(receiptOf("missions")!.json).toMatchObject({ written: ["mis_fit00001"], lost: [{ id: "mis_cash0002", reason: "goal_not_active" }] });
    expect(goalArgs.some((a) => JSON.stringify(a.where) === JSON.stringify({ id: { in: ["goal_fit0001", "goal_cash0002"] }, status: "active", deletedAt: null }))).toBe(true);
  });
});

describe("round 1 item 8 (P3)", () => {
  it("8a an empty conversationId is a filter, not 'any chat'; noteFor refuses it as no_conversation", async () => {
    const findMany = vi.fn(async () => []);
    set("chatMessage", "findMany", findMany);
    const { chatSnippets } = await import("@/lib/brain/people-intelligence");
    await chatSnippets("Dania", 3, "");
    expect((findMany.mock.calls[0] as unknown as [any])[0].where).toMatchObject({ conversationId: "" });
    set("relationshipLedger", "findMany", () => [
      { id: "led_empty008", note: "interaction reported in chat (call)", metadata: { via: "backfill:conversation_digest", conversationId: "" }, person: { name: "Dania", deletedAt: null } },
    ]);
    const snips = vi.fn(async () => ["told Dania the lease is signed"]);
    const { planPass } = await load();
    const r = await planPass("notes", { prisma: h.prisma as never, now: NOW, snippets: snips });
    expect(r.skipped).toEqual([{ id: "led_empty008", reason: "no_conversation" }]);
    expect(snips).not.toHaveBeenCalled();
  });

  it("8b the orphan read excludes KILLED missions", async () => {
    const missionArgs: any[] = [];
    goalsAndNoVectors("goal_fit0001");
    set("mission", "findMany", (a) => (missionArgs.push(a), []));
    const { planPass } = await load();
    await planPass("orphan", { prisma: h.prisma as never, now: NOW });
    expect(missionArgs[0].where).toMatchObject({ deletedAt: null, lifeGoalId: null, status: { not: "KILLED" } });
  });

  it("8c a goal read that hits the cap prints a warning with the count and the cap", async () => {
    const { SUGGEST_GOAL_MAX_GOALS } = await import("@/lib/missions/goal-embedding");
    set("lifeGoal", "findMany", () => Array.from({ length: SUGGEST_GOAL_MAX_GOALS }, (_, i) => goal(`goal_n${i}`, `goal ${i}`)));
    set("vectorEmbedding", "findMany", () => []);
    set("mission", "findMany", () => []);
    const { planPass } = await load();
    const r = await planPass("missions", { prisma: h.prisma as never, now: NOW });
    expect(r.lines.join("\n")).toContain(`warning: read ${SUGGEST_GOAL_MAX_GOALS} active goals = the cap ${SUGGEST_GOAL_MAX_GOALS}`);
    // CONTROL: one under the cap prints no warning.
    set("lifeGoal", "findMany", () => Array.from({ length: SUGGEST_GOAL_MAX_GOALS - 1 }, (_, i) => goal(`goal_n${i}`, `goal ${i}`)));
    expect((await planPass("missions", { prisma: h.prisma as never, now: NOW })).lines.join("\n")).not.toContain("warning");
  });

  it("8d --out never overwrites a file that exists: refused, exit 2, the old file untouched", async () => {
    allFixtures();
    h.state.files.set(PLAN, "an older plan");
    const { main } = await load();
    const q = quiet();
    expect(await main(["--pass", "all", "--out", PLAN], {}, NOW)).toBe(2);
    const printed = q.printed();
    q.restore();
    expect(h.state.files.get(PLAN)).toBe("an older plan");
    expect(printed).toContain("already exists");
    expect(writes()).toHaveLength(0);
  });
});

describe("round 1 item 10: the orphan link paths and the no-vector fallback, from fixtures", () => {
  const orphanDay = { createdAt: new Date("2026-11-02T22:00:00Z"), planData: { phases: [{ name: "Base" }] } };

  it("orphan links by the goal id its phase-1 tasks carry", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]);
    set("vectorEmbedding", "findMany", () => []);
    set("mission", "findMany", () => [mission("mis_task0001", "Make money", { ...orphanDay, tasks: [{ phaseName: "Base", goalId: "goal_cash0002" }] })]);
    const { planPass } = await load();
    const r = await planPass("orphan", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([{ missionId: "mis_task0001", lifeGoalId: "goal_cash0002", priorUpdatedBy: "user", basis: "task_goal", score: null, updatedAt: T0 }]);
  });

  it("orphan links by embedding when no task goal and no exact title", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]);
    set("vectorEmbedding", "findMany", () => [
      vrow("life_goal", "goal_fit0001", [1, 0]),
      vrow("life_goal", "goal_cash0002", [0, 1]),
      vrow("mission", "mis_embd0002", at(0.9)),
    ]);
    set("mission", "findMany", () => [mission("mis_embd0002", "Lift on Mondays", { ...orphanDay, tasks: [{ phaseName: "Base", goalId: null }] })]);
    const { planPass } = await load();
    const r = await planPass("orphan", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([
      { missionId: "mis_embd0002", lifeGoalId: "goal_fit0001", priorUpdatedBy: "user", basis: "embedding", score: expect.closeTo(0.9, 5), updatedAt: T0 },
    ]);
  });

  it("a goal with no vector at all: word overlap for the whole rank, never a link", async () => {
    set("lifeGoal", "findMany", () => [goal("goal_fit0001", "Get fit"), goal("goal_cash0002", "Hit $15K revenue")]);
    set("vectorEmbedding", "findMany", () => [vrow("life_goal", "goal_fit0001", [1, 0]), vrow("mission", "mis_link0001", at(0.9))]);
    set("mission", "findMany", () => [mission("mis_link0001", "Get fit at the gym")]);
    const { planPass } = await load();
    const r = await planPass("missions", { prisma: h.prisma as never, now: NOW });
    expect(r.rows).toEqual([]);
    expect(r.decisions![0]).toMatchObject({ basis: "words", decision: "list", reason: "no_comparable_embedding" });
    expect(r.decisions![0].top[0].goalId).toBe("goal_fit0001");
  });
});
