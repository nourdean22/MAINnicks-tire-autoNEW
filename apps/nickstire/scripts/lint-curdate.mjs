#!/usr/bin/env node
/**
 * CURDATE GATE — no NEW bare `CURDATE()` in server SQL.
 *
 * WHY. apps/nickstire/AGENTS.md ("Time — Cleveland/Eastern, explicitly"): the
 * database session date is UTC, so `CURDATE()` rolls over at 8 PM Eastern (7 PM
 * in winter). Between then and midnight "today" is already tomorrow in
 * Cleveland. NT-009 is the incident this costs: a booking for TODAY was
 * auto-cancelled and the customer texted while they could still walk in
 * (server/cron/jobs/crudAutomation.ts). The rule had no gate, and code sites
 * accumulated behind it (96 occurrences in 28 files, 2026-09-23).
 *
 * THE FIX TO USE INSTEAD (both already in the tree):
 *   - JS-computed shop date, passed as a parameter:
 *       getBusinessDateKey() from server/lib/timezoneAssert.ts  (the NT-009 fix)
 *   - SQL, when the date must stay in the query:
 *       DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))  (kpiSnapshot.ts)
 *
 * SHAPE — the knip-orphan-gate pattern: a REASON-CARRYING baseline, so the gate
 * is green on day one and only new sites fail. Counted per file, not per line,
 * because line numbers drift on every unrelated edit. It is a RATCHET both ways:
 *   - a file with more sites than its baseline, or a new file, fails (NEW);
 *   - a file with fewer sites than its baseline also fails (LOWER THE BASELINE),
 *     so a fix is locked in and its slack cannot quietly absorb a new site.
 * Comments are stripped before counting — the files that explain why they do
 * NOT use CURDATE() must not be charged for saying the word.
 *
 *   node scripts/lint-curdate.mjs                 # gate
 *   node scripts/lint-curdate.mjs --baseline      # rewrite counts, keep reasons
 *   node scripts/lint-curdate.mjs --root <dir> --baseline-file <json>   # tests
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = path.resolve(opt("--root") ?? path.join(import.meta.dirname, ".."));
const BASELINE = path.resolve(opt("--baseline-file") ?? path.join(ROOT, "config", "curdate-baseline.json"));
const baselineMode = argv.includes("--baseline");

const CURDATE = /\bCURDATE\s*\(\s*\)/gi;

/** Block comments, then line comments not preceded by `:` (keeps `https://…`). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function countCurdate(src) {
  return (stripComments(src).match(CURDATE) ?? []).length;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      yield* walk(p);
    } else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name)) {
      yield p;
    }
  }
}

function scan() {
  const serverDir = path.join(ROOT, "server");
  const counts = new Map();
  if (!existsSync(serverDir)) return counts;
  for (const file of walk(serverDir)) {
    const n = countCurdate(readFileSync(file, "utf8"));
    if (n > 0) counts.set(path.relative(ROOT, file).split(path.sep).join("/"), n);
  }
  return counts;
}

const counts = scan();

if (baselineMode) {
  const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { entries: [] };
  const byFile = new Map(prev.entries.map((e) => [e.file, e]));
  const entries = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([file, count]) => ({
    file,
    count,
    effect: byFile.get(file)?.effect ?? "",
    // A new file gets NO reason: the gate fails until a human writes one, so a
    // re-baseline can never launder a new site in.
    reason: byFile.get(file)?.reason ?? "",
  }));
  writeFileSync(BASELINE, JSON.stringify({ ...prev, entries }, null, 2) + "\n");
  console.log(`curdate baseline written: ${entries.length} files, ${entries.reduce((n, e) => n + e.count, 0)} sites`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`curdate gate: no baseline at ${BASELINE} — run with --baseline first`);
  process.exit(1);
}
const list = JSON.parse(readFileSync(BASELINE, "utf8"));
const allowed = new Map(list.entries.map((e) => [e.file, e]));

const fresh = [];
const lowered = [];
for (const [file, n] of counts) {
  const b = allowed.get(file);
  if (!b || n > b.count) fresh.push({ file, n, was: b?.count ?? 0 });
}
for (const e of list.entries) {
  const n = counts.get(e.file) ?? 0;
  if (n < e.count) lowered.push({ file: e.file, n, was: e.count });
}
const missingReason = list.entries.filter((e) => !e.reason || !e.reason.trim() || !e.effect || !e.effect.trim());

const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`curdate gate — ${total} site(s) in ${counts.size} file(s); baseline ${list.entries.reduce((n, e) => n + e.count, 0)} in ${list.entries.length}`);

if (fresh.length) {
  console.error(`\n✗ NEW bare CURDATE() (session date is UTC — "today" flips at 8 PM Eastern):\n`);
  for (const f of fresh) console.error(`    ${f.file}  ${f.was} → ${f.n}`);
  console.error(
    `\n  Use the shop date instead:\n` +
      `    getBusinessDateKey() (server/lib/timezoneAssert.ts), passed as a parameter\n` +
      `    or DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')) in SQL\n`,
  );
}
if (lowered.length) {
  console.error(`\n✗ A site was fixed — lower the baseline so the slack cannot absorb a new one:\n`);
  for (const f of lowered) console.error(`    ${f.file}  ${f.was} → ${f.n}`);
  console.error(`\n  node scripts/lint-curdate.mjs --baseline  (keeps reasons)\n`);
}
if (missingReason.length) {
  console.error(`\n✗ ${missingReason.length} baseline entr(ies) without an effect class or reason:`);
  for (const e of missingReason) console.error(`    ${e.file}`);
}
if (fresh.length || lowered.length || missingReason.length) process.exit(1);
console.log("✓ no new bare CURDATE()");
