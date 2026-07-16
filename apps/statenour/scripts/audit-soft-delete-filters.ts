/**
 * scripts/audit-soft-delete-filters.ts
 *
 * Static scan for aggregate reads (`count` / `groupBy` / `aggregate`) on
 * soft-delete models that DON'T filter `deletedAt` — the "phantom count"
 * class.
 *
 * Why this guard exists (2026-07-16 audit):
 *   The soft-delete contract (lib/db/soft-delete.ts) is opt-IN per query —
 *   every caller must remember `deletedAt: null` (or `activeOnly()`). 109 of
 *   150 aggregate call sites had forgotten. That is a 73% failure rate, which
 *   is a property of the contract, not of the authors: nothing made the
 *   omission visible.
 *
 *   It was not theoretical. Live prod at the time of the sweep:
 *     Task          104 of 161 rows soft-deleted (64.6%)
 *     BrainMemory  6319 of 17926        (35.3%)
 *   GET /api/health reported 161 tasks / 52 INBOX when the truth was 57 / 0 —
 *   i.e. the operator's entire "inbox backlog" was fictional, and gates like
 *   drift-engine's NOVELTY-SEEKING alert were firing on deleted rows.
 *
 * Scope — deliberately narrow:
 *   Only count/groupBy/aggregate. `findMany`/`findFirst` have the same hazard
 *   but there are hundreds of them and most already filter; sweeping them is a
 *   separate, larger job. This guard holds the line on the numbers.
 *
 * Allowlist:
 *   Some sites are legitimately ambiguous (a physical table census; an
 *   all-time cumulative counter; a ratio whose numerator counts a different
 *   population). Those are listed in ALLOWLIST with a reason, so the guard
 *   stays green AND the decision stays documented. Add to it only with a
 *   reason a reviewer can check.
 *
 * Baseline (same pattern as scripts/lint-baseline.ts):
 *   The first sweep fixed the 25 sites that lie to the OPERATOR or to NICK
 *   (health, Telegram digests, system prompts, and the risk/drift GATES).
 *   The rest are recorded in soft-delete-baseline.json so this guard can go
 *   into verify:hard TODAY and hold the ground that's been won — a NEW
 *   unfiltered aggregate fails the build. The baseline is a debt register,
 *   not an exemption: it should only ever shrink.
 *
 * Run: `pnpm tsx scripts/audit-soft-delete-filters.ts`   (alias: pnpm check:soft-delete)
 *      `pnpm tsx scripts/audit-soft-delete-filters.ts --update-baseline`
 * Exit 1 on any finding that is neither allowlisted nor baselined.
 */

import fs from "node:fs";
import path from "node:path";

/** Prisma client keys for models that carry `deletedAt`. Parsed from schema. */
function parseSoftDeleteModels(schemaPath: string): Set<string> {
  const raw = fs.readFileSync(schemaPath, "utf8");
  const out = new Set<string>();
  const modelRegex = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRegex.exec(raw)) !== null) {
    const [, modelName, body] = m;
    if (!/^\s*deletedAt\s+DateTime\?/m.test(body)) continue;
    // Prisma client property is the model name with a lowercase first char.
    out.add(modelName.charAt(0).toLowerCase() + modelName.slice(1));
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  model: string;
  op: string;
  snippet: string;
}

/**
 * Sites intentionally exempt. Key: `<relative-path>:<line>` is too brittle
 * (line numbers move), so we key on path + a stable code fragment.
 */
const ALLOWLIST: Array<{ file: string; contains: string; reason: string }> = [
  {
    file: "lib/services/system-pages.ts",
    contains: "modelCounts",
    reason:
      "/system/diagnostics is a PHYSICAL table census shown next to models that have no deletedAt at all (smartDevice, chatMessage, aiGeneration). Tombstones are part of 'how big is this table'. Filtering would make the rows incomparable on the same card.",
  },
  // (removed 2026-07-16) cold-memory.ts totalBrainMemories + embedding-utils
  // coveragePercent: the embeddingCoverage numerator/denominator pair moved
  // TOGETHER — countLiveBrainMemoryEmbeddings() joins to live brain_memories,
  // and both denominators filter deletedAt. Measured on prod: 67% of
  // brain-memory embeddings were orphans of pruned rows; live coverage 18.4%.
  // (removed 2026-07-16) lib/brain/learning-velocity.ts oldAvgConfidence:
  // the confidenceDelta pair (current avg + 30d-old avg) was fixed TOGETHER
  // — both halves now filter deletedAt: null, so the one-sided-fix hazard
  // this entry guarded against no longer applies.
  // (removed 2026-07-16, final wave) brain-continuity `allTime` (service +
  // legacy REST twin): operator ordered consistency — allTime now filters
  // deletedAt too, so the card's allTime/active/expired all describe the
  // live population ("all live rows ever", not "all rows ever written").
  // The REST route now delegates to buildContinuityReport(), so the twin
  // entry has no query block left to exempt.
  {
    file: "app/api/missions/[id]/retro/route.ts",
    contains: "taskCount",
    reason:
      "Retrospective artifact — a task deleted after the mission closed still counted toward that mission's footprint at the time. openCount vs taskCount pull opposite directions from one groupBy; needs splitting, not filtering.",
  },
];

function isAllowlisted(relFile: string, snippet: string): string | null {
  for (const a of ALLOWLIST) {
    if (relFile === a.file && snippet.includes(a.contains)) return a.reason;
  }
  return null;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const BASELINE_PATH = "scripts/soft-delete-baseline.json";

/** A stable-ish key: line numbers drift, the code text mostly doesn't. */
function baselineKey(f: Finding): string {
  return `${f.file} :: prisma.${f.model}.${f.op} :: ${f.snippet.replace(/\s+/g, " ").trim()}`;
}

async function main() {
  const root = process.cwd();
  const updateBaseline = process.argv.includes("--update-baseline");
  const models = parseSoftDeleteModels(path.join(root, "prisma/schema.prisma"));
  if (models.size === 0) {
    console.error("audit failed: no soft-delete models parsed from schema.prisma");
    process.exit(1);
  }

  const files = [
    ...walk(path.join(root, "lib")),
    ...walk(path.join(root, "app")),
  ];

  const findings: Finding[] = [];
  let allowed = 0;
  let total = 0;

  const callRegex = new RegExp(
    `prisma\\.(${[...models].join("|")})\\s*\\.\\s*(count|groupBy|aggregate)\\s*\\(`,
    "g",
  );

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("prisma.")) continue;
    const lines = src.split("\n");
    let m: RegExpExecArray | null;
    callRegex.lastIndex = 0;
    while ((m = callRegex.exec(src)) !== null) {
      const [, model, op] = m;
      total++;
      const lineNo = src.slice(0, m.index).split("\n").length;
      // The call's argument object: from the match to its balanced close, capped.
      const window = lines.slice(lineNo - 1, lineNo + 11).join("\n");
      if (/deletedAt|activeOnly\(/.test(window)) continue;

      const rel = path.relative(root, file).replace(/\\/g, "/");
      const reason = isAllowlisted(rel, window);
      if (reason) {
        allowed++;
        continue;
      }
      findings.push({
        file: rel,
        line: lineNo,
        model,
        op,
        snippet: lines[lineNo - 1].trim().slice(0, 100),
      });
    }
  }

  console.log(
    `Scanned ${files.length} files · ${total} aggregate reads on ${models.size} soft-delete models · ${allowed} allowlisted.`,
  );

  const baselineFile = path.join(root, BASELINE_PATH);

  if (updateBaseline) {
    const keys = findings.map(baselineKey).sort();
    fs.writeFileSync(
      baselineFile,
      JSON.stringify(
        {
          $comment:
            "Known-unfiltered aggregate reads on soft-delete models. DEBT REGISTER — should only ever shrink. Regenerate with: pnpm check:soft-delete --update-baseline. Do NOT add entries to silence a new violation; fix the query instead.",
          generated: "2026-07-16",
          count: keys.length,
          sites: keys,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`\n📝 Baseline written: ${BASELINE_PATH} (${keys.length} known sites).`);
    return;
  }

  let baseline: Set<string> = new Set();
  if (fs.existsSync(baselineFile)) {
    const parsed = JSON.parse(fs.readFileSync(baselineFile, "utf8")) as { sites?: string[] };
    baseline = new Set(parsed.sites ?? []);
  }

  const fresh = findings.filter((f) => !baseline.has(baselineKey(f)));
  const known = findings.length - fresh.length;

  if (fresh.length === 0) {
    console.log(
      `\n✅ No NEW unfiltered aggregate reads. (${known} known site(s) still in the baseline — a debt register, not an exemption.)`,
    );
    return;
  }

  console.error(`\n❌ ${fresh.length} NEW aggregate read(s) missing a deletedAt filter:\n`);
  for (const f of fresh) {
    console.error(`  ${f.file}:${f.line}  → prisma.${f.model}.${f.op}()`);
    console.error(`    ${f.snippet}`);
  }
  console.error(
    `\n💡 Fix: add \`deletedAt: null\` to the where clause (or wrap it in activeOnly()).` +
      `\n   Soft-deleted rows are tombstones — counting them makes the number a lie.` +
      `\n   Live proof: 104 of 161 Task rows and 6,319 of 17,926 BrainMemory rows are` +
      `\n   soft-deleted, so an unfiltered count is not a rounding error.` +
      `\n\n   Genuinely need the tombstones? Add to ALLOWLIST in this script WITH a reason.` +
      `\n   Do NOT run --update-baseline to silence this.`,
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("audit failed:", err);
  process.exit(1);
});
