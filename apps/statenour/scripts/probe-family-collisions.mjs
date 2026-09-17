/**
 * Which keyword family buys which dead tool — and what a token-boundary rule
 * would change.
 *
 * THE MECHANISM. `addMatching(pattern)` in lib/ai/chat-mode.ts tests
 * the pattern against the TOOL NAME, not against the user's text:
 *
 *     for (const name of Object.keys(allTools)) if (pattern.test(name)) ...
 *
 * The test is unanchored, so a family's vocabulary leaks wherever one keyword
 * appears INSIDE an unrelated longer word. The specimen:
 * `/customer|people|relation|person|profile/i` matches
 * `getHabitRevenueCorrelation`, because cor·RELATION contains "relation" — so
 * a habit-tracking tool is surfaced on every turn mentioning customers.
 * Production: 109 impressions, 0 lifetime calls.
 *
 * PROPOSED RULE. Require the match to START at a camelCase token boundary.
 * `/revenue/i` still matches getHabitRevenue... (token "Revenue" at 8);
 * `/relation/i` no longer does (it matches at 18, inside token "Correlation"
 * which starts at 15). Exact-name families like `/scoreLocation/` still match,
 * because they begin at offset 0, which is a token boundary.
 *
 * WHAT THIS PROBE DECIDES. Not "is the rule nicer" — whether any tool the
 * model has EVER chosen would lose a family match. If none do, the change is
 * pure waste reduction against known-good behaviour. If some do, the rule is
 * wrong or needs exceptions, and this prints them by name.
 *
 * CAVEAT ON THE PER-FAMILY COLUMN: a tool matched by four families is counted
 * in all four, so the family costs are NOT additive. Only the TIER 4 TOTAL is
 * a true count of wasted impressions.
 *
 * READ-ONLY. Usage:
 *   railway run -s statenour-web -- node apps/statenour/scripts/probe-family-collisions.mjs
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const SRC = "apps/statenour/lib/ai/chat-mode.ts";
const source = readFileSync(SRC, "utf8");

const patterns = [];
const re = /addMatching\(\s*\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)\s*\)/g;
let m;
while ((m = re.exec(source)) !== null) {
  const flags = m[2].replace("g", "");
  patterns.push({
    line: source.slice(0, m.index).split("\n").length,
    src: `/${m[1]}/${m[2]}`,
    re: new RegExp(m[1], flags),
    reAll: new RegExp(m[1], flags.includes("g") ? flags : flags + "g"),
  });
}
if (patterns.length === 0) {
  console.error("ABORT — no addMatching patterns parsed. The instrument found nothing, which");
  console.error("        means the regex is wrong, not that the families vanished.");
  process.exit(2);
}

/** Byte offsets at which a camelCase/underscore/dot token begins. */
function tokenStarts(name) {
  const starts = new Set([0]);
  for (let i = 1; i < name.length; i++) {
    const prev = name[i - 1];
    const ch = name[i];
    if (ch === "_" || ch === ".") continue;
    if (prev === "_" || prev === ".") starts.add(i);
    // lower|digit -> Upper  (getHabit -> H)
    else if (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)) starts.add(i);
    // Upper -> Upper followed by lower  (HTTPServer -> S)
    else if (/[A-Z]/.test(prev) && /[A-Z]/.test(ch) && /[a-z]/.test(name[i + 1] ?? "")) starts.add(i);
  }
  return starts;
}

/** Does `p` match `name` starting at a token boundary? */
function matchesAtTokenStart(p, name) {
  const starts = tokenStarts(name);
  p.reAll.lastIndex = 0;
  let hit;
  while ((hit = p.reAll.exec(name)) !== null) {
    if (starts.has(hit.index)) return true;
    if (hit.index === p.reAll.lastIndex) p.reAll.lastIndex++; // zero-width guard
  }
  return false;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL absent — refusing to guess a target.");
  process.exit(2);
}
console.log(`target host: ${new URL(url).host}`);
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

async function main() {
  // Node 24 strips types, so the real catalog imports directly. No source
  // parse fallback: a fallback that silently produced a DIFFERENT tool list
  // would change every number below while still printing confidently.
  // NOTE the two different base paths in this file: readFileSync resolves
  // against CWD (repo root, hence "apps/statenour/..."), while import()
  // resolves against this MODULE's own URL (hence "../").
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

  // The intersection, not the row count. tool_telemetry contains at least one
  // key that is not a catalog tool at all (a malformed tool-call payload
  // stored as a name), so "rows with calls" OVERSTATES how many real tools
  // have been chosen. Print both and the gap.
  const catalogSet = new Set(toolNames);
  const chosenInCatalog = [...everChosen].filter((n) => catalogSet.has(n));
  const notInCatalog = [...everChosen].filter((n) => !catalogSet.has(n));
  console.log(
    `\n${patterns.length} addMatching families · ${toolNames.length} catalog tools\n` +
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

  // ── THE DECISION ─────────────────────────────────────────────────────────
  const lostChosen = [];
  const lostDead = [];
  for (const p of patterns) {
    for (const name of toolNames) {
      const before = p.re.test(name);
      if (!before) continue;
      if (matchesAtTokenStart(p, name)) continue;
      const row = { family: p.src, line: p.line, name, imp: impressions.get(name) ?? 0 };
      (everChosen.has(name) ? lostChosen : lostDead).push(row);
    }
  }

  console.log(`\n── token-boundary rule · what changes ──`);
  console.log(`  (family, tool) pairs dropped: ${lostChosen.length + lostDead.length}`);
  console.log(`  …of which the tool has EVER been chosen: ${lostChosen.length}`);
  if (lostChosen.length) {
    console.log(`\n  pairs lost on a CHOSEN tool (a pair is not yet a darkening):`);
    for (const r of lostChosen) {
      console.log(`    ${r.name} (${r.imp} tier-4 impressions)  ×  ${r.family}  @${r.line}`);
    }
  }

  // ── THE METRIC THAT ACTUALLY DECIDES ─────────────────────────────────────
  // A dropped (family, tool) pair costs nothing if another family still
  // matches that tool. What matters is a tool going from >=1 family to ZERO:
  // that is a capability leaving tier 4 entirely.
  const darkened = { chosen: [], dead: [] };
  for (const name of toolNames) {
    const beforeN = patterns.filter((p) => p.re.test(name)).length;
    if (beforeN === 0) continue;
    const afterN = patterns.filter((p) => matchesAtTokenStart(p, name)).length;
    if (afterN > 0) continue;
    const row = { name, imp: impressions.get(name) ?? 0, beforeN };
    (everChosen.has(name) ? darkened.chosen : darkened.dead).push(row);
  }
  console.log(`\n  NET — tools that lose EVERY tier-4 family (go dark in tier 4):`);
  if (darkened.chosen.length === 0) {
    console.log(`    ✓ zero EVER-CHOSEN tools go dark. No known-good behaviour is lost.`);
  } else {
    console.log(`    ⚠ ${darkened.chosen.length} ever-chosen tool(s) WOULD go dark — the rule is`);
    console.log(`      not safe as written and needs these names handled explicitly:`);
    for (const r of darkened.chosen) {
      console.log(`        ${r.name} (${r.imp} impressions, was matched by ${r.beforeN} famil(ies))`);
    }
  }
  const deadDark = darkened.dead.reduce((s, r) => s + r.imp, 0);
  console.log(
    `    never-chosen tools that go dark: ${darkened.dead.length} ` +
      `(${deadDark} tier-4 impressions reclaimed)`,
  );
  for (const r of darkened.dead.sort((a, b) => b.imp - a.imp).slice(0, 10)) {
    if (r.imp > 0) console.log(`        ${String(r.imp).padStart(4)} impressions · ${r.name}`);
  }

  const droppedImp = new Map();
  for (const r of lostDead) droppedImp.set(r.name, r.imp);
  const totalDropped = [...droppedImp.values()].reduce((s, n) => s + n, 0);
  console.log(`\n  never-chosen tools that lose at least one family: ${droppedImp.size}`);
  const top = [...droppedImp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [n, c] of top) if (c > 0) console.log(`    ${String(c).padStart(4)} impressions · ${n}`);
  console.log(`  tier-4 impressions attached to those tools: ${totalDropped}`);
  console.log(
    `  (upper bound on savings — a tool keeps its slot if ANY surviving family still matches it)`,
  );

  // ── per-family detail, for narrowing the ones the rule does not fix ───────
  console.log(`\n── families by dead weight (NOT additive: a tool is counted in every family) ──`);
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
