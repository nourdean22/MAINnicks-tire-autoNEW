/**
 * Single scanner for the fail-open source-slice class.
 *
 * THE CLASS. `src.slice(start, src.indexOf("marker"))` silently WIDENS when the
 * marker is absent: indexOf returns -1, and String.slice reads a negative `end`
 * as an offset from the end of the string, so the region runs to one character
 * before EOF. A `toContain` over it then passes on unrelated text.
 *
 * WHY THIS IS A MODULE AND NOT INLINE IN THE GATE. The gate and the baseline
 * regenerator have to agree exactly; a copy in each drifted twice while this
 * change was being written, which is the same two-copies-of-one-rule defect the
 * gate exists to catch. One implementation, two importers.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** Two-arg slice whose END is an unguarded indexOf. */
export const FAIL_OPEN = /\.slice\([^,]+,\s*\w+\.indexOf\(/;

/**
 * Deliberate uses opt out with this marker, either trailing the slice line or
 * on the line directly above it. These lines are frequently long, so requiring
 * a trailing comment would push authors to reformat working code to silence a
 * gate — and a gate that forces churn gets deleted.
 */
export const OPT_OUT = "fail-open-slice-ok";

const ROOTS = ["server", "scripts", "client"];
const EXT = /\.(ts|tsx|mts|mjs)$/;
const SKIP_DIR = /node_modules|dist|\.turbo|coverage|prerendered/;

/** A site is exempt if the marker is on its own line or the one before it. */
export function isOptedOut(lines, i) {
  return lines[i].includes(OPT_OUT) || (i > 0 && lines[i - 1].includes(OPT_OUT));
}

/**
 * MENTION vs EXECUTION. A comment that quotes the pattern is documentation, not
 * a fail-open slice. Every guard in this repo that skipped this check has gone
 * on to block its own docs — including this one, on its first run, against the
 * doc-comment at the top of this very file. `guard-red-team` names it as the
 * single largest source of guard false positives, and the failure mode is worse
 * than a miss: a gate that fails on prose teaches people to delete the gate.
 *
 * A line-level heuristic is enough here, because the pattern only matters as
 * executable code and executable code is not indented under a `*`.
 */
export function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIR.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(entry)) out.push(full);
  }
  return out;
}

/**
 * @returns {Record<string, number>} repo-relative file -> fail-open site count,
 *   sorted by path, omitting files with none.
 */
export function scanFailOpenSlices(appRoot) {
  const counts = {};
  for (const root of ROOTS) {
    for (const file of walk(resolve(appRoot, root))) {
      const rel = relative(appRoot, file).replace(/\\/g, "/");
      const lines = readFileSync(file, "utf8").split("\n");
      let n = 0;
      for (let i = 0; i < lines.length; i++) {
        if (FAIL_OPEN.test(lines[i]) && !isCommentLine(lines[i]) && !isOptedOut(lines, i)) n++;
      }
      if (n > 0) counts[rel] = n;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
