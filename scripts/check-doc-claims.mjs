#!/usr/bin/env node
/**
 * check-doc-claims — resolve prose claims in docs against the repo.
 *
 * WHY THIS EXISTS. A doc claim is an unwired control, and it is worse than
 * one: an unwired control is merely absent, while a false doc claim actively
 * stops people looking. Measured on 2026-08-23, five in one sweep:
 *
 *   · apps/statenour/docs/DESIGN.md:5 — "Anti-slop verified at push time via
 *     scripts/check-anti-slop.sh (gate 13/13)". The script exists; it is in no
 *     hook, no workflow, and not in `verify:hard`. lefthook.yml pre-push runs
 *     exactly one command, `pnpm run build:affected`.
 *   · apps/statenour/scripts/check-anti-slop.sh:76 — prints an emergency
 *     override for a push hook that does not exist.
 *   · agent-os/standards/nourcity/enforced-gates.md:32 — lists check:anti-slop
 *     in a file titled "Enforced Gates" whose own opening says "These scripts
 *     are codified standards... not optional".
 *   · apps/nickstire/docs/admin-surface-audit/code-underneath-audit-logic.md:35
 *     — "every job in it duplicates a tiered job EXCEPT the two above."
 *     THE MOST EXPENSIVE LINE. Measured: 33 registered, 8 absent from
 *     scheduler.ts by name, 6 covered under different names, 2 genuinely dead
 *     (campaign-resume, sms-learning-digest). The sentence converted an
 *     incomplete search into a closed question and the class stopped being
 *     swept.
 *   · the same doc's headline row is now STALE: confirmation-calls and
 *     voice-recovery ARE tiered (scheduler.ts:992,1003, "MOVED to the hourly
 *     tier"), so it records a defect that has since been fixed.
 *
 * THREE CLAIM KINDS, in descending order of how much damage they do.
 *
 * 1. COMPLETENESS — "every X except", "the only", "all of the", "none of".
 *    Highest risk, because these close a question. Either a script keeps the
 *    question open, or the sentence is rewritten as a dated measurement:
 *    "as of <date>, measured N of M".
 * 2. GATE — "verified at push time", "enforced in CI", "runs on commit".
 *    RESOLVED, not just flagged: the named script must exist AND appear in the
 *    gate it claims.
 * 3. COUNT — a bare number asserted as fact. Flagged unless the same line or
 *    its neighbours name the command that reproduces it. A number without its
 *    command is a cache with no invalidation.
 *
 * Report-only by default. `--strict` exits 1 on unresolved GATE claims, which
 * are the only kind mechanically decidable enough to gate on.
 *
 * Usage:
 *   node scripts/check-doc-claims.mjs
 *   node scripts/check-doc-claims.mjs --strict
 *   node scripts/check-doc-claims.mjs --kind=gate
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";

const STRICT = process.argv.includes("--strict");
const KIND = process.argv.find((a) => a.startsWith("--kind="))?.slice(7) ?? "all";

/**
 * `--ref=<rev>` -- evaluate a COMMIT instead of the working tree.
 *
 * Added because the first CI run of this gate disagreed with every local run,
 * and the gate was right. Local: 707 files, 0 unresolved. CI: 722 files, 1
 * unresolved. Two independent causes, both invisible from inside the checkout:
 *
 *   - this checkout sits on a branch 192 commits behind origin/main, so
 *     `git ls-files` could not see 15 markdown files that exist on main;
 *   - a concurrent session had an UNCOMMITTED fix to the one false claim, so
 *     the scan read a corrected file that exists in no commit anywhere.
 *
 * A checker that reports on "the repo" while reading one dirty, stale checkout
 * is measuring the wrong subject and cannot support the sentence "the repo is
 * clean". With --ref it reads a named commit through git, so a local run and a
 * CI run of the same ref are the same measurement.
 *
 * Default stays the working tree: that is what a human editing docs wants.
 */
const REF = process.argv.find((a) => a.startsWith("--ref="))?.slice(6) ?? null;
const git = (cmd) => execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const NL = String.fromCharCode(10);

let repoFiles;
/** path -> content, populated in ONE batch when --ref is used. */
const refBlobs = new Map();

if (!REF) {
  repoFiles = git("git ls-files").split(NL).filter(Boolean);
} else {
  /*
   * ONE `git cat-file --batch` for the whole tree.
   *
   * The first --ref implementation ran `git show <ref>:<path>` per file. That
   * is 722+ process spawns, measured at 26s per sweep on Windows, and it pushed
   * the canary suite past a 120s timeout -- an O(files) subprocess loop wearing
   * the costume of a read. cat-file --batch streams every blob over a single
   * stdin/stdout pair instead.
   */
  /*
   * BLOBS ONLY. `git ls-tree -r` also lists SUBMODULE entries with type
   * `commit`, whose SHA is not a blob in this repository. cat-file answers
   * those with "<sha> missing" and NO size field, which desynchronises a
   * byte-offset walk -- and the first version of this loop did exactly that:
   * it stopped after 196 of 6,876 records and the checker went on to report
   * confident, plausible, wrong totals (28 completeness clauses instead of 41)
   * with no error at all. A reader that silently truncates is the same defect
   * class this whole script exists to find, so the count is now asserted below.
   */
  const entries = git(`git ls-tree -r ${JSON.stringify(REF)}`)
    .split(NL).filter(Boolean)
    .map((l) => {
      const [meta, path] = l.split(String.fromCharCode(9));
      const [, type, sha] = meta.split(" ");
      return { sha, path, type };
    })
    .filter((e) => e.type === "blob");
  repoFiles = entries.map((e) => e.path);

  const batch = spawnSync("git", ["cat-file", "--batch"], {
    input: entries.map((e) => e.sha).join(NL) + NL,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (batch.status !== 0) {
    console.error(`[check-doc-claims] git cat-file --batch failed for ${REF}`);
    process.exit(2);
  }
  /*
   * Each record is "<sha> blob <size>\n<payload>\n". Walk it by BYTE offset.
   * Slicing the decoded string by character index corrupts every file
   * containing a multi-byte character -- and this repo's docs are full of
   * em-dashes, which is exactly the silent-mojibake class it already tracks.
   */
  const buf = batch.stdout;
  let at = 0;
  for (const e of entries) {
    const nl = buf.indexOf(NL, at);
    if (nl < 0) break;
    const header = buf.toString("latin1", at, nl);
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) {
      console.error(`[check-doc-claims] FAILED TO PARSE cat-file record: ${JSON.stringify(header.slice(0, 80))}`);
      console.error(`  Stopping at ${refBlobs.size}/${entries.length} files rather than reporting a partial sweep as a clean one.`);
      process.exit(2);
    }
    const start = nl + 1;
    refBlobs.set(e.path, buf.toString("utf8", start, start + size));
    at = start + size + 1;
  }

  // MAKE THE SKIP LOUD. Exit 2 -- "the instrument is broken" -- never 0.
  // A short read here would otherwise surface as a smaller, entirely plausible
  // finding count, which is indistinguishable from a cleaner repo.
  if (refBlobs.size !== entries.length) {
    console.error(`[check-doc-claims] read ${refBlobs.size} of ${entries.length} blobs from ${REF} -- refusing to report a partial sweep`);
    process.exit(2);
  }
}

/** Read a repo-relative path from the ref under test, or from disk. */
function readRepoFile(path) {
  if (!REF) return readFileSync(path, "utf8");
  const blob = refBlobs.get(path);
  if (blob === undefined) throw new Error(`${path} not present in ${REF}`);
  return blob;
}
const hasRepoFile = (path) => (REF ? refBlobs.has(path) : existsSync(path));

/**
 * HISTORICAL RECORDS are not current-truth claims, and must not be re-dated.
 *
 * A document whose own name or location stamps its frame -- `_archive/`,
 * `90-archive/`, `research-packs/`, or an ISO date in the filename -- is a
 * record of what was true THEN. "Nothing calls it" inside
 * `db-cost-access-patterns-2026-05-12.md` is not a lying surface; it is a
 * correctly-framed measurement from May.
 *
 * This matters because the obvious remedy is wrong. Of 58 flagged clauses, 19
 * live in such files, and the mechanical fix -- append "as of 2026-08-23,
 * measured N of M" -- would assert a measurement NOBODY MADE TODAY. That is a
 * brand-new false claim, manufactured by the tool built to remove false claims,
 * in the name of tidying the report. One filter is the correct fix for all 19.
 *
 * The frame must be in the NAME or the PATH, not merely somewhere in the prose:
 * a date in the body is a claim like any other, and this rule would then be
 * self-granting -- any doc could exempt itself by mentioning a date.
 */
function isHistoricalRecord(f) {
  return (
    f.includes("/_archive/") ||
    f.startsWith("docs/90-archive/") ||
    f.startsWith("research-packs/") ||
    f.startsWith("AUDIT/") ||
    // ANY path SEGMENT, not just the filename. The first version tested only
    // `f.split("/").pop()` and missed
    // `docs/reel-packs/2026-08-17-road-salt-brake-lines/README.md`, where the
    // date frames the whole directory and the file is a bare README. A dated
    // folder stamps its contents exactly as a dated filename does.
    //
    // Segments only -- never the file BODY. A date in prose is a claim like any
    // other, and keying off it would let any document exempt itself by
    // mentioning a date.
    f.split("/").some((seg) => /\d{4}-\d{2}-\d{2}/.test(seg))
  );
}

const allDocs = repoFiles.filter(
  (f) =>
    f.endsWith(".md") &&
    !f.startsWith("node_modules/") &&
    !f.includes("/node_modules/") &&
    !f.startsWith("graphify-out/") &&
    !f.includes("CHANGELOG") &&
    // Skill and framework files are INSTRUCTIONS, not claims about repo state.
    !f.startsWith(".agents/") &&
    !f.includes("/skills/"),
);
const historicalDocs = allDocs.filter(isHistoricalRecord);
const docs = allDocs.filter((f) => !isHistoricalRecord(f));

/**
 * Files that decide whether something actually RUNS at a point in time.
 *
 * package.json is deliberately split into two roles, because conflating them
 * is how the FIRST version of this checker cleared DESIGN.md:5 as fine:
 * check-anti-slop.sh appears in package.json, so "is it in a gate?" answered
 * yes -- when all that proves is that somebody gave it an npm alias. Defining
 * a script is not running it. The checker had the exact defect it exists to
 * catch, which is the argument for the whole file.
 *
 *   INVOKERS   - hooks and workflows. A reference here means it actually runs.
 *   COMPOSITES - the VALUE side of package.json scripts (verify:hard chaining
 *                a dozen checks). A reference here means it runs when that
 *                composite runs. The KEY side never counts as coverage.
 */
const HOOK_FILES = ["lefthook.yml", ".husky/pre-push", ".husky/pre-commit"].filter(hasRepoFile);
const CI_FILES = repoFiles.filter((f) => f.startsWith(".github/workflows/")).filter(hasRepoFile);
const INVOKERS = [...HOOK_FILES, ...CI_FILES];

// Kept SEPARATE on purpose. Pooling them is the defect review caught: a claim
// of CI enforcement must not be satisfiable by a pre-push hook, nor a
// push-time claim by a workflow.
const surfaceText = {
  hook: HOOK_FILES.map((f) => readRepoFile(f)).join(String.fromCharCode(10)),
  ci: CI_FILES.map((f) => readRepoFile(f)).join(String.fromCharCode(10)),
};
surfaceText.any = [surfaceText.hook, surfaceText.ci].join(String.fromCharCode(10));
const invokerText = surfaceText.any;

const PKGS = repoFiles.filter((f) => f.endsWith("package.json") && !f.includes("node_modules"));

/**
 * THE SCRIPT GRAPH, and why a flat text scan is not enough.
 *
 * v3 of this checker filtered composites to values containing `&&`, to stop a
 * script's own one-line alias counting as coverage of itself. That was right,
 * and it broke the opposite case. Composites name ALIASES, not files:
 *
 *   "verify:hard":      "... && pnpm check:anti-slop && ..."
 *   "check:anti-slop":  "bash scripts/check-anti-slop.sh"
 *
 * Scanning composite VALUES for `check-anti-slop.sh` finds nothing, because the
 * composite says `check:anti-slop`. v3 therefore reported the script "appears
 * in no hook, workflow or composite gate" -- a RIGHT verdict (the doc claimed
 * push-time verification, which is false) reached through a WRONG mechanism
 * (it is in a composite; that composite is just never run automatically).
 * Shipping a right conclusion with an invented mechanism is the specific error
 * this repo already records against `api_request_logs`, and v3 repeated it.
 *
 * So: build the graph and WALK it, then classify by ENTRY POINT, because the
 * distinction that matters to a reader is not "is it reachable" but "does
 * anything run it without a human deciding to".
 *
 *   AUTOMATIC - reachable from a hook or workflow. A push or a PR runs it.
 *   MANUAL    - reachable only from a composite nothing invokes (`verify:hard`).
 *               Real coverage, zero enforcement. A doc may say "run X to check";
 *               it may NOT say "verified at push time".
 *   UNWIRED   - not reachable at all.
 */
const scripts = new Map(); // alias -> value, first definition wins
for (const f of PKGS.filter(hasRepoFile)) {
  try {
    for (const [k, v] of Object.entries(JSON.parse(readRepoFile(f)).scripts ?? {})) {
      if (typeof v === "string" && !scripts.has(k)) scripts.set(k, v);
    }
  } catch { /* unparseable package.json is not a claim about docs */ }
}

/** Aliases named inside a script value. Deliberately loose: `pnpm run x`, `pnpm x`, `npm run x`. */
function aliasesIn(value) {
  const out = new Set();
  for (const alias of scripts.keys()) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, String.fromCharCode(92) + "$&");
    if (new RegExp("(?:^|[\\s&|;])(?:pnpm|npm|yarn)(?:\\s+run)?\\s+" + escaped + "(?:\\s|$|&|;)").test(value)) {
      out.add(alias);
    }
  }
  return out;
}

/** Every alias transitively reachable from a set of roots. */
function reachableFrom(roots) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const a = queue.pop();
    if (seen.has(a) || !scripts.has(a)) continue;
    seen.add(a);
    for (const next of aliasesIn(scripts.get(a))) queue.push(next);
  }
  return seen;
}

// Roots that something OTHER than a human decides to run -- computed PER
// SURFACE, so "enforced in CI" cannot be satisfied by a pre-push hook.
function rootsIn(text) {
  return [...scripts.keys()].filter((a) => {
    const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, String.fromCharCode(92) + "$&");
    return new RegExp("(?:pnpm|npm|yarn)(?:\\s+run)?\\s+(?:--filter\\s+\\S+\\s+)?" + escaped + "(?:\\s|$)").test(text);
  });
}
const surfaceRoots = { hook: rootsIn(surfaceText.hook), ci: rootsIn(surfaceText.ci) };
surfaceRoots.any = [...new Set([...surfaceRoots.hook, ...surfaceRoots.ci])];
const surfaceAliases = {
  hook: reachableFrom(surfaceRoots.hook),
  ci: reachableFrom(surfaceRoots.ci),
  any: reachableFrom(surfaceRoots.any),
};
const automaticRoots = surfaceRoots.any;
const automaticAliases = surfaceAliases.any;
const allAliases = reachableFrom([...scripts.keys()]);

/** Which alias set does a given needle (a script FILE name) end up inside? */
function aliasesRunning(needle, set) {
  return [...set].filter((a) => (scripts.get(a) ?? "").includes(needle));
}

/**
 * The aliases a HUMAN would type to reach `needle` -- i.e. every alias whose
 * transitive closure contains one of the leaf aliases that names the file.
 *
 * Reporting only the leaf is technically true and useless: "check-anti-slop.sh
 * runs via check:anti-slop" tells a reader nothing they did not already infer
 * from the filename. The actionable fact is that `verify:hard` reaches it, so
 * the honest doc sentence is "run pnpm verify:hard", not "verified at push
 * time". The selftest below pins this, because the first version of the message
 * passed the tier check while carrying no usable information.
 */
function entryPointsFor(needle) {
  const leaves = aliasesRunning(needle, allAliases);
  if (!leaves.length) return [];
  const entries = [...scripts.keys()].filter((a) => {
    if (leaves.includes(a)) return false;
    const closure = reachableFrom([a]);
    return leaves.some((leaf) => closure.has(leaf));
  });
  return [...leaves, ...entries];
}

/**
 * COMPLETENESS, narrowed to claims about REPO STATE.
 *
 * The first draft matched any 'the only X' and returned 241 hits, mostly
 * ordinary prose in skill files ('Brave is the only source that indexes'),
 * which is a claim about the world, not a closed question about this
 * codebase. An inventory that is mostly false positives is a blind
 * instrument pointing the other way. These require a repo-state noun.
 */
const COMPLETENESS =
  /\b(every\s+(job|jobs|caller|callers|reader|readers|writer|writers|consumer|consumers|route|routes|script|scripts|gate|gates|hook|hooks|test|tests|file|files|column|columns|table|tables|endpoint|endpoints|migration|migrations|check|checks|producer|producers)\b[^.\n]{0,50}\b(except|but|apart from)|the only\s+(job|jobs|caller|callers|reader|readers|writer|writers|consumer|consumers|route|routes|script|scripts|gate|gates|hook|hooks|test|tests|file|files|column|columns|table|tables|endpoint|endpoints|migration|migrations|check|checks|producer|producers)\b|no other\s+(job|jobs|caller|callers|reader|readers|writer|writers|consumer|consumers|route|routes|script|scripts|gate|gates|hook|hooks|test|tests|file|files|column|columns|table|tables|endpoint|endpoints|migration|migrations|check|checks|producer|producers)\b|nothing\s+(else\s+)?(reads|writes|calls|references|consumes|emits)\b|all\s+\d+\s+(job|jobs|caller|callers|reader|readers|writer|writers|consumer|consumers|route|routes|script|scripts|gate|gates|hook|hooks|test|tests|file|files|column|columns|table|tables|endpoint|endpoints|migration|migrations|check|checks|producer|producers)\b)/i;
const GATE =
  /\b(verified|enforced|gated|blocked|checked|runs|validated)\b[^.\n]{0,60}\b(at push time|on push|pre-push|at commit time|on commit|pre-commit|in CI|by CI)\b/i;

/**
 * NEGATION -- a truthful statement that something is ABSENT is not a false
 * gate claim, and gating on it would punish the most honest sentences in the
 * repo. Raised in review against `CONSOLIDATION-PLAN-2026-05-16.md:84`, which
 * says E2E "never runs in CI" and was being reported as an unresolved claim.
 * Once --strict is wired, accurate documentation saying a check is missing
 * would hold the gate red exactly like a stale enforcement claim.
 *
 * Scoped to the words BETWEEN the verb and the surface, plus a short lead-in,
 * so "never runs in CI" is excluded while "runs in CI" is not.
 */
/**
 * NOT-A-CLAIM. Three families that match the COMPLETENESS regex while asserting
 * nothing about current repo state. Found by reading all 26 surviving hits
 * rather than trusting the count -- the same discipline that cut the GATE lane
 * from 8 to 2 real findings.
 *
 * Dating these would be worse than leaving them: "as of 2026-08-23" on a rule
 * ("Don't ship columns the UI reads but nothing writes") turns a timeless
 * instruction into a stale-looking measurement.
 *
 *   1. GUIDANCE -- teaches about the claim class or forbids a pattern. Includes
 *      docs/UPSTREAMS.md:177, which warns that a grep is "not evidence that
 *      nothing calls it" -- prose ABOUT false completeness claims, flagged as
 *      one. The checker cannot read its own doctrine.
 *   2. PAST TENSE -- describes a defect already fixed. truth_os.md:214, "the
 *      declined-work picker WAS READING a column nothing writes", is a repaired
 *      bug; re-dating it would assert the bug is current.
 *   3. AUDIT SELF-DESCRIPTION -- "the only file written is this document"
 *      is a statement about the audit session, not about the repo.
 */
const NOT_A_CLAIM = [
  /^\s*[-*]?\s*(don't|do not|never|avoid)\b/i,
  /\bnot evidence that\b|\bis not proof\b|\bdoes not prove\b/i,
  /\bif nothing else\b|\bif nothing\b.{0,20}\b(consumes|reads|calls)\b/i,
  /\b(was|were)\s+\w+ing\b|\bused to\b|\bno longer\b|\bpreviously\b|\bhas since been\b/i,
  /\bthe only file written\b|\bno code was changed\b|\bread-only audit\b/i,
];

const NEGATED =
  /\b(never|not|no longer|does not|doesn't|isn't|is not|are not|aren't|without|fails to|cannot|can't|nothing)\b/i;

/**
 * WHICH SURFACE DID THE CLAIM NAME?
 *
 * Raised in review, and it is the sharpest finding against this script: the
 * resolver POOLED every reference, so "`foo.sh` is enforced in CI" resolved
 * when foo.sh was wired only to pre-push, and "verified at push time" resolved
 * from an uninvoked composite. An instrument that answers "it runs SOMEWHERE"
 * to the question "does it run HERE" reports green for precisely the false
 * claims it was built to catch.
 *
 * So a claim is now resolved only against the surface it actually named.
 */
function claimedSurface(line) {
  if (/\b(in CI|by CI|in the CI|workflow|pipeline|on PRs?|pull request)\b/i.test(line)) return "ci";
  if (/\b(at push time|on push|pre-push|at commit time|on commit|pre-commit|hook)\b/i.test(line)) return "hook";
  return "any";
}
/**
 * COUNT, narrowed to asserted tallies. The first draft matched any 'N of M'
 * and returned 972 hits -- dates, version ranges, table rows. A count claim
 * is a number ATTACHED TO A REPO NOUN, or an explicit gate fraction.
 */
const COUNT =
  /\b\d{1,4}\s*(of|\/)\s*\d{1,4}\s+(job|jobs|caller|callers|reader|readers|writer|writers|consumer|consumers|route|routes|script|scripts|gate|gates|hook|hooks|test|tests|file|files|column|columns|table|tables|endpoint|endpoints|migration|migrations|check|checks|producer|producers)\b|\b\d{2,}\s+(job|jobs|caller|callers|reader|readers|writer|writers|consumer|consumers|route|routes|script|scripts|gate|gates|hook|hooks|test|tests|file|files|column|columns|table|tables|endpoint|endpoints|migration|migrations|check|checks|producer|producers)\b\s+(are|is|were|was|exist|remain|pass|passed|fail)|gate\s*\[?\d+\/\d+\]?/i;
const COMMAND_NEARBY = /`[^`]*(pnpm|npm|node|bash|git|tsx|psql|SELECT|grep)[^`]*`|```/i;

/** Pull a script path or `check:x` alias out of a claim line. */
function namedTarget(line) {
  const script = line.match(/`?((?:apps\/[\w-]+\/)?scripts\/[\w./-]+\.(?:sh|ts|mjs|js))`?/);
  if (script) return { kind: "script", value: script[1] };
  const alias = line.match(/`(check:[\w:-]+)`|\b(check:[\w:-]+)\b/);
  if (alias) return { kind: "alias", value: alias[1] ?? alias[2] };
  return null;
}

/**
 * KNOWN_FALSE -- claims that ARE false, are already being fixed elsewhere, and
 * must not block this gate from shipping. Modelled on PR #1808's cron-wiring
 * allowlist, deliberately, because a second design for the same idea is where
 * the next drift starts. Its three rules are kept:
 *
 *   1. every entry names WHY it is held and WHAT clears it -- an entry cannot
 *      outlive its justification;
 *   2. a REDUNDANT entry is an ERROR, not a shrug: once the claim resolves, the
 *      run fails until the entry is deleted (enforced above);
 *   3. exact locations only -- no globs, no prefixes. A pattern would silently
 *      absorb the next false claim in the same file.
 *
 * This is NOT a suppression list. A held entry is still printed, still marked
 * false, and still counted in the report. It only stops a claim that ANOTHER
 * session is mid-fix on from blocking an unrelated PR.
 */
const KNOWN_FALSE = [
  {
    at: "apps/statenour/docs/DESIGN.md:5",
    why: "check-anti-slop.sh is MANUAL (reachable only from verify:hard, which no hook or workflow runs), so 'verified at push time' is false. lefthook pre-push runs exactly one command: pnpm run build:affected.",
    until:
      "a concurrent session commits the DESIGN.md rewrite it already has in the working tree ('gate-checked by ... which runs inside pnpm verify:hard'). Not taken here because two sessions editing one line is the drift this repo keeps recording.",
  },
];

/** Does the named thing actually appear in a gate definition? */
function resolveGate(target, surface = "any") {
  if (!target) return { resolved: false, why: "claim names no script or alias to resolve" };
  const needle = target.kind === "script" ? target.value.split("/").pop() : target.value;

  if (target.kind === "script") {
    const found =
      (hasRepoFile(target.value) && target.value) ||
      repoFiles.find((f) => f.endsWith("/" + needle));
    if (!found) return { resolved: false, why: `script ${target.value} does not exist` };
  }

  // Resolve ONLY against the surface the claim named. `surface` is "hook",
  // "ci", or "any" -- see claimedSurface().
  const label = { hook: "a git hook", ci: "a CI workflow", any: "a hook or workflow" }[surface];

  if (surfaceText[surface].includes(needle)) {
    return { resolved: true, tier: "AUTOMATIC", why: `${needle} runs directly from ${label}` };
  }

  const auto = aliasesRunning(needle, surfaceAliases[surface]);
  if (auto.length) {
    return { resolved: true, tier: "AUTOMATIC", why: `${needle} runs via ${auto.join(", ")}, reachable from ${label}` };
  }

  // Reachable automatically, but from the OTHER surface. This is the case that
  // used to false-green: the claim says CI and the wiring is pre-push, or the
  // reverse. Named explicitly so the reader sees what is actually true.
  const other = surface === "hook" ? "ci" : surface === "ci" ? "hook" : null;
  if (other) {
    const elsewhere = surfaceText[other].includes(needle)
      ? [needle]
      : aliasesRunning(needle, surfaceAliases[other]);
    if (elsewhere.length) {
      return {
        resolved: false,
        tier: "WRONG-SURFACE",
        why: `${needle} IS automatic, but from ${other === "ci" ? "a CI workflow" : "a git hook"} -- the claim says ${surface === "ci" ? "CI" : "push/commit time"}`,
      };
    }
  }

  const manual = entryPointsFor(needle);
  if (manual.length) {
    // Reachable, but only if a human types it. Enough to justify "run X"; never
    // enough to justify "verified at push time" / "enforced" / "gated".
    return {
      resolved: false,
      tier: "MANUAL",
      why: `${needle} runs via ${manual.join(", ")}, but NO hook or workflow reaches those -- real coverage, zero enforcement`,
    };
  }

  return { resolved: false, tier: "UNWIRED", why: `${needle} is reachable from no npm script, hook or workflow` };
}

const findings = { completeness: [], gate: [], count: [] };

for (const doc of docs) {
  let text;
  try {
    text = readRepoFile(doc);
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${doc}:${i + 1}`;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(">")) return;

    if (GATE.test(line)) {
      // A truthful NEGATIVE is not a false claim. Skipping it here rather than
      // in the resolver keeps it out of the reported inventory entirely -- it
      // is not a finding at all, and listing it would train readers to ignore
      // the list.
      /*
       * A LEDGER ROW CITING ANOTHER FILE'S CLAIM IS NOT MAKING ONE.
       *
       * Scoped hard: a markdown table row whose FIRST CELL is a backticked
       * `path:line`. That is the shape the agent-audit ledgers use to quote a
       * false claim in order to document it — `| claim | reality |` tables —
       * and reading those as fresh claims made this gate red on the very
       * document that defines it.
       *
       * Stated Rule 7 rejected a BROAD version of this ("any line citing a
       * path:line is a citation"), because it would also have dropped
       * STATENOUR-ARCHITECTURE-INTELLIGENCE-REPORT.md:23, a genuine finding.
       * That rejection stands, and this is not it: that line is a numbered list
       * item, not a table row, and lives in the COMPLETENESS lane which this
       * filter does not touch. The stopping condition is "the first true
       * positive you lose", not "never narrow again" — the discipline is to
       * name which true positive a filter would cost and check it survives.
       */
      const isLedgerCitation = /^\|\s*`[\w./@-]+:\d+`/.test(trimmed);
      const m = line.match(GATE);
      const span = line.slice(Math.max(0, m.index - 24), m.index + m[0].length);
      if (!NEGATED.test(span) && !isLedgerCitation) {
        const target = namedTarget(line);
        const r = resolveGate(target, claimedSurface(line));
        findings.gate.push({ at, line: trimmed.slice(0, 150), ...r });
      }
    }
    if (COMPLETENESS.test(line) && !NOT_A_CLAIM.some((re) => re.test(line))) {
      const dated = /\bas of\b|\bmeasured\b|\d{4}-\d{2}-\d{2}/i.test(line);
      findings.completeness.push({ at, line: trimmed.slice(0, 150), dated });
    }
    if (COUNT.test(line)) {
      const ctx = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
      if (!COMMAND_NEARBY.test(ctx)) findings.count.push({ at, line: trimmed.slice(0, 150) });
    }
  });
}

const show = (k) => KIND === "all" || KIND === k;
let unresolvedGates = 0;

if (show("gate")) {
  /*
   * TWO KINDS OF "unresolved", and conflating them is why --strict could not
   * ship. Measured 2026-08-23: 8 gate findings, and 6 of the 8 bailed at
   * "claim names no script or alias to resolve" -- an unchecked `- [ ]` TODO,
   * a dated session log, a historical plan table, an UPSTREAMS adoption row, a
   * *proposed* edit quoted inside a proposal, and one claim that is simply
   * TRUE. A 75% false-positive rate is not a stricter gate, it is an inventory
   * nobody can act on: the same failure mode as a lint that flags everything.
   *
   *   UNRESOLVED - the claim NAMES a script, and that script does not resolve
   *                to a gate. Mechanically decidable, so --strict fails on it.
   *   VAGUE      - the sentence asserts gating but names nothing to check.
   *                Reported, never gated. Cannot be decided by this tool, and
   *                pretending otherwise is how a checker becomes noise.
   *
   * Do NOT "fix" the false-positive rate by deleting the VAGUE bucket. A doc
   * that says "this is enforced" while naming no enforcer is a real lying
   * surface -- it is just one a human has to adjudicate.
   */
  const all = findings.gate.filter((f) => !f.resolved && f.tier);
  const bad = all.filter((f) => !KNOWN_FALSE.some((k) => f.at === k.at));
  const held = all.filter((f) => KNOWN_FALSE.some((k) => f.at === k.at));
  const vague = findings.gate.filter((f) => !f.resolved && !f.tier);
  unresolvedGates = bad.length;

  /*
   * REDUNDANT ENTRIES ARE REJECTED -- the rule copied from PR #1808's cron
   * allowlist. An allowlist that silently tolerates entries whose problem is
   * already fixed becomes a permanent excuse list; making redundancy an ERROR
   * is what stops it. So an entry whose claim now RESOLVES fails the run.
   */
  const stale = KNOWN_FALSE.filter((k) => !all.some((f) => f.at === k.at));
  if (stale.length) {
    console.error(`\n  ✗ ${stale.length} KNOWN_FALSE entr(y/ies) no longer needed -- delete them:\n`);
    for (const k of stale) console.error(`      ${k.at} now resolves. ${k.until}`);
    unresolvedGates += stale.length;
  }
  if (held.length) {
    console.log(`\n  held by KNOWN_FALSE (already true, fix in flight -- not a pass):\n`);
    for (const f of held) {
      const k = KNOWN_FALSE.find((e) => e.at === f.at);
      console.log(`  ~ ${f.at}\n      ${f.line}\n      -> ${k.why}\n      -> clears when: ${k.until}\n`);
    }
  }

  console.log(
    `\n── GATE claims ── ${findings.gate.length} found · ` +
      `${bad.length} UNRESOLVED (gated by --strict) · ${vague.length} vague (reported only)\n`,
  );
  for (const f of bad) console.log(`  ✗ ${f.at}\n      ${f.line}\n      -> [${f.tier}] ${f.why}\n`);
  if (vague.length) {
    console.log(`  -- vague: asserts a gate, names no script. Human call, not a machine one.\n`);
    for (const f of vague) console.log(`  ? ${f.at}\n      ${f.line}\n`);
  }
}

if (show("completeness")) {
  const bare = findings.completeness.filter((f) => !f.dated);
  console.log(
    `\n── COMPLETENESS clauses ── ${findings.completeness.length} found, ${bare.length} undated\n` +
      `   These close a question. Each needs a script that keeps it open, or a dated measurement.\n`,
  );
  for (const f of bare.slice(0, 40)) console.log(`  ? ${f.at}\n      ${f.line}\n`);
  if (bare.length > 40) console.log(`  … ${bare.length - 40} more\n`);
}

if (show("count")) {
  console.log(
    `\n── COUNT claims with no reproducing command nearby ── ${findings.count.length}\n`,
  );
  for (const f of findings.count.slice(0, 25)) console.log(`  ? ${f.at}\n      ${f.line}\n`);
  if (findings.count.length > 25) console.log(`  … ${findings.count.length - 25} more\n`);
}

// MAKE THE SKIP LOUD (probe rule 5). A scan that excluded files prints the same
// green as one that found nothing, so the exclusion is stated on every run --
// never inferable only from a smaller number.
console.log(
  `\nscanned ${docs.length} markdown files · ` +
    `gate ${findings.gate.length} (${unresolvedGates} unresolved) · ` +
    `completeness ${findings.completeness.length} · count ${findings.count.length}` +
    `\nskipped ${historicalDocs.length} historical/archive files (date-stamped or archived: their frame is in the path, so re-dating them would assert a measurement nobody made). --show-skipped to list.`,
);
if (process.argv.includes("--show-skipped")) {
  for (const f of historicalDocs) console.log(`  skipped: ${f}`);
}

if (STRICT && unresolvedGates > 0) {
  console.error(`\n✗ ${unresolvedGates} unresolved GATE claim(s). A doc that names a gate must resolve to one.`);
  process.exit(1);
}

/**
 * SELF-TEST (`--selftest`). Runs the resolver against facts measured by hand,
 * because the sweep above exercised NONE of it: every surviving gate finding
 * bailed at "claim names no script or alias to resolve", so the three-tier walk
 * never executed. A run where the interesting branch is never taken is not
 * evidence the branch works -- it is the blind-instrument shape one level up.
 * See docs/agent-audit/DEFECT-SHAPE-ORPHANED-SUBJECT.md, shape 4.
 *
 * Each case names the tier AND the reason, so a refactor that keeps the verdict
 * while losing the mechanism still fails -- that mechanism-vs-verdict split is
 * exactly what v3 got wrong.
 */
if (process.argv.includes("--selftest")) {
  const cases = [
    {
      // MANUAL: reachable only through verify:hard, which no hook or workflow runs.
      // This is the case v3 misreported as "appears in no composite".
      // Assert the TIER and the leaf alias only. An earlier version also
      // required the message to name `verify:hard`, which passed locally and
      // FAILED in CI: `verify:hard` reaches check:anti-slop only in a sibling
      // session's UNCOMMITTED package.json (origin/main has 17 links, not 18).
      // Pinning a canary to a state that exists in one working tree and nowhere
      // else is a blind instrument aimed at the checkout instead of the repo.
      target: { kind: "script", value: "scripts/check-anti-slop.sh" },
      tier: "MANUAL",
      mentions: "check:anti-slop",
    },
    {
      // UNWIRED vs MISSING are different answers; a named script that does not
      // exist must not be reported as merely unwired.
      target: { kind: "script", value: "scripts/pre-push-check.sh" },
      tier: undefined,
      why: "does not exist",
    },
    {
      // SURFACE MATCHING, the case review reproduced against the pooled
      // resolver: `build:affected` is in lefthook pre-push and in NO workflow.
      // A push-time claim about it is TRUE...
      target: { kind: "alias", value: "build:affected" },
      surface: "hook",
      tier: "AUTOMATIC",
      mentions: "a git hook",
    },
    {
      // ...and the identical script claimed as CI enforcement is FALSE. The
      // pooled resolver returned AUTOMATIC for both and exited 0 under
      // --strict, reporting green for exactly the false claim it exists to
      // catch. WRONG-SURFACE is the answer that distinguishes them.
      target: { kind: "alias", value: "build:affected" },
      surface: "ci",
      tier: "WRONG-SURFACE",
      mentions: "the claim says CI",
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = resolveGate(c.target, c.surface ?? "any");
    const tierOk = got.tier === c.tier;
    const whyOk = c.mentions ? got.why.includes(c.mentions) : got.why.includes(c.why);
    if (!tierOk || !whyOk) {
      failed++;
      console.error(`  SELFTEST FAIL ${c.target.value}`);
      console.error(`    tier  expected ${c.tier} got ${got.tier}`);
      console.error(`    why   ${got.why}`);
    } else {
      console.log(`  selftest ok  ${c.target.value} -> ${got.tier ?? "MISSING"} (${got.why})`);
    }
  }

  // BREAKING ARM -- and the first version of it did not bite.
  //
  // It asserted `automaticAliases.size > 0`. But reachableFrom() seeds the queue
  // with its roots and adds them before walking, so a completely dead walk
  // (aliasesIn returning nothing) STILL reports 16 automatic aliases: the roots
  // themselves. The guard reported healthy against a walk that traversed zero
  // edges -- a canary that cannot fail is the thing this file exists to catch.
  //
  // The second version asserted the AUTOMATIC closure must be strictly larger
  // than its root set. That failed against an unbroken repo: all 16 hook- and
  // CI-invoked aliases call leaf tasks directly (`pnpm --filter x lint`), so
  // they chain to nothing and traversal is legitimately 0. The arm was encoding
  // an assumption about CI's shape, not a property of the walk -- and it took
  // running the CONTROL to find that out, which is the whole argument for
  // running the control every time instead of only the broken arms.
  //
  // Third version asserts a specific edge measured by hand: verify:hard names
  // check:anti-slop, so the closure of verify:hard must contain it. That dies
  // if aliasesIn stops matching, and it makes no claim about CI's topology.
  // Must be an edge that exists on ORIGIN/MAIN. `verify:hard -> check:anti-slop`
  // was the first choice and it only exists in one session's uncommitted tree;
  // `check:raw-sql` is link 9 of verify:hard's 17 on main.
  const KNOWN_EDGE = { from: "verify:hard", to: "check:raw-sql" };
  if (!scripts.has(KNOWN_EDGE.from)) {
    failed++;
    console.error(`  SELFTEST FAIL: ${KNOWN_EDGE.from} is gone -- re-measure the known edge, do not delete this arm`);
  } else if (!reachableFrom([KNOWN_EDGE.from]).has(KNOWN_EDGE.to)) {
    failed++;
    console.error(`  SELFTEST FAIL: the walk cannot get from ${KNOWN_EDGE.from} to ${KNOWN_EDGE.to} -- the walk is broken, not the repo`);
  } else {
    console.log(`  selftest ok  walk traverses ${KNOWN_EDGE.from} -> ${KNOWN_EDGE.to} (${automaticRoots.length} automatic roots, ${allAliases.size} aliases known)`);
  }

  if (failed) { console.error(`\n✗ ${failed} selftest failure(s)`); process.exit(1); }
  console.log(`\n✓ selftest passed`);
}
