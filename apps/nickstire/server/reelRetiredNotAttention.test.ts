/**
 * F6 follow-up (2026-10-17) · a reel retired automatically is CLOSED: operator decision
 * 2026-10-13 (3). It must not count as "needs attention" in the admin list or the
 * held-reels badge, which share buildAttentionPredicate. An ordinary failure still does.
 *
 * Behavioural, not a string check: the REAL predicate is rendered by drizzle's MySQL
 * dialect and evaluated against rows by a small translator for the operators it uses
 * (in, =, >=, is null, not, like, and, or). The translator is positive-controlled on
 * an existing marker and on an unmarked failure, so a broken translator cannot pass.
 */
import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { buildAttentionPredicate } from "./services/reelRecoverability";

type Row = { status: string; error: string | null; updatedAt: string };

function LIKE(v: unknown, pat: unknown): boolean {
  if (v === null || v === undefined) return false;
  const re = String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${re}$`, "s").test(String(v));
}

async function needsAttention(): Promise<(r: Row) => boolean> {
  const { sql, params } = new MySqlDialect().sqlToQuery(await buildAttentionPredicate());
  let i = 0;
  let js = sql.replace(/\?/g, () => `P[${i++}]`);
  js = js
    .replace(/`reel_jobs`\.`(\w+)`/g, 'r["$1"]')
    .replace(/(r\["\w+"\]) in \(([^)]*)\)/g, "[$2].includes($1)")
    .replace(/(r\["\w+"\]) like (P\[\d+\])/g, "LIKE($1, $2)")
    .replace(/(r\["\w+"\]) is null/g, "($1 == null)")
    .replace(/ = /g, " === ")
    .replace(/\bnot /g, "!")
    .replace(/ and /g, " && ")
    .replace(/ or /g, " || ");
  expect(js, `untranslated SQL left: ${js}`).not.toMatch(/`|\b(in|like|is|not|and|or)\b/); // SQL keywords are lowercase; LIKE( is the helper
  const P = params.map((p) => (p instanceof Date ? p.toISOString() : p));
  const fn = new Function("r", "P", "LIKE", `return ${js};`) as (r: Row, p: unknown[], l: typeof LIKE) => boolean;
  return (r) => Boolean(fn(r, P, LIKE));
}

const recent = "9999-12-31T00:00:00.000Z"; // inside the failed-attention window, whatever the clock says

describe("buildAttentionPredicate: retired reels are closed", () => {
  it("POSITIVE CONTROL: an unmarked recent failure needs attention; an operator-discarded one does not", async () => {
    const attention = await needsAttention();
    expect(attention({ status: "failed", error: "Kling: generation failed", updatedAt: recent })).toBe(true);
    expect(attention({ status: "failed", error: null, updatedAt: recent })).toBe(true);
    expect(attention({ status: "failed", error: "discarded by operator: wrong topic", updatedAt: recent })).toBe(false);
  });

  it("a row retired automatically (F6) is not counted as needing attention", async () => {
    const attention = await needsAttention();
    expect(attention({
      status: "failed",
      error: "retired automatically: parked on needs_review since 2026-10-01T09:00:00.000Z (parked longer than 7 days); the drain never reads it again. Operator decision 2026-10-13 (F6).",
      updatedAt: recent,
    })).toBe(false);
  });

  it("the marker matches the exact text retireParkedReels writes", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const cron = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
    expect(cron).toContain("const reason = `retired automatically: parked on ${p.gate}");
  });
});
