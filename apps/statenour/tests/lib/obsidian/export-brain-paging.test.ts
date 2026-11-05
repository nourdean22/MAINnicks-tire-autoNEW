/**
 * Drives the REAL scripts/export-brain-to-obsidian.ts against a fake Prisma and
 * a temp vault (no database, no real vault). Rollup mode used to keep only the
 * newest 100 memories per category; every memory must now land in a paged note,
 * a rerun must converge on the same files, and an exported-vs-live shortfall
 * must fail the run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLLUP_PAGE_SIZE } from "@/lib/obsidian/memory-rollup";
import { buildNoteContent } from "@/lib/obsidian/note-writer";

type Row = {
  id: string;
  key: string;
  category: string;
  content: string;
  confidence: number;
  metadata: unknown;
  createdAt: Date;
  deletedAt: Date | null;
};

const h = vi.hoisted(() => ({
  vault: "",
  rows: [] as Row[],
  countOverride: null as number | null,
  statuses: [] as any[],
  finished: null as null | (() => void),
}));

function matchesNot(row: Row, where: any): boolean {
  const conds: any[] = where?.NOT?.OR ?? [];
  return conds.some(
    (c) => (c.key?.startsWith && row.key.startsWith(c.key.startsWith)) || (typeof c.category === "string" && row.category === c.category),
  );
}

function filtered(where: any): Row[] {
  if (where?.id?.in) {
    const wanted = new Set<string>(where.id.in);
    return h.rows.filter((r) => wanted.has(r.id));
  }
  return h.rows.filter((r) => r.deletedAt === null && !matchesNot(r, where));
}

function sorted(rows: Row[], orderBy: Array<Record<string, "asc" | "desc">> = []): Row[] {
  const out = [...rows];
  out.sort((a, b) => {
    for (const o of orderBy) {
      const [field, dir] = Object.entries(o)[0];
      const av = field === "createdAt" ? a.createdAt.getTime() : (a as any)[field];
      const bv = field === "createdAt" ? b.createdAt.getTime() : (b as any)[field];
      if (av === bv) continue;
      return (av < bv ? -1 : 1) * (dir === "asc" ? 1 : -1);
    }
    return 0;
  });
  return out;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findMany: async () => [] },
    mission: { findMany: async () => [] },
    reflection: { findMany: async () => [] },
    brainMemory: {
      findMany: async (args: any) => {
        const rows = sorted(filtered(args.where), args.orderBy);
        return args.select ? rows.map((r) => ({ id: r.id, category: r.category })) : rows;
      },
      count: async (args: any) => h.countOverride ?? filtered(args.where).length,
    },
    $disconnect: async () => {
      h.finished?.();
    },
  },
}));

vi.mock("@/lib/obsidian/engine-config", () => ({
  getObsidianEngineConfig: () => ({
    vaultPath: h.vault,
    icloudShortcutsPath: "",
    syncMode: "none",
    restUrl: "",
    restToken: "",
  }),
  readEngineStatus: () => null,
  writeEngineStatus: async (s: any) => {
    h.statuses.push(s);
  },
}));

const BASE = Date.UTC(2026, 0, 1);
function makeRows(category: string, count: number, startIndex = 0, keyPrefix = category): Row[] {
  return Array.from({ length: count }, (_, i) => {
    const n = startIndex + i;
    return {
      id: `${category}-${String(n).padStart(6, "0")}`,
      key: `${keyPrefix}_k${n}`,
      category,
      content: `content ${n} of ${category}`,
      confidence: 0.5,
      metadata: null,
      createdAt: new Date(BASE + n * 60_000),
      deletedAt: null,
    };
  });
}

async function runExport(): Promise<any> {
  vi.resetModules();
  h.statuses = [];
  const done = new Promise<void>((resolve) => {
    h.finished = resolve;
  });
  vi.spyOn(process, "exit").mockImplementation((() => {
    h.finished?.();
    return undefined as never;
  }) as any);
  process.argv = ["node", "export-brain-to-obsidian.ts"];
  await import("../../../scripts/export-brain-to-obsidian");
  await done;
  return h.statuses[h.statuses.length - 1];
}

function memoriesDir(): string {
  return path.join(h.vault, "Statenour", "Memories");
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(memoriesDir()).sort()) {
    const p = path.join(memoriesDir(), f);
    if (fs.statSync(p).isFile()) out[f] = fs.readFileSync(p, "utf-8");
  }
  return out;
}

function keyCount(snap: Record<string, string>): number {
  return Object.values(snap).reduce((n, body) => n + (body.match(/^## Key: /gm)?.length ?? 0), 0);
}

beforeEach(() => {
  h.vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-paging-"));
  h.rows = [];
  h.countOverride = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(h.vault, { recursive: true, force: true });
});

describe("export-brain-to-obsidian rollup paging", () => {
  it("writes every live memory of a category larger than one page, and still honours the exclusion filter", async () => {
    const big = Math.floor(ROLLUP_PAGE_SIZE * 1.25);
    h.rows = [
      ...makeRows("insight", big),
      ...makeRows("nick_advice", 30),
      ...makeRows("gmail_thread", 5), // excluded category
      ...makeRows("misc", 2, 0, "obsidian"), // excluded key prefix
    ];

    const status = await runExport();
    const snap = snapshot();

    expect(keyCount(snap)).toBe(big + 30);
    expect(Object.keys(snap).sort()).toEqual(["INSIGHT.md", "INSIGHT_PART_002.md", "NICK_ADVICE.md"]);
    expect(status.health).toBe("healthy");
    expect(status.stats.failed).toBe(0);
  });

  it("keeps categories whose names collapse to the same filename instead of overwriting one with the other", async () => {
    h.rows = [...makeRows("deal-note", 3), ...makeRows("deal_note", 4)];
    await runExport();
    expect(keyCount(snapshot())).toBe(7);
  });

  it("a rerun with no new data rewrites nothing and adds no files", async () => {
    h.rows = [...makeRows("insight", ROLLUP_PAGE_SIZE + 10), ...makeRows("nick_advice", 5)];
    await runExport();
    const first = snapshot();
    await runExport();
    expect(snapshot()).toEqual(first);
  });

  it("new memories only change the last page of a category, earlier pages stay byte-identical", async () => {
    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE * 2 + 10);
    await runExport();
    const first = snapshot();
    h.rows = [...h.rows, ...makeRows("insight", 5, ROLLUP_PAGE_SIZE * 2 + 10)];
    await runExport();
    const second = snapshot();

    expect(second["INSIGHT.md"]).toBe(first["INSIGHT.md"]);
    expect(second["INSIGHT_PART_002.md"]).toBe(first["INSIGHT_PART_002.md"]);
    expect(second["INSIGHT_PART_003.md"]).not.toBe(first["INSIGHT_PART_003.md"]);
    expect(keyCount(second)).toBe(ROLLUP_PAGE_SIZE * 2 + 15);
  });

  it("a rerun removes pages the data no longer fills, and only our own rollup pages", async () => {
    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE * 2 + 10);
    await runExport();
    expect(Object.keys(snapshot())).toContain("INSIGHT_PART_003.md");

    // a note a person wrote that happens to look like a page name, and a stray non-page file
    fs.writeFileSync(path.join(memoriesDir(), "TODO_PART_001.md"), "my own note, no frontmatter\n");
    fs.writeFileSync(path.join(memoriesDir(), "readme.md"), "keep\n");
    // an orphaned page of a category that no longer exists, written by an earlier export
    const orphan = buildNoteContent({ title: "old", type: "memory_rollup", category: "gone" }, "# old\n").content;
    fs.writeFileSync(path.join(memoriesDir(), "GONE_PART_002.md"), orphan);

    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE + 10);
    const status = await runExport();
    const names = Object.keys(snapshot()).sort();

    expect(names).toEqual(["INSIGHT.md", "INSIGHT_PART_002.md", "TODO_PART_001.md", "readme.md"]);
    expect(keyCount(snapshot())).toBe(ROLLUP_PAGE_SIZE + 10);
    expect(status.health).toBe("healthy");
  });

  it("fails the run, and prunes nothing, when fewer memories were exported than are live", async () => {
    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE * 2 + 10);
    await runExport();
    const before = snapshot();

    h.rows = makeRows("insight", 20);
    h.countOverride = 25; // the database says 25 are live, only 20 can be read
    const status = await runExport();

    expect(status.health).toBe("error");
    expect(status.stats.failed).toBeGreaterThan(0);
    expect(Object.keys(snapshot())).toContain("INSIGHT_PART_003.md");
    expect(before["INSIGHT_PART_003.md"]).toBeDefined();
  });
});
