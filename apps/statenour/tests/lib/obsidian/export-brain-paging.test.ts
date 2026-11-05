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
import { judgeExportRun } from "@/lib/obsidian/export-verdict";

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
  dropOnPageFetch: new Set<string>(),
  statusThrows: false,
  seedStatus: null as any,
  exitCode: undefined as number | string | undefined,
  warn: null as any,
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
    return h.rows.filter((r) => wanted.has(r.id) && !h.dropOnPageFetch.has(r.id));
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
  readEngineStatus: () => h.seedStatus,
  writeEngineStatus: async (s: any) => {
    if (h.statusThrows) throw new Error("status write failed");
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
  // the script sets process.exitCode on a shortfall; record it and clear it so the test worker itself does not exit non-zero
  h.exitCode = process.exitCode as any;
  process.exitCode = undefined;
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
  h.dropOnPageFetch = new Set();
  h.statusThrows = false;
  h.seedStatus = null;
  h.exitCode = undefined;
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  h.warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      ...makeRows("archive_document", 3), // reaches a page since 2026-11-05
      ...makeRows("GMAIL_THREAD", 2), // reaches a page since 2026-11-05
      ...makeRows("morning_brief_audio", 4), // still excluded category
      ...makeRows("misc", 2, 0, "obsidian_"), // excluded key prefix: came from the vault
    ];

    const status = await runExport();
    const snap = snapshot();

    expect(keyCount(snap)).toBe(big + 30 + 3 + 2);
    expect(Object.keys(snap).sort()).toEqual([
      "ARCHIVE_DOCUMENT.md",
      "GMAIL_THREAD.md",
      "INSIGHT.md",
      "INSIGHT_PART_002.md",
      "NICK_ADVICE.md",
    ]);
    expect(Object.values(snap).join("\n")).not.toContain("## Key: obsidian_");
    expect(Object.values(snap).join("\n")).not.toContain("morning_brief_audio_k");
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
    const status = await runExport();
    expect(snapshot()).toEqual(first);
    expect(status.health).toBe("healthy");
    expect(status.stats.failed).toBe(0);
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
    expect(h.exitCode).toBe(1);
    // nothing was pruned: the stale page is still there and untouched
    expect(snapshot()["INSIGHT_PART_003.md"]).toBe(before["INSIGHT_PART_003.md"]);
  });

  it("fails against the scan snapshot too: rows added after the count must not forgive a failed page", async () => {
    h.rows = makeRows("insight", 30);
    h.countOverride = 25; // stale-low count taken before 5 rows arrived
    h.dropOnPageFetch = new Set([h.rows[0].id, h.rows[1].id, h.rows[2].id]); // 3 rows vanish before their page is read
    const status = await runExport();
    // 27 exported >= 25 live, but 27 < 30 scanned
    expect(status.health).toBe("error");
    expect(h.exitCode).toBe(1);
  });

  it("exits non-zero on a shortfall even when the status write fails, and stays 0 on a clean run", async () => {
    h.rows = makeRows("insight", 30);
    await runExport();
    expect(h.exitCode).toBeUndefined();

    h.countOverride = 31;
    h.statusThrows = true;
    await runExport();
    expect(h.exitCode).toBe(1);
  });

  it("keeps a conflicted middle page, still writes the other pages, and fails the run", async () => {
    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE * 2 + 10);
    await runExport();
    const middle = path.join(memoriesDir(), "INSIGHT_PART_002.md");
    const edited = fs.readFileSync(middle, "utf-8") + "\nhand edit\n"; // body changed, stored hash untouched
    fs.writeFileSync(middle, edited);

    h.rows = [...h.rows, ...makeRows("insight", 5, ROLLUP_PAGE_SIZE * 2 + 10)];
    const status = await runExport();
    const snap = snapshot();

    expect(status.health).toBe("error");
    expect(h.exitCode).toBe(1);
    expect(snap["INSIGHT_PART_002.md"]).toBe(edited);
    expect(Object.keys(snap)).toContain("INSIGHT_PART_003.md");
    expect((snap["INSIGHT_PART_003.md"].match(/^## Key: /gm) ?? []).length).toBe(15);
  });

  it("publishes lastExportCount, the memories exported this run, in the status row", async () => {
    h.rows = [...makeRows("insight", ROLLUP_PAGE_SIZE + 5), ...makeRows("archive_document", 7)];
    const status = await runExport();
    expect(status.lastExportCount).toBe(ROLLUP_PAGE_SIZE + 12);
    expect(typeof status.lastExportCount).toBe("number");
  });

  it("pins the page size", () => {
    expect(ROLLUP_PAGE_SIZE).toBe(200);
  });

  it.each([199, 200, 201, 400, 401])("%i rows in one category: exact files, every key once, no empty trailing page", async (n) => {
    h.rows = makeRows("insight", n);
    const status = await runExport();
    const snap = snapshot();
    const pages = Math.ceil(n / 200);
    const expected = Array.from({ length: pages }, (_, i) => (i === 0 ? "INSIGHT.md" : `INSIGHT_PART_${String(i + 1).padStart(3, "0")}.md`));

    expect(Object.keys(snap).sort()).toEqual(expected.sort());
    expect(keyCount(snap)).toBe(n);
    for (const body of Object.values(snap)) expect((body.match(/^## Key: /gm) ?? []).length).toBeGreaterThan(0);
    expect(status.health).toBe("healthy");
    expect(h.exitCode).toBeUndefined();
  });

  it("when every memory is gone, a rerun is healthy and removes all part pages", async () => {
    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE * 2 + 10);
    await runExport();
    h.rows = [];
    const status = await runExport();
    expect(status.health).toBe("healthy");
    expect(status.stats.failed).toBe(0);
    expect(Object.keys(snapshot()).filter((f) => f.includes("_PART_"))).toEqual([]);
  });

  it("keeps a hand-edited stale page, logs its name, and does not fail the run", async () => {
    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE * 2 + 10);
    await runExport();
    const stale = path.join(memoriesDir(), "INSIGHT_PART_003.md");
    const edited = fs.readFileSync(stale, "utf-8") + "\nhand edit\n";
    fs.writeFileSync(stale, edited);

    h.rows = makeRows("insight", ROLLUP_PAGE_SIZE + 10);
    const status = await runExport();

    expect(fs.readFileSync(stale, "utf-8")).toBe(edited);
    expect(Object.keys(snapshot()).sort()).toEqual(["INSIGHT.md", "INSIGHT_PART_002.md", "INSIGHT_PART_003.md"]);
    expect(h.warn.mock.calls.flat().join(" ")).toContain("INSIGHT_PART_003.md");
    expect(status.health).toBe("healthy");
  });
});

describe("verified wrapper decision judges this run, not an inherited status", () => {
  const sticky = (issues: any[] = []) => ({
    health: "error",
    lastRunAt: "2026-11-01T00:00:00.000Z",
    lastDoctorRunAt: null,
    lastIngestRunAt: null,
    lastExportRunAt: "2026-11-01T00:00:00.000Z",
    stats: { totalNotes: 1, processed: 1, synced: 1, skipped: 0, failed: 0, quarantined: 0, warnings: 0, failures: 6 },
    issues,
    quarantinedFiles: [],
    config: {},
  });

  it("a clean export succeeds even though the older status said error, and the old error flag clears", async () => {
    h.seedStatus = sticky();
    h.rows = makeRows("insight", 30);
    const startedAt = Date.now();
    const status = await runExport();
    expect(status.health).toBe("healthy");
    expect(judgeExportRun(status, startedAt)).toEqual({ ok: true });
  });

  it("a genuine doctor failure stays in the status file but does not fail a clean export", async () => {
    const doctorFail = { type: "FAIL", message: "doctor: sample failure", detected_at: "2026-11-01T00:00:00.000Z" };
    h.seedStatus = sticky([doctorFail]);
    h.rows = makeRows("insight", 30);
    const startedAt = Date.now();
    const status = await runExport();
    expect(status.health).toBe("error");
    expect(status.issues.some((i: any) => i.type === "FAIL")).toBe(true);
    expect(judgeExportRun(status, startedAt)).toEqual({ ok: true });
  });

  it("a real shortfall fails the decision", async () => {
    h.seedStatus = sticky();
    h.rows = makeRows("insight", 30);
    h.countOverride = 31;
    const startedAt = Date.now();
    const status = await runExport();
    expect(judgeExportRun(status, startedAt).ok).toBe(false);
  });

  it("a status that predates this run is not a completion", () => {
    const old = sticky();
    old.health = "healthy";
    expect(judgeExportRun(old as any, Date.now()).ok).toBe(false);
  });
});
