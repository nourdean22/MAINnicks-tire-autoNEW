/**
 * Pure parsing helpers for the tier-4 keyword-family probes.
 *
 * WHY A SEPARATE MODULE. These were inline in `probe-family-collisions.mjs`,
 * which meant the probe's conclusions rested on regexes nothing tested. Review
 * found the first consequence within a day: the family scanner read RAW source,
 * so `addMatching(/file/i)` written inside a COMMENT at chat-mode.ts:388 was
 * counted as a live family. Every downstream number — family count, per-family
 * cost, and the reachability verdict — included logic that never executes.
 *
 * That is the same comment-blind-scanner defect as the instrument-failures
 * source scan, found twice in one day in two different files. Hence: pure
 * functions, exported, with a test file that breaks each one.
 */

/**
 * Remove comments while PRESERVING line numbers.
 *
 * A plain `.replace(/\/\*[\s\S]*?\*\//g, "")` collapses multi-line comments and
 * shifts every line number after them, which would make the probe report the
 * wrong `chat-mode.ts:NNN` for each family — a citation that sends the next
 * reader to unrelated code is worse than none. Block comments are replaced by
 * their own newlines instead.
 *
 * ⚠ `\r\n` is normalised FIRST. In a JS regex `.` excludes line terminators and
 * `\r` is one, so on a CRLF checkout `l.replace(/\/\/.*$/, "")` matches NOTHING
 * and every line comment survives. That exact bug was live in this repo's
 * instrument-failures scan.
 */
export function stripCommentsKeepingLines(src) {
  return src
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) || []).length))
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

const ADD_MATCHING = /addMatching\(\s*\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)\s*\)/g;

/**
 * Every EXECUTABLE `addMatching(/.../)` in the source, with its trigger.
 *
 * The trigger matters and used to be ignored. Each family sits inside an
 * `if (/user-text regex/.test(text))`, so two families that both match a tool
 * are NOT interchangeable — they fire on different user text. A reachability
 * claim that ignores this reports `getCommitments` as "still reachable" after
 * it loses the life-goal family's accidental `/mit/` match, even though on
 * "what are my OKRs?" the surviving `/commit/` families never fire at all.
 */
export function parseFamilies(rawSource) {
  const src = stripCommentsKeepingLines(rawSource);
  const lines = src.split("\n");
  const out = [];
  let m;
  ADD_MATCHING.lastIndex = 0;
  while ((m = ADD_MATCHING.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    const flags = m[2].replace("g", "");
    out.push({
      line,
      src: `/${m[1]}/${m[2]}`,
      re: new RegExp(m[1], flags),
      reAll: new RegExp(m[1], flags.includes("g") ? flags : flags + "g"),
      trigger: findTrigger(lines, line),
    });
  }
  return out;
}

/**
 * The nearest enclosing `if (...)` above a family, as raw text.
 *
 * Deliberately a scan and not a parse: an `if` condition here may span lines and
 * the probe only needs an IDENTITY for the guard, so that two families can be
 * compared for "same trigger or not". Returns null when none is found within a
 * short window, and the caller must treat null as UNKNOWN rather than as "no
 * guard" — an unknown trigger cannot prove two families are interchangeable.
 */
export function findTrigger(lines, familyLine, lookback = 12) {
  for (let i = familyLine - 2; i >= Math.max(0, familyLine - 2 - lookback); i--) {
    const l = lines[i];
    if (l === undefined) continue;
    const idx = l.indexOf("if (");
    if (idx !== -1) {
      // Gather until the condition's closing `) {`, so multi-line conditions
      // produce one stable identity rather than a truncated first line.
      let text = l.slice(idx);
      let j = i;
      while (!/\)\s*\{\s*$/.test(text) && j < familyLine - 1) {
        j++;
        text += " " + (lines[j] ?? "").trim();
      }
      return text.replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

/** Byte offsets at which a camelCase/underscore/dot token begins. */
export function tokenStarts(name) {
  const starts = new Set([0]);
  for (let i = 1; i < name.length; i++) {
    const prev = name[i - 1];
    const ch = name[i];
    if (ch === "_" || ch === ".") continue;
    if (prev === "_" || prev === ".") starts.add(i);
    else if (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)) starts.add(i);
    else if (/[A-Z]/.test(prev) && /[A-Z]/.test(ch) && /[a-z]/.test(name[i + 1] ?? "")) starts.add(i);
  }
  return starts;
}

/** Does `p` match `name` starting at a camelCase token boundary? */
export function matchesAtTokenStart(p, name) {
  const starts = tokenStarts(name);
  p.reAll.lastIndex = 0;
  let hit;
  while ((hit = p.reAll.exec(name)) !== null) {
    if (starts.has(hit.index)) return true;
    if (hit.index === p.reAll.lastIndex) p.reAll.lastIndex++; // zero-width guard
  }
  return false;
}

/**
 * Per-tool reachability under the token-boundary rule, TRIGGER-AWARE.
 *
 * Three outcomes, and the middle one is the whole point of the rewrite:
 *
 *   · "safe"          — every lost family has a surviving sibling under the
 *                       SAME trigger, so no user phrasing loses the tool.
 *   · "conditionally" — the tool survives only via a family with a DIFFERENT
 *                       trigger. On text that fires only the lost family's
 *                       trigger, the tool goes dark. The earlier version of
 *                       this probe scored these as plainly safe, which made
 *                       its NET verdict an upper bound on safety presented as
 *                       a certainty.
 *   · "dark"          — no family matches at all any more.
 */
export function classifyReachability(patterns, name) {
  const before = patterns.filter((p) => p.re.test(name));
  if (before.length === 0) return { verdict: "unmatched", before, after: [], lost: [] };
  const after = before.filter((p) => matchesAtTokenStart(p, name));
  const lost = before.filter((p) => !matchesAtTokenStart(p, name));
  if (after.length === 0) return { verdict: "dark", before, after, lost };
  if (lost.length === 0) return { verdict: "unchanged", before, after, lost };

  const survivingTriggers = new Set(after.map((p) => p.trigger));
  // A null trigger is UNKNOWN, never a match — it cannot prove equivalence.
  const everyLostCovered = lost.every(
    (p) => p.trigger !== null && survivingTriggers.has(p.trigger),
  );
  return { verdict: everyLostCovered ? "safe" : "conditionally", before, after, lost };
}
