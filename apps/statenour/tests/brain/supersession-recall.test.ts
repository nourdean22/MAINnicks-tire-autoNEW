/**
 * BDN-310 bi-temporal supersession — writer + reader contract (2026-08-19).
 *
 * The columns (validFrom / validUntil / lastVerifiedAt / supersededById)
 * were applied to prod Neon on 2026-08-14 and then had ZERO writers and
 * ZERO readers — "the schema is ahead of the app on purpose" aged into a
 * dead seam: a superseded belief stayed exactly as recallable as a fresh
 * one.
 *
 * This pins the READER half of the closure (the writer, the BrainMemory
 * contradiction resolver, held 0 rows ever and was deleted 2026-10-23):
 *   READERS — both recall lanes (Lane A hybrid SQL, Lane B prisma pool +
 *   lexical SQL + fallback) filter superseded/expired rows out. Those are
 *   pinned as source predicates because invoking the full recall
 *   pipelines here would mean mocking half the AI stack — a text pin that
 *   goes red on deletion beats no pin (same pattern as the
 *   containing-block CSS scan).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Reader pins — the recall lanes must keep filtering superseded rows ──

const APP_ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(APP_ROOT, rel), "utf8");

describe("supersession readers · recall-lane source pins", () => {
  it("Lane A (hybrid SQL) excludes superseded + expired rows", () => {
    const src = read("lib/brain/memory-recall.ts");
    expect(src).toMatch(/superseded_by_id IS NULL/);
    expect(src).toMatch(/valid_until IS NULL OR bm\.valid_until > NOW\(\)/);
  });

  it("Lane B lexical SQL excludes superseded + expired rows", () => {
    const src = read("lib/brain/contextual-recall.ts");
    expect(src).toMatch(/superseded_by_id IS NULL/);
  });

  it("Lane B prisma pool, the fallback AND the graph-context lane all filter supersededById/validUntil", () => {
    const src = read("lib/brain/contextual-recall.ts");
    // 2026-09-08 (U3) · the three lanes now spread the shared `validityWhere()` helper
    // (definition carries the literal once); a lane that drops the spread drops a hit.
    const hits = [...(src.match(/supersededById: null/g) ?? []), ...(src.match(/\.\.\.validityWhere\(/g) ?? [])];
    // top-300 pool + getFallbackMemories + appendGraphContext (round-2:
    // the graph lane injected content past the filtered pool).
    expect(hits.length).toBeGreaterThanOrEqual(3);
    // the window itself now lives in validityWhere(): `gt: at` (= asOf ?? now)
    expect(src).toMatch(/OR: \[\{ validUntil: null \}, \{ validUntil: \{ gt: (new Date\(\)|at) \} \}\]/);
  });

  // Round-2 review: "both recall lanes honor it" was FALSE — three more
  // operator-facing read lanes had no filter. Each is pinned now.
  it("searchMemories (the ask-Nick-directly chat tool) filters in BOTH its FTS SQL and prisma where", () => {
    const src = read("lib/ai/tools/brain.ts");
    // #2198: the FTS SQL now composes the shared validitySql() (which carries the literal)
    expect(src).toMatch(/superseded_by_id IS NULL|validitySql\(/);
    expect(src).toMatch(/supersededById: null/);
  });

  it("cold-memory id-hydration carries the full liveness contract", () => {
    const src = read("lib/brain/cold-memory.ts");
    expect(src).toMatch(/deletedAt: null,\s*\n\s*supersededById: null/);
  });

  it("memory-manager recall() (memory-browser REST + tRPC) filters superseded rows", () => {
    const src = read("lib/brain/memory-manager.ts");
    expect(src).toMatch(/supersededById: null/);
  });

  it("the shared vector boundary (knnSearch liveness EXISTS) enforces supersession for every semanticSearch caller", () => {
    const src = read("lib/db/pgvector.ts");
    expect(src).toMatch(/bm\.superseded_by_id IS NULL AND \(bm\.valid_until IS NULL OR bm\.valid_until > NOW\(\)\)/);
  });

  it("embedding-utils' brain_memory hydration filters superseded rows (belt to the knnSearch braces)", () => {
    const src = read("lib/brain/embedding-utils.ts");
    expect(src).toMatch(/supersededById: null/);
  });
});
