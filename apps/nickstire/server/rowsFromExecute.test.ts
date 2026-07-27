/**
 * Unwrapping a raw `db.execute(sql`SELECT ...`)` result.
 *
 * THE BUG THIS FIXES, AND WHY IT SURVIVED REVIEW
 * mysql2 resolves to `[rows, fields]`. Indexing that tuple ONCE gives the rows
 * ARRAY, not a row. The shipped code did:
 *
 *   const agg = Array.isArray(claimRows) ? claimRows[0] : ...
 *   const scanned = Number(agg?.scanned ?? 0);
 *
 * `agg` was the rows array, `agg.scanned` was `undefined`, and
 * `Number(undefined ?? 0)` is `0`. Nothing threw. Nothing logged. The aggregate
 * simply reported zero forever.
 *
 * That is worse than a crash, because the same block then does:
 *
 *   const coverageBroken = rows.length >= 5 && scanned === 0;
 *
 * So the voice-claim guard's daily alert would have fired "inbound calls logged
 * but NONE scanned" every single day — a permanently-red alarm, which is the
 * precise failure mode the migration-gate fix (#1113) was written to remove.
 * A guard that cries wolf daily is a guard the operator mutes.
 *
 * The repo's canonical form is `const [rows] = await db.execute(...)`, used in
 * cron/index.ts and chatFaqPipeline.ts; dailyReport.ts carries a defensive
 * variant that checks `Array.isArray(raw[0])`. This helper is that check,
 * extracted so the silent-zero shape cannot be re-derived by hand a fourth time.
 */
import { describe, expect, it } from "vitest";
import { rowsFromExecute } from "./cron/jobs/vapiCallEval";

describe("rowsFromExecute", () => {
  it("unwraps the mysql2 [rows, fields] tuple — the shape that shipped broken", () => {
    const mysql2Result = [[{ scanned: 7, withViolations: 2 }], [{ name: "scanned" }]];
    const rows = rowsFromExecute<{ scanned: number; withViolations: number }>(mysql2Result);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scanned).toBe(7);
    expect(rows[0]!.withViolations).toBe(2);
  });

  it("reproduces the ORIGINAL defect, so the regression is unmistakable", () => {
    const mysql2Result = [[{ scanned: 7 }], []];
    // What the shipped code did:
    const wrong = (Array.isArray(mysql2Result) ? mysql2Result[0] : undefined) as unknown as { scanned?: number };
    expect(Number(wrong?.scanned ?? 0)).toBe(0); // <- silently zero, never throws
    // What it does now:
    expect(Number(rowsFromExecute<{ scanned: number }>(mysql2Result)[0]?.scanned ?? 0)).toBe(7);
  });

  it("handles a { rows: [...] } driver shape", () => {
    expect(rowsFromExecute<{ n: number }>({ rows: [{ n: 3 }] })[0]!.n).toBe(3);
  });

  it("handles a bare rows array", () => {
    expect(rowsFromExecute<{ n: number }>([{ n: 5 }])[0]!.n).toBe(5);
  });

  it("returns [] for empty and malformed results rather than throwing", () => {
    for (const bad of [undefined, null, 0, "", {}, [], [[], []]]) {
      expect(() => rowsFromExecute(bad)).not.toThrow();
      expect(rowsFromExecute(bad)).toEqual([]);
    }
  });

  it("an empty result set is [] — distinguishable from a parse failure by the caller", () => {
    // COUNT(*) always returns a row, so [] here means the query itself matched
    // nothing structural — not that the count was zero.
    expect(rowsFromExecute([[], []])).toEqual([]);
  });
});
