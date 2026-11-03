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
    files: new Map<string, string>(),
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
    $queryRawUnsafe: async (sql: string) => [{ n: state.backupShort && sql.includes("_bak_") ? 6 : 7 }],
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
  return { prisma: h.prisma };
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
  planData: null,
  tasks: [],
  ...over,
});

beforeEach(() => {
  h.state.fixtures = {};
  h.state.log = [];
  h.state.lost = new Set();
  h.state.backupShort = false;
  h.state.files = new Map();
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
      { missionId: "mis_link0001", lifeGoalId: "goal_fit0001", priorUpdatedBy: "user", basis: "embedding", score: expect.closeTo(0.9, 5) },
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
    expect(byId.mis_oldv0006).toMatchObject({ basis: "words", decision: "list", reason: "no_comparable_embedding" });
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
    const { main, MARKER, NOTE_MARKER } = await load();
    const q = quiet();
    expect(await main(["--execute", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    const printed = q.printed();
    q.restore();
    expect(rowWrites().map((w) => [w.model, w.args])).toEqual([
      [
        "mission",
        { where: { id: "mis_link0001", lifeGoalId: null, deletedAt: null }, data: { lifeGoalId: "goal_fit0001", updatedBy: MARKER } },
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

  it("a row changed since the plan is reported lost, never forced", async () => {
    allFixtures();
    const token = await dryRunWithPlan();
    h.state.lost.add("mis_link0001");
    const { main } = await load();
    const q = quiet();
    expect(await main(["--execute", "--pass", "missions", "--plan-file", PLAN, "--token", token], { BACKFILL_EXECUTE: "1" }, NOW)).toBe(0);
    q.restore();
    const receipt = JSON.parse([...h.state.files.entries()].find(([p]) => p.includes("backfill-missions"))![1]);
    expect(receipt).toMatchObject({ pass: "missions", status: "applied", written: [], lost: [{ id: "mis_link0001", reason: "changed_since_read" }] });
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
    const { main, MARKER, NOTE_MARKER } = await load();
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
      ["mission", { where: { id: "mis_link0001", lifeGoalId: "goal_fit0001", updatedBy: MARKER }, data: { lifeGoalId: null, updatedBy: "user" } }],
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
