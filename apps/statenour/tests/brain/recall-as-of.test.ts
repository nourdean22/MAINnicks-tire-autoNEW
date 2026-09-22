/**
 * tests/brain/recall-as-of.test.ts · 2026-09-08 (program U3, review on #2198)
 *
 * Correctable memory, second half: the corrected fact wins the CURRENT
 * query (validUntil / supersededById filtering, #2177), and a query with a
 * date returns the OLD fact. `validityWhere` (prisma), `isVisibleAsOf` (a
 * loaded row) and `validitySql` (the raw-SQL lanes) are one predicate in
 * three shapes; this file pins them together and pins every lane to them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validityWhere, isVisibleAsOf, validitySql } from "@/lib/brain/contextual-recall";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const d = (s: string) => new Date(s);

// The review's scenario: a belief held since July, corrected on Aug 15.
const oldBelief = { createdAt: d("2026-07-01T00:00:00Z"), validFrom: null, validUntil: d("2026-08-15T00:00:00Z"), supersededById: "mem_new" };
const correction = { createdAt: d("2026-08-15T00:00:00Z"), validFrom: d("2026-08-15T00:00:00Z"), validUntil: null, supersededById: null };
// A backdated snapshot saved later: "in the second half of July the plan was X".
const backdated = { createdAt: d("2026-08-20T00:00:00Z"), validFrom: d("2026-07-15T00:00:00Z"), validUntil: d("2026-08-01T00:00:00Z"), supersededById: null };
const AUG_1 = d("2026-08-01T00:00:00Z");

describe("isVisibleAsOf (the predicate itself)", () => {
  it("now: the superseded belief is out, the correction is in, the closed snapshot is out", () => {
    expect(isVisibleAsOf(oldBelief)).toBe(false);
    expect(isVisibleAsOf(correction)).toBe(true);
    expect(isVisibleAsOf(backdated)).toBe(false);
  });
  it("as of Aug 1: the OLD belief is the answer even though it is superseded now; the correction does not exist yet", () => {
    expect(isVisibleAsOf(oldBelief, AUG_1)).toBe(true);
    expect(isVisibleAsOf(correction, AUG_1)).toBe(false);
  });
  it("a backdated row is visible inside its interval (validFrom wins over createdAt) and invisible outside it", () => {
    expect(isVisibleAsOf(backdated, d("2026-07-20T00:00:00Z"))).toBe(true);
    expect(isVisibleAsOf(backdated, d("2026-07-14T23:59:59Z"))).toBe(false);
    expect(isVisibleAsOf(backdated, AUG_1)).toBe(false); // validUntil == asOf → ended (strict >)
  });
  it("a row saved after asOf with no validFrom is out", () => {
    expect(isVisibleAsOf({ createdAt: d("2026-08-02T00:00:00Z"), validFrom: null, validUntil: null }, AUG_1)).toBe(false);
  });
});

describe("validityWhere (prisma shape) says the same thing", () => {
  it("now: supersededById null + validUntil window, no interval clauses", () => {
    const before = Date.now();
    const w = validityWhere() as any;
    expect(w.supersededById).toBeNull();
    expect(w.OR[0]).toEqual({ validUntil: null });
    expect(w.OR[1].validUntil.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(w.AND).toBeUndefined();
  });
  it("as of: NO supersession clause; interval covers the instant via validFrom-else-createdAt and validUntil", () => {
    const w = validityWhere(AUG_1) as any;
    expect("supersededById" in w).toBe(false);
    expect(w.AND).toEqual([
      { OR: [{ validFrom: { lte: AUG_1 } }, { validFrom: null, createdAt: { lte: AUG_1 } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: AUG_1 } }] },
    ]);
  });
});

describe("validitySql (raw-SQL shape) says the same thing", () => {
  it("now: supersession + NOW() window, aliased or bare", () => {
    expect(validitySql("bm", null)).toBe("bm.superseded_by_id IS NULL AND (bm.valid_until IS NULL OR bm.valid_until > NOW())");
    expect(validitySql("", null)).toBe("superseded_by_id IS NULL AND (valid_until IS NULL OR valid_until > NOW())");
  });
  it("as of: no supersession, the interval, every bound on the same parameter", () => {
    const sql = validitySql("bm", "$2");
    expect(sql).not.toMatch(/superseded_by_id/);
    expect(sql).not.toMatch(/NOW\(\)/);
    expect(sql).toBe(
      "((bm.valid_from IS NOT NULL AND bm.valid_from <= $2) OR (bm.valid_from IS NULL AND bm.created_at <= $2)) AND (bm.valid_until IS NULL OR bm.valid_until > $2)",
    );
  });
});

describe("every recall lane reads the same window", () => {
  const src = read("lib/brain/contextual-recall.ts");
  it("the prisma pool, the fallback and the graph lane spread validityWhere; no inline copy is left", () => {
    expect(src.match(/\.\.\.validityWhere\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).not.toMatch(/OR: \[\{ validUntil: null \}, \{ validUntil: \{ gt: new Date\(\) \} \}\],\n\s*\},\n\s*orderBy/);
  });
  it("the lexical and KNN SQL lanes take asOf, use validitySql, and bind the parameter only in as-of mode", () => {
    expect(src).toMatch(/getLexicalMatches\(topics: string\[\], limit = 50, asOf\?: Date\)/);
    expect(src).toMatch(/getKnnPoolRows\(queryVec: number\[\], limit = 50, asOf\?: Date\)/);
    // The lexical lane binds asOf as $2. The KNN lane binds it as $3 since
    // 2026-09-22: its $2 is the recall-quarantine category array
    // (`bm.category <> ALL($2::text[])`, see recall-knn-pool-iterative.test.ts).
    expect(src.match(/validitySql\("bm", asOf \? "\$2" : null\)/g)?.length).toBe(1);
    expect(src.match(/validitySql\("bm", asOf \? "\$3" : null\)/g)?.length).toBe(1);
    expect(src.match(/\.\.\.\(asOf \? \[asOf\] : \[\]\)/g)?.length).toBe(2);
    // the only inline copy of the predicate left is the helper's own template
    expect(src.match(/superseded_by_id IS NULL/g)?.length).toBe(1);
  });
  it("the recall entry point passes opts.asOf to both SQL lanes", () => {
    expect(src).toMatch(/getLexicalMatches\(topics, 50, opts\.asOf\)/);
    expect(src).toMatch(/getKnnPoolRows\(opts\.queryEmbedding!, 50, opts\.asOf\)/);
  });
  it("the searchMemories tool accepts asOf and bounds both its FTS SQL and its prisma where by it", () => {
    const b = read("lib/ai/tools/brain.ts");
    expect(b).toMatch(/asOf: z\s*\.string\(\)/);
    expect(b).toMatch(/validitySql\("", asOfDate \? "\$4" : null\)/);
    expect(b).toMatch(/\.\.\.\(asOfDate \? \[asOfDate\] : \[\]\)/);
    expect(b).toMatch(/validityWhere\(asOfDate\)/);
    expect(b).not.toMatch(/created_at <= \$4/);
  });
});
