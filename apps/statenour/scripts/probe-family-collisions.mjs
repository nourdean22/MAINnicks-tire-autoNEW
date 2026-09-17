/**
 * Which keyword family buys which dead tool — and what a token-boundary rule
 * would ACTUALLY change.
 *
 * THE MECHANISM. `addMatching(pattern)` in lib/ai/chat-mode.ts tests the pattern
 * against the TOOL NAME, not against the user's text, and the test is
 * UNANCHORED. A family's vocabulary leaks wherever one keyword appears INSIDE an
 * unrelated longer word. The specimen: `/customer|people|relation|person|profile/i`
 * matches `getHabitRevenueCorrelation`, because cor·RELATION contains "relation",
 * so a habit-tracking tool is surfaced on every turn mentioning customers.
 * Production: 109 impressions, 0 lifetime calls.
 *
 * TWO CORRECTIONS AFTER REVIEW (2026-09-17) — both changed what this reports:
 *
 *   1 · It parsed RAW source, so an `addMatching(/file/i)` written inside a
 *       COMMENT counted as a live family. Parsing now goes through
 *       `scripts/lib/family-parse.mjs`, which strips comments while preserving
 *       line numbers, and is canaried in tests/scripts/family-parse.test.ts.
 *
 *   2 · Reachability treated "some other family still matches" as proof a tool
 *       stays reachable. Each family is guarded by its OWN `if (user-text)`
 *       trigger, so that is only true when the surviving family shares the lost
 *       one's trigger. `getCommitments` loses the OKR-guarded `/mit/` and keeps
 *       the task-guarded `/commit/` — on "what are my OKRs?" the survivor never
 *       fires. Such tools are now reported as CONDITIONALLY dark, separately
 *       from safe. The old NET number was an upper bound on safety stated as a
 *       certainty.
 *
 * CAVEAT ON THE PER-FAMILY COLUMN: a tool matched by four families is counted in
 * all four, so family costs are NOT additive. Only the TIER 4 TOTAL is a true
 * count of wasted impressions.
 *
 * READ-ONLY. Usage:
 *   railway run -s statenour-web -- node apps/statenour/scripts/probe-family-collisions.mjs
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { parseFamilies, classifyReachability } from "./lib/family-parse.mjs";

// NOTE the two different base paths in this file: readFileSync resolves against
// CWD (repo root, hence "apps/statenour/..."), while import() resolves against
// this MODULE's own URL (hence "./" and "../").
const SRC = "apps/statenour/lib/ai/chat-mode.ts";
const patterns = parseFamilies(readFileSync(SRC, "utf8"));
if (patterns.length === 0) {
  console.error("ABORT — no addMatching patterns parsed. The instrument found nothing, which");
  console.error("        means the parser is wrong, not that the families vanished.");
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(2);
}
console.log(`target host: ${new URL(url).host}`);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

async function main() {
  const { TOOL_CATALOG } = await import("../lib/ai/tools/catalog.ts");
  const toolNames = TOOL_CATALOG.map((t) => t.name);
  if (toolNames.length < 50) {
    console.error(`ABORT — only ${toolNames.length} tool names parsed; the catalog read is wrong.`);
    process.exit(2);
  }

  const called = await prisma.$queryRawUnsafe(
    `SELECT tool_name::text AS name FROM tool_telemetry WHERE total_calls > 0`,
  );
  const everChosen = new Set(called.map((r) => r.name));
  const imp = await prisma.$queryRawUnsafe(`
    SELECT tool_name::text AS name, COUNT(*)::int AS n
      FROM tool_gate_decisions WHERE verdict='ALLOWED' AND tier=4 GROUP BY 1`);
  const impressions = new Map(imp.map((r) => [r.name, r.n]));

  // The INTERSECTION, not the row count. tool_telemetry holds at least one key
  // that is not a catalog tool at all (a malformed tool-call payload stored as
  // a name), so "rows with calls" OVERSTATES how many real tools were chosen.
  const catalogSet = new Set(toolNames);
  const chosenInCatalog = [...everChosen].filter((n) => catalogSet.has(n));
  const notInCatalog = [...everChosen].filter((n) => !catalogSet.has(n));
  const distinctTriggers = new Set(patterns.map((p) => p.trigger)).size;
  console.log(
    `\n${patterns.length} EXECUTABLE addMatching families (${distinctTriggers} distinct triggers) · ` +
      `${toolNames.length} catalog tools\n` +
      `  tool_telemetry keys with >=1 call: ${everChosen.size}\n` +
      `  …that are actual catalog tools:    ${chosenInCatalog.length}\n` +
      `  …that are NOT (retired or junk):   ${notInCatalog.length}` +
      (notInCatalog.length
        ? `\n      ${notInCatalog.map((n) => JSON.stringify(n.slice(0, 40))).join(", ")}`
        : ""),
  );
  console.log(
    `  NEVER chosen: ${toolNames.length - chosenInCatalog.length} of ${toolNames.length} ` +
      `(${(((toolNames.length - chosenInCatalog.length) / toolNames.length) * 100).toFixed(1)}%)`,
  );

  // ── THE DECISION, trigger-aware ──────────────────────────────────────────
  const buckets = { safe: [], conditionally: [], dark: [] };
  for (const name of toolNames) {
    const r = classifyReachability(patterns, name);
    if (r.verdict === "unmatched" || r.verdict === "unchanged") continue;
    buckets[r.verdict].push({
      name,
      imp: impressions.get(name) ?? 0,
      chosen: everChosen.has(name),
      lost: r.lost.map((p) => p.src),
      survivingTriggers: [...new Set(r.after.map((p) => p.trigger))].length,
    });
  }

  console.log(`\n── token-boundary rule · trigger-aware outcome ──`);
  for (const [k, label] of [
    ["dark", "DARK — no family matches at all any more"],
    ["conditionally", "CONDITIONALLY dark — survives only under a DIFFERENT trigger"],
    ["safe", "SAFE — a surviving family shares the lost one's trigger"],
  ]) {
    const rows = buckets[k];
    const chosen = rows.filter((r) => r.chosen);
    console.log(`\n  ${label}: ${rows.length} tool(s), ${chosen.length} ever-chosen`);
    for (const r of rows.sort((a, b) => b.imp - a.imp).slice(0, 12)) {
      console.log(
        `    ${r.chosen ? "CHOSEN " : "dead   "} ${String(r.imp).padStart(4)} impr · ${r.name}` +
          `  (lost ${r.lost.join(", ")})`,
      );
    }
  }

  const riskyChosen = [...buckets.dark, ...buckets.conditionally].filter((r) => r.chosen);
  const reclaimable = [...buckets.dark, ...buckets.conditionally]
    .filter((r) => !r.chosen)
    .reduce((s, r) => s + r.imp, 0);
  console.log(
    `\n  VERDICT: ${riskyChosen.length} ever-chosen tool(s) would lose reachability for at least ` +
      `one phrasing; up to ${reclaimable} tier-4 impressions reclaimable from never-chosen tools.`,
  );
  if (riskyChosen.length === 0 && reclaimable === 0) {
    console.log(`  => the rule is SAFE and WORTHLESS: it changes no outcome either way.`);
  }

  // ── per-family detail ────────────────────────────────────────────────────
  console.log(`\n── families by dead weight (NOT additive: a tool counts in every family) ──`);
  const rows = patterns.map((p) => {
    const matched = toolNames.filter((n) => p.re.test(n));
    const dead = matched.filter((n) => !everChosen.has(n));
    return { ...p, matched, dead, cost: dead.reduce((s, n) => s + (impressions.get(n) ?? 0), 0) };
  });
  for (const r of rows.sort((a, b) => b.cost - a.cost).slice(0, 8)) {
    if (!r.cost) continue;
    console.log(`\n  ${r.src}  (chat-mode.ts:${r.line})`);
    console.log(
      `    matches ${r.matched.length} · ${r.dead.length} never chosen · ${r.cost} dead impressions`,
    );
  }

  const totalWaste = [...impressions.entries()]
    .filter(([n]) => !everChosen.has(n))
    .reduce((s, [, n]) => s + n, 0);
  const totalImp = [...impressions.values()].reduce((s, n) => s + n, 0);
  console.log(
    `\nTIER 4 TOTAL (the only additive number): ${totalImp} impressions, ` +
      `${totalWaste} to never-chosen tools (${((totalWaste / totalImp) * 100).toFixed(1)}%)`,
  );
}

main()
  .catch((e) => {
    console.error("probe failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
