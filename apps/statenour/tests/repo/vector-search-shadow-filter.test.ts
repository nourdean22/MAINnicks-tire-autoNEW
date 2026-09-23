/**
 * Every ranked vector query must be safe against a source row that is gone.
 *
 * WHY A REPO SCAN. #2430 added the shadow filter to `knnSearch` and I called it
 * done. A review found `app/api/brain/search-hybrid`, which runs its OWN
 * `$queryRawUnsafe` KNN and returned `substring(content,1,280)` straight off the
 * embedding — a hard-deleted chat message could be READ BACK IN FULL. Sweeping
 * by hand then found twelve such files; only one had the filter.
 *
 * ★ THE RULE, and it is about SHAPE, not a list of files:
 *
 *     A query that JOINS its source table is safe BY CONSTRUCTION — a missing
 *     or soft-deleted row drops out of the join.
 *     A query that reads `content`/ids straight off vector_embeddings is NOT,
 *     and must filter "sourceUnavailableAt" explicitly.
 *
 * ⚠⚠ THE FIRST VERSION OF THIS FILE TESTED THE WHOLE FILE AND GAVE A FALSE
 * GREEN. `lib/brain/semantic-link.ts` has an unrelated `LEFT JOIN brain_memories`
 * in its CANDIDATE SELECT at ~line 77; its ranked KNN 100 lines later joins
 * nothing and had no filter, so it ranked over dead embeddings and PERSISTED the
 * result as a semantic edge. The file-wide `SOURCE_JOIN.test(src)` exempted it.
 *
 * That is the same defect shape as the W12 guard that keyed on a LINE SHAPE
 * instead of an argument position and missed eight multiline sites while
 * printing clean. **A guard scoped wider than the thing it guards is not a
 * guard.** Everything below is scoped to ONE SQL block.
 *
 * ⚠ MEASUREMENT PATHS ARE EXEMT AND MUST STAY EXEMPT. Coverage and tuning
 * instruments exist to describe the WHOLE index, dead rows included. Filtering
 * them would blind the very probes that found this defect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const APP = join(__dirname, "..", "..");

/** Instruments that MUST see dead rows; filtering makes them lie. */
const MEASUREMENT_PATHS = [
  "lib/services/embedding-coverage.ts",
  "app/api/system/embedding-coverage/route.ts",
  "lib/db/vector-tuning.ts",
];

const SHADOW = '"sourceUnavailableAt" IS NULL';

/**
 * One level of `${name}` resolution against `const name = ...` in the same file.
 *
 * Needed because lib/db/pgvector.ts composes its WHERE from `${liveOnly}` and
 * `${shadowOnly}`, declared above the query. Without this the correct file would
 * be the one this scan reports.
 */
function resolveInterpolations(block: string, src: string): string {
  let out = block;
  for (const m of block.matchAll(/\$\{(\w+)\}/g)) {
    const name = m[1];
    const decl = src.match(new RegExp(`const\\s+${name}\\s*=([\\s\\S]{0,600}?);\\n`));
    if (decl) out += "\n" + decl[1];
  }
  return out;
}

/**
 * Is this backtick block the INSIDE of a JSDoc example rather than real SQL?
 *
 * `vectorLiteral`'s docstring in lib/db/pgvector.ts contains a worked example
 * with a full ranked query in it, and the first run of this scan reported that
 * COMMENT as an unprotected query.
 *
 * ⚠ DELIBERATELY NOT A COMMENT STRIPPER. This repo has three recorded incidents
 * of a comment's CONTENT breaking a comment scanner — most recently a `/api/cron/*`
 * inside a `//` line opening a block comment and eating the rest of the file.
 * Discriminating on "most lines begin with *" cannot eat anything, and a doc
 * example that does not look like a doc comment is not a false positive worth
 * risking that for.
 */
function looksLikeDocComment(block: string): boolean {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  return lines.filter((l) => l.startsWith("*")).length / lines.length > 0.5;
}

/** Template-literal blocks that are a RANKED search over vector_embeddings. */
export function rankedVectorBlocks(src: string): string[] {
  const blocks: string[] = [];
  // Template literals are the SQL carrier everywhere in this codebase.
  for (const raw of src.split("`")) {
    if (!/FROM\s+vector_embeddings/i.test(raw)) continue;
    if (!/ORDER BY[\s\S]*embedding_vec/i.test(raw)) continue;
    if (looksLikeDocComment(raw)) continue;
    blocks.push(resolveInterpolations(raw, src));
  }
  return blocks;
}

/** A join to the source table inside THIS block makes it safe by construction. */
function joinsSource(block: string): boolean {
  return /\bJOIN\s+"?[A-Za-z_][A-Za-z0-9_]*"?\b/i.test(block);
}

/** Offending blocks in one file. Exported so the fixtures below use the SAME code. */
export function unsafeBlocks(src: string): string[] {
  return rankedVectorBlocks(src).filter((b) => !b.includes(SHADOW) && !joinsSource(b));
}

function vectorSearchFiles(): string[] {
  const out = execSync('git grep -l "FROM vector_embeddings" -- "*.ts"', {
    cwd: APP,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => f.startsWith("lib/") || f.startsWith("app/"));
}

describe("the scan is scoped to a QUERY, not to a file", () => {
  // These fixtures are the canary the file-scoped version did not have. They
  // reproduce semantic-link.ts's exact shape: a protected query and an
  // unprotected one in the same source.
  const PROTECTED = 'const a = `SELECT id FROM vector_embeddings ve JOIN brain_memories bm ON bm.id = ve."sourceId" WHERE x ORDER BY ve.embedding_vec <=> q LIMIT 5`;\n';
  const UNPROTECTED = 'const b = `SELECT id FROM vector_embeddings ve WHERE ve.embedding_vec IS NOT NULL ORDER BY ve.embedding_vec <=> q LIMIT 5`;\n';

  it("MUTATION: an unprotected query is caught even beside a protected one", () => {
    // The whole bug: file-wide matching let the first query exempt the second.
    expect(unsafeBlocks(PROTECTED + UNPROTECTED)).toHaveLength(1);
  });

  it("CANARY: two protected queries are clean, so the above is not always-red", () => {
    const withFilter = UNPROTECTED.replace("WHERE ", `WHERE ${SHADOW} AND `);
    expect(unsafeBlocks(PROTECTED + withFilter)).toEqual([]);
  });

  it("an interpolated filter declared elsewhere in the file still counts", () => {
    // lib/db/pgvector.ts builds its WHERE from `${shadowOnly}`.
    const src =
      `const shadowOnly = ' AND ${SHADOW}';\n` +
      "const q = `SELECT id FROM vector_embeddings WHERE embedding_vec IS NOT NULL ${shadowOnly} ORDER BY embedding_vec <=> v LIMIT 5`;\n";
    expect(unsafeBlocks(src)).toEqual([]);
  });

  it("a COUNT with no ORDER BY is not a ranked search and is ignored", () => {
    expect(
      unsafeBlocks("const c = `SELECT COUNT(*) FROM vector_embeddings WHERE x`;\n"),
    ).toEqual([]);
  });

  const DOC_EXAMPLE =
    "/**\n * Example:\n *   await prisma.$queryRaw`\n" +
    " *     SELECT id FROM vector_embeddings\n" +
    " *     ORDER BY embedding_vec <=> v LIMIT 10\n *   `;\n */\n";

  it("a ranked query inside a JSDoc EXAMPLE is not a call site", () => {
    // pgvector.ts's `vectorLiteral` docstring carries a full worked query, and
    // the first run of this scan reported that comment as an unprotected site.
    expect(unsafeBlocks(DOC_EXAMPLE)).toEqual([]);
  });

  it("CANARY: the doc-comment skip does not swallow REAL adjacent SQL", () => {
    // The risk of that skip is that it hides a genuine query. Prove it does not:
    // same doc block, plus a real unprotected query straight after it.
    expect(unsafeBlocks(DOC_EXAMPLE + UNPROTECTED)).toHaveLength(1);
  });
});

describe("raw vector search cannot return a source that is gone", () => {
  const files = vectorSearchFiles();

  it("finds the vector-search surface at all (guards against a silent empty scan)", () => {
    // A scan that matches nothing passes every assertion below. That is the
    // failure mode this repo has shipped three times.
    expect(files.length).toBeGreaterThan(5);
  });

  it("every ranked vector query joins its source, filters the shadow column, or is a declared instrument", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (MEASUREMENT_PATHS.includes(f)) continue;
      const bad = unsafeBlocks(readFileSync(join(APP, f), "utf8"));
      for (const b of bad) {
        offenders.push(`${f} :: ${b.replace(/\s+/g, " ").trim().slice(0, 90)}`);
      }
    }

    expect(
      offenders,
      `These run a ranked vector search without joining a source table and without\n` +
        `filtering ${SHADOW}, so an embedding whose source row was deleted still\n` +
        `surfaces — and where the query selects \`content\`, the deleted text is\n` +
        `returned verbatim from the index's own copy:\n` +
        offenders.map((o) => `    - ${o}`).join("\n") +
        `\n\nFix: add \`AND ${SHADOW}\`, or join the source table.\n` +
        `If it is a coverage/tuning instrument that must see dead rows, add it to\n` +
        `MEASUREMENT_PATHS in this file with a reason.`,
    ).toEqual([]);
  });

  it("the paths the 2026-09-18 reviews caught carry the filter explicitly", () => {
    // Pinned by name as well as by the rule: these were the actual defects, and
    // a refactor that reintroduces one should fail loudly rather than quietly
    // satisfy a heuristic.
    for (const f of [
      "app/api/brain/search-hybrid/route.ts",
      "app/api/people/search/route.ts",
      "lib/brain/photo-embedding.ts",
      "lib/brain/semantic-link.ts",
    ]) {
      expect(readFileSync(join(APP, f), "utf8"), `${f} lost its shadow filter`).toContain(SHADOW);
    }
  });

  it("measurement instruments are NOT filtered — they must describe the whole index", () => {
    for (const f of MEASUREMENT_PATHS) {
      expect(
        readFileSync(join(APP, f), "utf8").includes(SHADOW),
        `${f} is a coverage/tuning instrument. Filtering dead rows here makes it ` +
          `under-report the index it exists to measure.`,
      ).toBe(false);
    }
  });
});
