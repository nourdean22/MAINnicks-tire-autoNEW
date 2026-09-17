/**
 * Which `system_metrics` lanes are WRITTEN but never READ?
 *
 * THE DEFECT FAMILY THIS HUNTS. A metric lane is a writer and a reader that
 * only ever meet in the database. Nothing in TypeScript connects them, so the
 * two failure modes are invisible to the compiler and to every test:
 *
 *   · WRITER WITH NO READER — the turn pays to record it and nobody ever looks.
 *   · READER WITH NO WRITER — a panel or query that can only ever render empty,
 *     which reads as "nothing happened" rather than "nothing was recorded".
 *
 * WHAT THIS IS NOT. A code-grep cannot prove a lane is unused — the repo's own
 * operating profile says so, and says it twice, because two agents were refuted
 * in OPPOSITE directions on exactly that claim. So this reports CANDIDATES with
 * their evidence and never deletes anything.
 *
 * ⚠ WHY THIS IS A FUNCTION AND NOT A FLAT SCRIPT. The first version ran entirely
 * at module top level, so its tests could only re-implement the classification
 * beside it. That is a MIRROR: delete the `excludeSelf` call below and every
 * test stayed green while the self-reader bug returned. `runSweep` is exported
 * so `tests/scripts/metric-sweep.test.ts` drives THIS code against a fixture
 * tree — breaking the guard here now turns the suite red.
 *
 * Static only: no DB, no network. Usage:
 *   node apps/statenour/scripts/probe-metric-readers.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  WRITE_LITERAL,
  WRITE_CONST,
  collectDirectWrites,
  excludeSelf,
  isDataReader,
} from "./lib/metric-sweep.mjs";

const SCAN_DIRS = ["lib", "app", "components", "scripts", "config"];

/**
 * This file's own path, relative to the scan root — it scans `scripts/`, so it
 * scans ITSELF. Its source contains the literal `systemMetric` (in the reader
 * regex) and every `MUST_SEE` lane name, so without excluding it, it classifies
 * itself as the DATA reader for the orphans it exists to surface. It did:
 * `action.done.shadow` and `operation.integrity_shadow` both reported a reader,
 * and the summary said "1 lane nothing reads" when the honest answer was 8.
 */
export const SELF_REL = "scripts/probe-metric-readers.mjs";

/**
 * POSITIVE CONTROL — lanes this scan MUST be able to see.
 *
 * Not decoration: the first cut reported "2 metric lanes written" because it
 * only matched string literals, and three lanes passed as constants were
 * invisible. An under-reporting inventory is worse than none — it turns
 * "I could not parse these" into "these do not exist".
 */
export const MUST_SEE = [
  "tool.surfaced",
  "tool.chosen",
  "operation.integrity_shadow",
  "action.done.shadow",
  // Written via `prisma.systemMetric.create`, NOT recordMetric. Without a
  // direct-write lane in the control, the recordMetric matchers alone satisfy
  // it and the second write path can break with nothing going red.
  "specialist.route",
  "quality_bench.pass_rate",
];

/** Comments are prose, not code — the same rule the other source scans use. */
export function stripComments(src) {
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

const CONST_DECL = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*["'`]([a-zA-Z0-9_.\-]+)["'`]/g;

/**
 * @param {{ root: string, scanDirs?: string[], selfRel?: string,
 *           mustSee?: string[], minFiles?: number }} opts
 * @returns {{ abort: string|null, fileCount: number, lanes: Array<{metric,writtenBy,dataReaders,nameOnly}>,
 *             orphans: string[], unresolved: string[] }}
 */
export function runSweep(opts) {
  const root = opts.root;
  const scanDirs = opts.scanDirs ?? SCAN_DIRS;
  const selfRel = opts.selfRel ?? SELF_REL;
  const mustSee = opts.mustSee ?? MUST_SEE;
  const minFiles = opts.minFiles ?? 50;

  const files = scanDirs.flatMap((d) => walk(join(root, d)));
  if (files.length < minFiles) {
    return {
      abort: `only ${files.length} files found; the scan is not seeing the tree`,
      fileCount: files.length,
      lanes: [],
      orphans: [],
      unresolved: [],
    };
  }

  const sources = files.map((f) => ({ f, code: stripComments(readFileSync(f, "utf8")) }));
  const writers = new Map();
  const unresolved = [];

  for (const { f, code } of sources) {
    const rel = relative(root, f);
    // SELF-EXCLUSION APPLIES TO WRITES TOO, not just readers. This file's own
    // format string contains `systemMetric.create({ data: { metric: ${raw} } })`
    // as literal output text, which the direct-write matcher dutifully reported
    // as an unresolved write BY this probe — inflating the very "incomplete by
    // exactly this much" count the report asks you to trust. The probe writes
    // no metrics. A scanner must exclude itself from EVERY role it scans for.
    if (excludeSelf([rel], selfRel).length === 0) continue;
    const add = (name) => {
      if (!writers.has(name)) writers.set(name, []);
      if (!writers.get(name).includes(rel)) writers.get(name).push(rel);
    };

    const lit = new RegExp(WRITE_LITERAL.source, "g");
    let m;
    while ((m = lit.exec(code)) !== null) add(m[1]);

    // Direct prisma writes. Nonliteral names are REPORTED, never dropped —
    // dropping them is how an undercount gets presented as a full inventory.
    const direct = collectDirectWrites(code);
    for (const name of direct.literals) add(name);
    for (const raw of direct.nonliteral) {
      // Quote the expression loosely — the capture stops at the first `}` so a
      // template literal arrives truncated. Say "non-literal" plainly rather
      // than printing a mangled fragment that reads like the real source.
      const shown = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
      unresolved.push(`${rel}: systemMetric.create → non-literal metric name (${shown})`);
    }

    const consts = new Map();
    const cd = new RegExp(CONST_DECL.source, "g");
    let c;
    while ((c = cd.exec(code)) !== null) consts.set(c[1], c[2]);

    const wc = new RegExp(WRITE_CONST.source, "g");
    let k;
    while ((k = wc.exec(code)) !== null) {
      const ident = k[1];
      if (consts.has(ident)) {
        add(consts.get(ident));
        continue;
      }
      if (/^[a-z_$][\w$]*\.[\w$]+$/.test(ident) && consts.size > 0) {
        for (const v of consts.values()) add(v);
        continue;
      }
      unresolved.push(`${rel}: recordMetric…(${ident}, …)`);
    }
  }

  if (writers.size === 0) {
    return {
      abort: "no metric write call sites parsed — the matcher is wrong, not the codebase",
      fileCount: files.length,
      lanes: [],
      orphans: [],
      unresolved,
    };
  }

  const blind = mustSee.filter((m) => !writers.has(m));
  if (blind.length) {
    return {
      abort: `the scan could not see ${blind.length} known lane(s): ${blind.join(", ")}`,
      fileCount: files.length,
      lanes: [],
      orphans: [],
      unresolved,
    };
  }

  // Who NAMES each metric anywhere other than its own write call?
  const mentions = new Map();
  for (const metric of writers.keys()) {
    const needle = new RegExp(`["'\`]${metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`);
    const seen = new Set();
    for (const { f, code } of sources) {
      if (!needle.test(code)) continue;
      const rel = relative(root, f);
      const onlyWrites =
        writers.get(metric).includes(rel) &&
        !new RegExp(`metric\\s*[=:]{1,2}\\s*["'\`]${metric}`).test(code);
      if (onlyWrites) continue;
      seen.add(rel);
    }
    mentions.set(metric, seen);
  }

  // NAMING A LANE IS NOT READING ITS DATA. `instrument-failures.ts` lists
  // metric names so it can report WRITE FAILURES about them, by querying the
  // ERROR LOG. It never touches a metric row.
  const readsTable = new Map(
    sources.map(({ f, code }) => [relative(root, f), isDataReader(code)]),
  );

  const lanes = [];
  const orphans = [];
  for (const [metric, wfiles] of [...writers.entries()].sort()) {
    // excludeSelf BEFORE splitting: this script mentions every MUST_SEE lane
    // and matches the reader test on its own source, so leaving it in
    // manufactures a reader for exactly the lanes that have none.
    const all = excludeSelf(
      [...mentions.get(metric)].filter((r) => !wfiles.includes(r)),
      selfRel,
    );
    const dataReaders = all.filter((r) => readsTable.get(r));
    const nameOnly = all.filter((r) => !readsTable.get(r));
    lanes.push({ metric, writtenBy: [...new Set(wfiles)], dataReaders, nameOnly });
    if (dataReaders.length === 0) orphans.push(metric);
  }

  return { abort: null, fileCount: files.length, lanes, orphans, unresolved };
}

export function formatSweep(r) {
  const out = [];
  if (r.abort) {
    out.push(`ABORT — ${r.abort}.`);
    out.push("        A zero here would be a LIE. Fix the scan before trusting output.");
    return out;
  }
  out.push(`scanned ${r.fileCount} files · ${r.lanes.length} metric lanes written\n`);
  for (const l of r.lanes) {
    out.push(`  ${l.metric}`);
    out.push(`      written by:   ${l.writtenBy.join(", ")}`);
    out.push(
      `      DATA reader:  ${l.dataReaders.length ? l.dataReaders.join(", ") : "⚠ NONE — nothing queries these rows"}`,
    );
    if (l.nameOnly.length) {
      out.push(`      names only:   ${l.nameOnly.join(", ")}  (failure reporting, not a data reader)`);
    }
  }
  out.push(`\n${r.orphans.length} lane(s) whose DATA nothing reads: ${r.orphans.join(", ") || "none"}`);
  if (r.unresolved.length) {
    out.push(`\n⚠ ${r.unresolved.length} write call(s) whose metric name this scan COULD NOT resolve:`);
    for (const u of r.unresolved) out.push(`    ${u}`);
    out.push(
      "  These are a gap in the SCAN, not an absence in the code. The list above is\n" +
        "  incomplete by exactly this much — do not read it as a full inventory.",
    );
  }
  out.push(
    "\n⚠ CANDIDATES, NOT VERDICTS. A grep cannot prove a lane is unused — a reader\n" +
      "  may build the name dynamically, live in a SQL string, or sit in another app.\n" +
      "  Go look before concluding anything, and never delete on this alone.",
  );
  return out;
}

// CLI only — importing this module for tests must not run the scan or exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runSweep({ root: join(process.cwd(), "apps/statenour") });
  for (const line of formatSweep(result)) console.log(line);
  if (result.abort) process.exit(2);
}
