/**
 * scripts/brain-hygiene/backfill-chat-distills.ts (brain backfill W1, 2026-10-30).
 * The write path against a recording fake Db and a fake distiller; the plan-mode network guard is
 * spawned in brain-hygiene-run.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { READ_SQL, spec } from "@/scripts/brain-hygiene/backfill-chat-distills";
import { APP_ROOT, fakeDb, normalize } from "./_lib/brain-hygiene-harness";

function world(opts: { ids?: string[]; claimedLater?: string[]; landed?: (id: string) => boolean } = {}) {
  const ids = opts.ids ?? ["c1", "c2", "c3"];
  const claimed = new Set(opts.claimedLater ?? []);
  const distilled = new Set<string>();
  const w = fakeDb((sql, params) => {
    const s = normalize(sql);
    if (s.includes("FROM chat_conversations c")) return ids.map((id, i) => ({ id, updated_at: `2026-05-0${i + 1}` }));
    if (s.includes("chat_summary_rows")) {
      const id = String(params[0]);
      const live = distilled.has(id) && (opts.landed ? opts.landed(id) : true);
      return [{ any_rows: claimed.has(id) || live ? 1 : 0, live_rows: live ? 1 : 0 }];
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
  it("distills each chat through the live writer, oldest first, and prints a soft-delete rollback for exactly those ids", async () => {
    const w = world();
    const log: string[] = [];
    expect(await run(w, 3, log)).toBe(0);
    expect(w.distill.mock.calls.map((c) => c[0])).toEqual(["c1", "c2", "c3"]);
    const out = log.join("\n");
    expect(out).toContain("landed 3 of 3");
    expect(out).toMatch(/ROLLBACK[\s\S]*SET deleted_at = now\(\)[\s\S]*category = 'chat_summary'[\s\S]*'\{c1,c2,c3\}'/);
    expect(out).not.toMatch(/\bDELETE\s+FROM\b/i);
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
