/**
 * scripts/brain-hygiene/backfill-chat-distills.ts (brain backfill W1, 2026-10-30).
 * The write path against a recording fake Db and a fake distiller; the plan-mode network guard is
 * spawned in brain-hygiene-run.test.ts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { READ_SQL, spec } from "@/scripts/brain-hygiene/backfill-chat-distills";
import { APP_ROOT, fakeDb, normalize } from "./_lib/brain-hygiene-harness";

const DB_NOW = "2026-10-30 13:00:00";

function world(opts: { ids?: string[]; claimedLater?: string[]; landed?: (id: string) => boolean; cronWroteDuringRun?: string[] } = {}) {
  const ids = opts.ids ?? ["c1", "c2", "c3"];
  const claimed = new Set(opts.claimedLater ?? []);
  const cron = new Set(opts.cronWroteDuringRun ?? []);
  const distilled = new Set<string>();
  const w = fakeDb((sql, params) => {
    const s = normalize(sql);
    if (s.includes("FROM chat_conversations c")) return ids.map((id, i) => ({ id, updated_at: `2026-05-0${i + 1}` }));
    if (s.includes("AS db_now")) return [{ db_now: DB_NOW }];
    if (s.includes("chat_summary_rows")) return [{ any_rows: claimed.has(String(params[0])) ? 1 : 0 }];
    if (s.includes("chat_summary_landed")) {
      const id = String(params[0]);
      expect(params[1]).toBe(DB_NOW);
      const live = distilled.has(id) && (opts.landed ? opts.landed(id) : true);
      return live ? [{ id: `row-${id}`, ours: !cron.has(id) }] : [];
    }
    throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
  });
  const distill = vi.fn(async (id: string) => {
    distilled.add(id);
    return opts.landed && !opts.landed(id) ? null : { conversationId: id };
  });
  return { ...w, distill };
}

const run = (w: ReturnType<typeof world>, expect: number, log: string[] = []) =>
  spec.execute(w.db, { expect, today: "20261030", log: (s) => log.push(s) }, { distill: w.distill, pauseMs: 0 });

describe("read", () => {
  it("selects ids and dates only, never message or summary text, and counts every chat with no chat_summary row", async () => {
    const sql = normalize(READ_SQL);
    expect(sql).toContain("SELECT c.id, c.updated_at::text AS updated_at");
    expect(sql).not.toMatch(/content|raw_thoughts|title/i);
    expect(sql).toContain(">= 4");
    expect(sql).toContain("bm.category = 'chat_summary' AND bm.key = c.id");
    const w = world();
    const r = await spec.read(w.db);
    expect(r.count).toBe(3);
    expect(r.lines.join("\n")).toContain("c1,c2,c3");
  });
});

describe("execute", () => {
  it("distills each chat through the live writer, oldest first, and the rollback names exactly the row ids it wrote", async () => {
    const w = world();
    const log: string[] = [];
    expect(await run(w, 3, log)).toBe(0);
    expect(w.distill.mock.calls.map((c) => c[0])).toEqual(["c1", "c2", "c3"]);
    const out = log.join("\n");
    expect(out).toContain("landed 3 of 3");
    expect(out).toMatch(/ROLLBACK[\s\S]*SET deleted_at = now\(\)[\s\S]*id = ANY\('\{row-c1,row-c2,row-c3\}'::text\[\]\)/);
    expect(out).not.toMatch(/created_at >=/);
    expect(out).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("a row the nightly cron wrote for the same chat during the run is not counted as ours and stays out of the rollback", async () => {
    const w = world({ cronWroteDuringRun: ["c2"] });
    const log: string[] = [];
    expect(await run(w, 3, log)).toBe(0);
    const out = log.join("\n");
    expect(out).toContain("landed 2 of 3");
    expect(out).toContain("raced 1");
    expect(out).toContain("'{row-c1,row-c3}'");
    expect(out).not.toContain("row-c2");
  });

  it("a count that moved since --read aborts before any distill", async () => {
    const w = world({ ids: ["c1", "c2"] });
    expect(await run(w, 3)).toBe(1);
    expect(w.distill).not.toHaveBeenCalled();
  });

  it("a chat that gained a chat_summary row since --read is skipped, not distilled twice", async () => {
    const w = world({ claimedLater: ["c2"] });
    const log: string[] = [];
    expect(await run(w, 3, log)).toBe(0);
    expect(w.distill.mock.calls.map((c) => c[0])).toEqual(["c1", "c3"]);
    expect(log.join("\n")).toContain("skipped 1");
  });

  it("counts by the row that landed, not by the call returning; a miss exits non-zero", async () => {
    const w = world({ ids: ["c1", "c2", "c3", "c4"], landed: (id) => id !== "c3" });
    const log: string[] = [];
    expect(await run(w, 4, log)).toBe(1);
    expect(log.join("\n")).toContain("landed 3 of 4");
    expect(log.join("\n")).toContain("not landed: c3");
  });

  it("three misses in a row at the start stop the run (provider down), so nothing more is spent", async () => {
    const w = world({ ids: ["c1", "c2", "c3", "c4", "c5"], landed: () => false });
    const log: string[] = [];
    expect(await run(w, 5, log)).toBe(1);
    expect(w.distill).toHaveBeenCalledTimes(3);
    expect(log.join("\n")).toContain("ABORT");
  });

  it("no statement in the script removes a row", () => {
    const src = readFileSync(`${APP_ROOT}/scripts/brain-hygiene/backfill-chat-distills.ts`, "utf8");
    expect(src, "POSITIVE CONTROL: the scan sees the script's SQL").toContain("FROM chat_conversations c");
    expect(src).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+(TABLE|INDEX|COLUMN)\b|\bTRUNCATE\b/i);
  });
});

describe("the real writer loads under bare tsx (PR 3379 review: server-only threw on --execute)", () => {
  it("loadDistill imports lib/brain/session-distiller in a tsx child and returns the function, with no network", () => {
    // Every other test injects a fake distill, so only a child process with the real import can see this.
    const code =
      'import("./scripts/brain-hygiene/backfill-chat-distills.ts").then((m) => m.loadDistill())' +
      '.then((f) => { console.log("DISTILL_TYPE=" + typeof f); process.exit(0); })' +
      '.catch((e) => { console.log("LOAD_FAIL " + String(e && e.message).slice(0, 200)); process.exit(1); });';
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: "postgres://hygiene:secret-pw@invalid.invalid/x" };
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require ${join(APP_ROOT, "tests/scripts/_lib/no-network.cjs")}`.trim();
    const r = spawnSync(process.execPath, [join(APP_ROOT, "node_modules/tsx/dist/cli.mjs"), "--eval", code], {
      cwd: APP_ROOT,
      encoding: "utf8",
      env,
      timeout: 120_000,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).not.toContain("NETWORK_ATTEMPT");
    expect(out, out.slice(0, 600)).toContain("DISTILL_TYPE=function");
    expect(r.status).toBe(0);
  }, 150_000);
});
