#!/usr/bin/env node
/**
 * Raw-SQL column linting — catches the single most expensive bug class in this
 * codebase: raw SQL naming `created_at` on a table whose column is `createdAt`.
 *
 * WHY THIS EXISTS
 * This database mixes naming conventions PER TABLE. `cron_log` and
 * `social_content_inventory` are snake_case; `bookings`, `invoices`,
 * `ig_autopost_log` and most others are camelCase. Drizzle hides the difference
 * for query-builder calls, but raw `sql\`...\`` templates are unchecked strings —
 * tsc cannot see inside them, and MySQL only complains at runtime.
 *
 * Three independent production defects in one day, all this exact shape:
 *   · cross-sell outreach   — c.first_name / m.conversation_id  (#1125)
 *                             the A/B treatment arm had been empty for MONTHS
 *   · monte-carlo forecast  — bookings.created_at, invoices.total (#1131)
 *                             the job reported `completed` on every run and
 *                             had NEVER produced a forecast
 *   · seo-forensic          — adjacent class, wrong units not wrong names
 *
 * Each failed silently: the query threw, a catch swallowed it, and the job
 * recorded success. Nobody could have noticed from the outside.
 *
 * THE RULE, DELIBERATELY NARROW
 * Flag a snake_case identifier in raw SQL only when:
 *   1. none of the tables that query references has a column by that name, AND
 *   2. one of them HAS the camelCase equivalent.
 *
 * Both halves matter. (1) alone would flag aliases, CTE names, keywords and
 * expression labels — noise, and a linter that cries wolf gets deleted. (2) is
 * what makes a hit self-evidently a bug: the column the author meant is sitting
 * right there under a different spelling. No judgement call, no allowlist.
 *
 * It does NOT try to validate SQL generally. Unknown identifiers that have no
 * camelCase twin are ignored on purpose — that is a different, much noisier
 * problem, and solving it here would cost this check its credibility.
 *
 *   node scripts/lint-sql-columns.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA = join(APP, "drizzle", "schema.ts");

// ─── 1 · table -> real DB column names, straight from the schema ───
function parseSchema() {
  const src = readFileSync(SCHEMA, "utf8");
  const tables = new Map();
  // mysqlTable("name", { ... })  — capture the body up to the closing "})"
  const tableRe = /mysqlTable\(\s*["']([^"']+)["']\s*,\s*\{([\s\S]*?)\n\}/g;
  for (const m of src.matchAll(tableRe)) {
    const [, table, body] = m;
    const cols = new Set();
    // `key: type("dbColumn"...)`  — the string arg is the REAL column name.
    for (const c of body.matchAll(/^\s*(\w+)\s*:\s*\w+\(\s*["']([^"']+)["']/gm)) cols.add(c[2]);
    // `key: type()` with no explicit name — drizzle uses the key itself.
    for (const c of body.matchAll(/^\s*(\w+)\s*:\s*\w+\(\s*\)/gm)) cols.add(c[1]);
    if (cols.size) tables.set(table, cols);
  }
  return tables;
}

const TABLES = parseSchema();
if (TABLES.size < 50) {
  console.error(`✗ schema parse produced only ${TABLES.size} tables — the parser has drifted from drizzle/schema.ts. Refusing to lint against a bad map.`);
  process.exit(1);
}

const camelOf = (snake) => snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// ─── 2 · every raw sql`...` template under server/ ───
function sourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

/** SQL words that can appear in snake_case-looking form but are not columns. */
const SQL_NOISE = new Set(["group_concat", "date_sub", "date_add", "current_timestamp", "on_duplicate"]);

let errors = 0;
let scanned = 0;
let skipped = 0;
const findings = [];

for (const file of sourceFiles(join(APP, "server"))) {
  const src = readFileSync(file, "utf8");
  // Strip comments so documented-but-removed SQL is never flagged. (Learned
  // the hard way twice: a prose mention of a dead column is not a live read.)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  for (const tpl of code.matchAll(/sql`([\s\S]*?)`/g)) {
    // Strip SQL comments too, not just the JS ones above. A `-- t.is_active
    // does not exist` note explaining a fix is not a live column read — this
    // check flagged its OWN documentation the first time it ran green.
    const query = tpl[1].replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    scanned++;

    /**
     * Which tables does this query touch — and do we know ALL of them?
     *
     * FAIL SAFE, LEARNED FROM A FALSE POSITIVE ON THE FIRST RUN.
     * `revenueReconciliation.ts` joins `revenue_attribution_decisions`, a
     * genuinely snake_case table that exists in prod but NOT in
     * drizzle/schema.ts (hand-applied migration, raw SQL only). The first
     * version silently dropped unknown tables from the reference set, judged
     * `d.work_order_id` against the tables it DID know, found
     * `invoices.workOrderId`, and reported a bug in correct code.
     *
     * If a single table in the query is unresolvable, this check cannot tell a
     * wrong column from a right one — so it declines to judge the whole query
     * and says how often that happened. A linter that cries wolf gets deleted;
     * one that admits its blind spots gets trusted.
     */
    const referenced = new Set();
    let unresolved = false;
    for (const t of query.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([a-z_][a-z0-9_]*)`?/gi)) {
      if (TABLES.has(t[1])) referenced.add(t[1]);
      else unresolved = true;
    }
    if (unresolved) { skipped++; continue; }
    if (!referenced.size) continue;

    const known = new Set();
    const camelKnown = new Map(); // camelCase -> table that has it
    for (const t of referenced) {
      for (const c of TABLES.get(t)) {
        known.add(c);
        camelKnown.set(c, t);
      }
    }

    for (const tok of new Set([...query.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)].map((x) => x[1]))) {
      if (SQL_NOISE.has(tok) || known.has(tok)) continue;
      const camel = camelOf(tok);
      if (!camelKnown.has(camel)) continue; // no twin -> not our bug class
      errors++;
      const line = src.slice(0, src.indexOf(tpl[0])).split("\n").length;
      findings.push(
        `  ${relative(APP, file)}:${line}\n` +
        `    uses \`${tok}\` but ${camelKnown.get(camel)} has \`${camel}\`` +
        ` (tables in query: ${[...referenced].join(", ")})`,
      );
    }
  }
}

console.log("");
console.log("─── raw-SQL column lint ───");
console.log(`  tables in schema:     ${TABLES.size}`);
console.log(`  sql\`\` templates:      ${scanned}`);
console.log(`  skipped (unknown table): ${skipped} — cannot judge these`);
console.log(`  wrong-case columns:   ${errors}`);
console.log("");

if (errors > 0) {
  console.error(findings.join("\n"));
  console.error(
    `\n✗ ${errors} raw-SQL column name(s) do not exist on the table but have a camelCase twin.\n` +
    `  This is the class that silently broke cross-sell (#1125) and monte-carlo (#1131):\n` +
    `  the query throws, a catch swallows it, and the job reports success forever.\n`,
  );
  process.exit(1);
}

console.log("✓ raw-SQL column lint passed");
