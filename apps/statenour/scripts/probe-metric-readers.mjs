/**
 * Which `system_metrics` lanes are WRITTEN but never READ?
 *
 * THE DEFECT FAMILY THIS HUNTS. A metric lane is a writer and a reader that
 * only ever meet in the database. Nothing in TypeScript connects them, so the
 * two failure modes are invisible to the compiler and to every test:
 *
 *   · WRITER WITH NO READER — the turn pays to record it and nobody ever looks.
 *     `tool.chosen` shipped that way on 2026-09-17 and it took a self-audit to
 *     notice, one PR after I criticised the same shape in my own work.
 *   · READER WITH NO WRITER — a panel or query that can only ever render empty,
 *     which reads as "nothing happened" rather than "nothing was recorded".
 *
 * WHAT THIS IS NOT. A code-grep cannot prove a lane is unused — the repo's own
 * operating profile says so, and says it twice, because two agents were refuted
 * in OPPOSITE directions on exactly that claim. So this reports CANDIDATES with
 * their evidence and never deletes anything. Treat a finding as "go look",
 * not as "remove it".
 *
 * Static only: no DB, no network. Usage:
 *   node apps/statenour/scripts/probe-metric-readers.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(process.cwd(), "apps/statenour");
const SCAN_DIRS = ["lib", "app", "components", "scripts", "config"];

/** Comments are prose, not code — the same rule the other source scans use. */
function stripComments(src) {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, acc);
    } else if (/\.(ts|tsx|mjs)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
if (files.length < 50) {
  console.error(`ABORT — only ${files.length} files found; the scan is not seeing the tree.`);
  process.exit(2);
}

// `recordMetric("name"` / `recordMetricStrict(\n  "name"` — the name may sit on
// the next line, which is why this is not a single-line grep.
const WRITE = /recordMetric(?:Strict)?\s*\(\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;

/**
 * …and the same call with a CONSTANT instead of a literal.
 *
 * ⚠ THE FIRST CUT OF THIS SCAN MISSED THREE LANES and reported "2 metric lanes
 * written" with a straight face. `tool.chosen`, `operation.integrity_shadow`
 * and `action.done.shadow` are all passed as identifiers —
 * `recordMetricStrict(w.metric, …)` and `recordMetricStrict(ACTION_DONE_SHADOW_METRIC, …)`
 * — so a literal-only matcher cannot see them. An under-reporting sweep is
 * worse than no sweep: it produces a confident all-clear over the lanes it
 * cannot parse.
 *
 * That is the same blind spot a refactor of mine introduced into
 * `instrument-failures.test.ts` the same day, which is why that file now keeps
 * the literal at the builder. Here the fix is to resolve single-file string
 * constants, and to SAY when a name still cannot be resolved rather than
 * silently dropping it.
 */
const WRITE_CONST = /recordMetric(?:Strict)?\s*\(\s*([A-Za-z_$][\w$]*(?:\.[\w$]+)?)\s*,/g;
const CONST_DECL = /\b(?:const|let)\s+([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;
// A reader names the metric in a query or a filter, not in a write call.
const writers = new Map(); // metric -> [file]
const mentions = new Map(); // metric -> Set<file>

const sources = files.map((f) => ({ f, code: stripComments(readFileSync(f, "utf8")) }));

/** Names passed as an identifier that this scan could not resolve to a string. */
const unresolved = [];

for (const { f, code } of sources) {
  const rel = relative(ROOT, f);
  const add = (name) => {
    if (!writers.has(name)) writers.set(name, []);
    writers.get(name).push(rel);
  };

  WRITE.lastIndex = 0;
  let m;
  while ((m = WRITE.exec(code)) !== null) add(m[1]);

  // Constants declared in the SAME file, e.g.
  //   const CHOSEN_TOOLS_METRIC = "tool.chosen";
  //   recordMetricStrict(CHOSEN_TOOLS_METRIC, …)
  const consts = new Map();
  CONST_DECL.lastIndex = 0;
  let c;
  while ((c = CONST_DECL.exec(code)) !== null) consts.set(c[1], c[2]);

  WRITE_CONST.lastIndex = 0;
  let k;
  while ((k = WRITE_CONST.exec(code)) !== null) {
    const ident = k[1];
    if (consts.has(ident)) {
      add(consts.get(ident));
      continue;
    }
    // A property access like `w.metric` is a payload field — resolve it to the
    // metric constants declared in the same file, since that is the shape the
    // builder pattern produces. Anything still unresolved is REPORTED, never
    // dropped: a name this scan cannot read is a gap in the scan, not an
    // absence in the code.
    if (/^[a-z_$][\w$]*\.[\w$]+$/.test(ident) && consts.size > 0) {
      for (const v of consts.values()) add(v);
      continue;
    }
    unresolved.push(`${rel}: recordMetric…(${ident}, …)`);
  }
}

if (writers.size === 0) {
  console.error("ABORT — no recordMetric call sites parsed. The matcher is wrong,");
  console.error("        not the codebase. (A zero here would be a LIE.)");
  process.exit(2);
}

/**
 * POSITIVE CONTROL — lanes this scan MUST be able to see.
 *
 * Not decoration: the first cut of this file reported "2 metric lanes written"
 * because it only matched string literals, and three lanes passed as constants
 * were invisible. It printed that with complete confidence. An under-reporting
 * inventory is worse than none — it turns "I could not parse these" into "these
 * do not exist".
 *
 * These names are the ones `KNOWN_INSTRUMENTS` registers, so they are a fact
 * about the codebase, not about this script's regexes. If the scan cannot find
 * one, the scan is broken and must say so instead of printing a shorter list.
 */
const MUST_SEE = ["tool.surfaced", "tool.chosen", "operation.integrity_shadow", "action.done.shadow"];
const blind = MUST_SEE.filter((m) => !writers.has(m));
if (blind.length) {
  console.error(`ABORT — the scan could not see ${blind.length} known lane(s): ${blind.join(", ")}`);
  console.error("        The matcher is under-reporting. Fix it before trusting any output;");
  console.error("        a shorter list would read as 'these do not exist'.");
  process.exit(2);
}

// Second pass: who NAMES each metric anywhere other than its own write call?
for (const metric of writers.keys()) {
  const needle = new RegExp(`["'\`]${metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
  const seen = new Set();
  for (const { f, code } of sources) {
    if (!needle.test(code)) continue;
    const rel = relative(ROOT, f);
    // A file that only writes it is not a reader of it.
    const onlyWrites =
      writers.get(metric).includes(rel) &&
      !new RegExp(`metric\\s*[=:]{1,2}\\s*["'\`]${metric}`).test(code) &&
      !code.includes(`metric = '${metric}'`) &&
      !code.includes(`metric='${metric}'`);
    if (onlyWrites) continue;
    seen.add(rel);
  }
  mentions.set(metric, seen);
}

/**
 * NAMING A LANE IS NOT READING ITS DATA — and conflating them hides the very
 * thing this scan is for.
 *
 * `instrument-failures.ts` lists metric names so it can report WRITE FAILURES
 * about them, by querying the ERROR LOG. It never touches a single metric row.
 * Counting it as a reader would have told me `action.done.shadow`,
 * `operation.integrity_shadow` and `tool.chosen` all have readers — when what
 * they have is failure reporting and no consumer of the numbers they collect.
 *
 * A DATA reader is a file that actually queries `system_metrics`.
 */
const readsMetricTable = new Map(
  sources.map(({ f, code }) => [
    relative(ROOT, f),
    /system_metrics|systemMetric\b/.test(code),
  ]),
);

console.log(`scanned ${files.length} files · ${writers.size} metric lanes written\n`);
const orphans = [];
for (const [metric, wfiles] of [...writers.entries()].sort()) {
  const all = [...mentions.get(metric)].filter((r) => !wfiles.includes(r));
  const dataReaders = all.filter((r) => readsMetricTable.get(r));
  const nameOnly = all.filter((r) => !readsMetricTable.get(r));
  console.log(`  ${metric}`);
  console.log(`      written by:   ${[...new Set(wfiles)].join(", ")}`);
  console.log(
    `      DATA reader:  ${dataReaders.length ? dataReaders.join(", ") : "⚠ NONE — nothing queries these rows"}`,
  );
  if (nameOnly.length) {
    console.log(`      names only:   ${nameOnly.join(", ")}  (failure reporting, not a data reader)`);
  }
  if (dataReaders.length === 0) orphans.push(metric);
}

console.log(
  `\n${orphans.length} lane(s) whose DATA nothing reads: ` + (orphans.join(", ") || "none"),
);
if (unresolved.length) {
  console.log(`\n⚠ ${unresolved.length} write call(s) whose metric name this scan COULD NOT resolve:`);
  for (const u of unresolved) console.log(`    ${u}`);
  console.log(
    "  These are a gap in the SCAN, not an absence in the code. The list above is\n" +
      "  incomplete by exactly this much — do not read it as a full inventory.",
  );
}

console.log(
  "\n⚠ CANDIDATES, NOT VERDICTS. A grep cannot prove a lane is unused — a reader\n" +
    "  may build the name dynamically, live in a SQL string, or sit in another app.\n" +
    "  Go look before concluding anything, and never delete on this alone.",
);
