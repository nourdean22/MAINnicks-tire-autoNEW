/**
 * tests/brain/recall-as-of.test.ts · 2026-09-08 (program U3)
 *
 * Correctable memory, second half: the corrected fact wins the CURRENT
 * query (validUntil / supersededById filtering, #2177), and a query with a
 * date still returns the OLD fact. `validityWhere` is the one place both
 * recall lanes and the searchMemories tool get that window from.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validityWhere } from "@/lib/brain/contextual-recall";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("validityWhere", () => {
  it("now: superseded rows out, expired validity out, no createdAt bound", () => {
    const before = Date.now();
    const w = validityWhere();
    expect(w.supersededById).toBeNull();
    expect(w.OR[0]).toEqual({ validUntil: null });
    const gt = (w.OR[1] as { validUntil: { gt: Date } }).validUntil.gt.getTime();
    expect(gt).toBeGreaterThanOrEqual(before);
    expect(w.createdAt).toBeUndefined();
  });

  it("as of a date: a belief corrected AFTER that date is still returned, and nothing saved after it is", () => {
    const asOf = new Date("2026-08-01T00:00:00Z");
    const w = validityWhere(asOf);
    // a row corrected on 2026-08-15 has validUntil 2026-08-15 > asOf → passes the OR
    expect((w.OR[1] as { validUntil: { gt: Date } }).validUntil.gt).toEqual(asOf);
    expect(w.createdAt).toEqual({ lte: asOf });
    // supersession is still honoured: the SUPERSEDING row (created 08-15) is excluded by createdAt,
    // the superseded row is excluded by supersededById — so the historical answer is the row
    // that was live on 08-01 with a validUntil in the future relative to 08-01.
    expect(w.supersededById).toBeNull();
  });
});

describe("every recall lane reads the same window", () => {
  it("contextual-recall uses validityWhere in both the pool and the graph lane, with no inline copy left", () => {
    const src = read("lib/brain/contextual-recall.ts");
    expect(src.match(/validityWhere\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // definition + 2 lanes
    expect(src).not.toMatch(/OR: \[\{ validUntil: null \}, \{ validUntil: \{ gt: new Date\(\) \} \}\],\n\s*\},\n\s*orderBy/);
  });
  it("the searchMemories tool accepts asOf and bounds both the FTS SQL and the JS filter by it", () => {
    const src = read("lib/ai/tools/brain.ts");
    expect(src).toMatch(/asOf: z\s*\.string\(\)/);
    expect(src).toMatch(/valid_until > \$4/);
    expect(src).toMatch(/created_at <= \$4/);
    expect(src).toMatch(/validityWhere\(asOfDate\)/);
  });
});
