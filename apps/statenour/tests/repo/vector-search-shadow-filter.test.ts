/**
 * Every raw vector search must be safe against a source row that is gone.
 *
 * WHY A REPO SCAN AND NOT A UNIT TEST. #2430 added the shadow filter to
 * lib/db/pgvector.ts `knnSearch` and I called it done. A review then found
 * app/api/brain/search-hybrid, which runs its OWN `$queryRawUnsafe` KNN and
 * therefore inherited nothing — it returned `substring(content,1,280)` straight
 * off the embedding, so a hard-deleted chat message could be READ BACK in full
 * from the index's own copy. Sweeping afterwards found TWELVE files doing raw
 * vector search; only one had the filter.
 *
 * Centralising is not available here: these queries have genuinely different
 * shapes (different vector columns, different joins, different projections).
 * So the rule is enforced by scan instead of by construction.
 *
 * ★ THE RULE, and it is about SHAPE, not about a list of files:
 *
 *     A query that JOINS its source table is safe BY CONSTRUCTION — a missing
 *     or soft-deleted row drops out of the join.
 *     A query that reads `content` / ids straight off vector_embeddings is NOT,
 *     and must filter "sourceUnavailableAt" explicitly.
 *
 * ⚠ MEASUREMENT PATHS ARE EXEMPT AND MUST STAY EXEMPT. Coverage and tuning
 * instruments exist to describe the WHOLE index, including the dead parts.
 * Making them "consistent" would blind the very probes that found this defect —
 * the same mistake as sweeping `skill` and `tool_catalog` as orphans because a
 * blanket rule looked tidier than a correct one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const APP = join(__dirname, "..", "..");

/**
 * Instruments that MUST see dead rows. Each one answers "what is in the index",
 * so filtering would make them lie about the thing they exist to measure.
 */
const MEASUREMENT_PATHS = [
  "lib/services/embedding-coverage.ts",
  "app/api/system/embedding-coverage/route.ts",
  "lib/db/vector-tuning.ts",
];

/** A join to any of these means the query cannot return a dead source. */
const SOURCE_JOIN = /JOIN\s+("?[A-Za-z_]+"?)\s|JOIN\s+brain_memories|JOIN\s+chat_messages|JOIN\s+person_profiles/;

function vectorSearchFiles(): string[] {
  // git grep keeps this honest against files the scan would otherwise miss.
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

describe("raw vector search cannot return a source that is gone", () => {
  const files = vectorSearchFiles();

  it("finds the vector-search surface at all (guards against a silent empty scan)", () => {
    // A scan that matches nothing passes every assertion below. That is the
    // failure mode this repo has shipped three times.
    expect(files.length).toBeGreaterThan(5);
  });

  it("every ranked vector query either joins its source, filters the shadow column, or is a declared instrument", () => {
    const offenders: string[] = [];

    for (const f of files) {
      const src = readFileSync(join(APP, f), "utf8");
      // Only RANKED searches matter — a COUNT or a groupBy returns no content.
      const ranks = /ORDER BY[\s\S]{0,200}embedding_vec/.test(src);
      if (!ranks) continue;
      if (MEASUREMENT_PATHS.includes(f)) continue;
      if (src.includes('"sourceUnavailableAt" IS NULL')) continue;
      if (SOURCE_JOIN.test(src)) continue;
      offenders.push(f);
    }

    expect(
      offenders,
      `These run a ranked vector search without joining a source table and without\n` +
        `filtering "sourceUnavailableAt", so an embedding whose source row was deleted\n` +
        `still surfaces — and where the query selects \`content\`, the deleted text is\n` +
        `returned verbatim from the index's own copy:\n` +
        offenders.map((o) => `    - ${o}`).join("\n") +
        `\n\nFix: add \`AND "sourceUnavailableAt" IS NULL\`, or join the source table.\n` +
        `If it is a coverage/tuning instrument that must see dead rows, add it to\n` +
        `MEASUREMENT_PATHS in this file with a reason.`,
    ).toEqual([]);
  });

  it("the two routes the 2026-09-18 review caught carry the filter explicitly", () => {
    // Pinned by name, not just by the rule above: these two were the actual
    // defect, and a future refactor that reintroduces them should fail loudly
    // rather than quietly satisfy a heuristic.
    for (const f of [
      "app/api/brain/search-hybrid/route.ts",
      "app/api/people/search/route.ts",
    ]) {
      const src = readFileSync(join(APP, f), "utf8");
      expect(src, `${f} lost its shadow filter`).toContain('"sourceUnavailableAt" IS NULL');
    }
  });

  it("measurement instruments are NOT filtered — they must describe the whole index", () => {
    for (const f of MEASUREMENT_PATHS) {
      const src = readFileSync(join(APP, f), "utf8");
      expect(
        src.includes('"sourceUnavailableAt" IS NULL'),
        `${f} is a coverage/tuning instrument. Filtering dead rows here makes it ` +
          `under-report the index it exists to measure.`,
      ).toBe(false);
    }
  });
});
