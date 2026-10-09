#!/usr/bin/env node
/**
 * Completion Authority — Definition-of-Done COMPILER.
 *
 * A checklist is too weak: requirements must be DERIVED from what actually
 * changed. This reads the diff against a base ref, maps touched paths to
 * mandatory completion requirements, and checks for FRESH evidence for each:
 * a per-PR fragment (.completion/evidence.d/<branch-slug>.json, preferred) or
 * the legacy manifest (.completion/evidence.json). With --enforce, missing
 * required evidence exits 1 — wired into CI so a PR cannot quietly claim
 * completion its diff does not support.
 *
 * Usage: node scripts/dod-compiler.mjs [--base origin/main] [--enforce]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  {
    id: "migration-evidence",
    match: /apps\/nickstire\/drizzle\/\d{4}_.*\.sql$|apps\/nickstire\/scripts\/apply-\d{4}.*\.mts$/,
    description: "Schema change: migration must have an idempotent apply script AND application evidence (or an explicit operator-pending note).",
  },
  {
    id: "publish-boundary-test",
    match: /apps\/nickstire\/server\/services\/socialPublish\.ts$|apps\/nickstire\/server\/services\/metaSocial\.ts$/,
    description: "Publish path touched: publish-boundary behavior (kill switches / cadence / claim gates) needs test evidence.",
  },
  {
    id: "render-spend-trajectory",
    match: /apps\/nickstire\/server\/services\/reelPipeline\.ts$|apps\/nickstire\/server\/services\/higgsfieldStudio\.ts$/,
    description: "Provider-spend path touched: trajectory test through the service boundary (policy + persistence) required.",
  },
  {
    id: "visual-world-trajectory",
    match: /visualWorld|facelessReelStudio\.ts$/,
    description: "Visual World touched: persisted-prompt trajectory evidence required (locked invariants reach the final payload).",
  },
  {
    id: "policy-matrix",
    match: /autonomyPolicy\.ts$|autonomyControl\.ts$/,
    description: "Policy engine touched: kill-switch/actor matrix tests required across caller paths.",
  },
  {
    id: "cron-fail-closed",
    match: /apps\/nickstire\/server\/cron\//,
    description: "Cron touched: non-operator fail-closed behavior needs test evidence.",
  },
  {
    id: "operator-walkthrough",
    match: /apps\/nickstire\/client\/src\/(pages|components)\/admin\//,
    description: "Operator UI touched: a walkthrough note (live or explicitly deferred with reason) is required.",
  },
  {
    id: "capability-ledger-updated",
    match: /apps\/nickstire\/(server\/services|client\/src\/lib)\//,
    description: "Capability code touched: docs/operations/capability-ledger.json must be part of the diff (states/evidence updated).",
    satisfiedByDiff: /apps\/nickstire\/docs\/operations\/capability-ledger\.json$/,
  },
];

const args = process.argv.slice(2);
const enforce = args.includes("--enforce");
const baseIdx = args.indexOf("--base");
const base = baseIdx >= 0 ? args[baseIdx + 1] : "origin/main";

/**
 * GIT NAMES ARE DATA, NEVER SHELL (2026-09-29). Every git call passes an argv
 * array (no shell), and every name list is read NUL-separated (-z). This file
 * used to build shell strings from `git ls-tree` output, so a fragment whose
 * NAME held $(...) or backticks ran as a command on every later CI run once it
 * was on main. And any name git C-quotes (a double quote, non-ASCII) came back
 * wrapped in quotes, so its value was lost and the untouched fragment read
 * FRESH. Pinned in scripts/agent-os/dodCompiler.test.mjs. `--base` is still a
 * revision git parses; it may not start with "-", or git reads it as an option
 * (`--output=<file>` writes a file).
 */
if (typeof base === "string" && base.startsWith("-")) {
  console.error(`--base must be a git revision, not an option (got ${JSON.stringify(base)})`);
  process.exit(2);
}
const git = (argv, opts = {}) => execFileSync("git", argv, { encoding: "utf8", ...opts });

const repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
let files = [];
try {
  files = git(["diff", "--name-only", "-z", `${base}...HEAD`], { cwd: repoRoot })
    .split("\0")
    .filter(Boolean);
} catch {
  console.error(`could not diff against ${base}`);
  process.exit(enforce ? 1 : 0);
}

const manifestPath = path.join(repoRoot, ".completion", "evidence.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { evidence: {} };

/**
 * EVIDENCE MUST BE FRESH, NOT MERELY PRESENT.
 *
 * Requirements are derived per-diff but the manifest lives on main, so an entry
 * written for an unrelated change months ago silently satisfied a NEW one.
 * Observed 2026-07-27: a PR touching server/services/ passed
 * `capability-ledger-updated` on a ref describing media-asset-registry and
 * drive-creative-vault — work with no relation to that diff. The gate reported
 * completion evidence that had never been produced for the thing it was
 * gating, which is the exact failure mode it exists to prevent, applied to
 * itself.
 *
 * An entry now counts only if THIS branch wrote or changed it. Reading the base
 * revision of the manifest is the whole check; a missing file at base means
 * every entry is new.
 */
let baseEvidence = {};
try {
  const raw = git(["show", `${base}:.completion/evidence.json`], { cwd: repoRoot, stdio: ["pipe", "pipe", "ignore"] });
  baseEvidence = JSON.parse(raw).evidence ?? {};
} catch {
  // No manifest at base — nothing can be stale.
}
const isFresh = (id) => JSON.stringify(manifest.evidence?.[id]) !== JSON.stringify(baseEvidence[id]);

/**
 * PER-PR EVIDENCE FRAGMENTS — .completion/evidence.d/<branch-slug>.json.
 *
 * The single manifest forced a merge conflict on every pair of concurrent PRs:
 * freshness means "this branch rewrote key X", so every PR touching
 * server/services rewrote `capability-ledger-updated` and the second to merge
 * always conflicted (2026-09-23: #2601, #2603, #2607, #2618 re-merged main 1-3x
 * each). A new file per PR cannot conflict.
 *
 * Same shape as the manifest: { "evidence": { "<requirement-id>": { ref | deferred } } }.
 * Freshness is by CONTENT, not by file: an entry counts only if its exact value
 * appears nowhere at the merge-base — not in any fragment there, not in the
 * legacy manifest, under any key. So an untouched fragment from an earlier PR,
 * a renamed or copied one, or a superseded entry pasted back all read STALE,
 * exactly as an untouched manifest entry does.
 */
const FRAGMENT_DIR = ".completion/evidence.d";
const fragmentProblems = [];
const entryKey = (v) => JSON.stringify(v);
const evidenceText = (value) => typeof value === "string" && value.trim().length > 0 ? value : null;
const evidenceRef = (ev) => evidenceText(ev?.ref);
const evidenceDeferred = (ev) => evidenceText(ev?.deferred);
const hasEvidence = (ev) => Boolean(evidenceRef(ev) || evidenceDeferred(ev));

let mergeBase = base;
try {
  mergeBase = git(["merge-base", base, "HEAD"], { cwd: repoRoot, stdio: ["pipe", "pipe", "ignore"] }).trim();
} catch {
  // Unrelated histories or a shallow clone: fall back to the base tip.
}

const baseValues = new Set(Object.values(baseEvidence).map(entryKey));
try {
  const legacyAtMergeBase = git(["show", `${mergeBase}:.completion/evidence.json`], {
    cwd: repoRoot, stdio: ["pipe", "pipe", "ignore"],
  });
  for (const v of Object.values(JSON.parse(legacyAtMergeBase).evidence ?? {})) baseValues.add(entryKey(v));
} catch {
  // No legacy manifest at the merge-base.
}
try {
  const listed = git(["ls-tree", "-r", "-z", "--name-only", mergeBase, "--", `${FRAGMENT_DIR}/`], {
    cwd: repoRoot, stdio: ["pipe", "pipe", "ignore"],
  }).split("\0").filter((f) => f.endsWith(".json"));
  for (const f of listed) {
    try {
      const raw = git(["show", `${mergeBase}:${f}`], { cwd: repoRoot, stdio: ["pipe", "pipe", "ignore"] });
      for (const v of Object.values(JSON.parse(raw).evidence ?? {})) baseValues.add(entryKey(v));
    } catch {
      // An unreadable fragment at base contributes nothing to compare against.
    }
  }
} catch {
  // No fragment directory at the merge-base.
}

/** requirement id -> [{ file, ev, fresh }] from the working tree's fragments. */
const fragmentEvidence = new Map();
const fragmentDirAbs = path.join(repoRoot, FRAGMENT_DIR);
if (existsSync(fragmentDirAbs)) {
  for (const name of readdirSync(fragmentDirAbs).filter((n) => n.endsWith(".json")).sort()) {
    const rel = `${FRAGMENT_DIR}/${name}`;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path.join(fragmentDirAbs, name), "utf8"));
    } catch (err) {
      fragmentProblems.push(`${rel}: not valid JSON (${err.message})`);
      continue;
    }
    for (const [id, ev] of Object.entries(parsed?.evidence ?? {})) {
      if (!fragmentEvidence.has(id)) fragmentEvidence.set(id, []);
      fragmentEvidence.get(id).push({ file: rel, ev, fresh: hasEvidence(ev) && !baseValues.has(entryKey(ev)) });
    }
  }
}

const requirements = [];
for (const rule of RULES) {
  const touched = files.filter((f) => rule.match.test(f));
  if (!touched.length) continue;
  const fromDiff = rule.satisfiedByDiff ? files.some((f) => rule.satisfiedByDiff.test(f)) : false;
  const frags = fragmentEvidence.get(rule.id) ?? [];
  const freshFrag = frags.find((f) => f.fresh);
  if (freshFrag) {
    requirements.push({
      id: rule.id,
      description: rule.description,
      touched: touched.length,
      status: fromDiff ? "passed" : evidenceRef(freshFrag.ev) ? "passed" : "deferred",
      evidence: fromDiff
        ? "(satisfied by diff)"
        : `${freshFrag.file}: ${evidenceRef(freshFrag.ev) ?? `DEFERRED: ${evidenceDeferred(freshFrag.ev)}`}`,
    });
    continue;
  }
  const legacyEv = manifest.evidence?.[rule.id];
  // A stale fragment is reported over an absent legacy entry, so the author sees WHICH file went stale.
  const staleFrag = !hasEvidence(legacyEv) ? frags.find((f) => hasEvidence(f.ev)) : undefined;
  const ev = staleFrag ? staleFrag.ev : legacyEv;
  const hasEntry = hasEvidence(ev);
  const fresh = !staleFrag && hasEntry && isFresh(rule.id);
  const status = fromDiff
    ? "passed"
    : fresh
      ? (evidenceDeferred(ev) ? "deferred" : "passed")
      : hasEntry
        ? "stale"
        : "missing";
  requirements.push({
    id: rule.id,
    description: rule.description,
    touched: touched.length,
    status,
    // A diff-satisfied pass prints a legacy entry only when THIS branch wrote it
    // (2026-10-08). Before, it printed whatever the manifest held, so a PR
    // touching server/services passed `capability-ledger-updated` with the text
    // of an unrelated earlier PR beside it ("'today-owed-texts' is rewritten
    // for the ROS-058 source") — the stale-evidence display the freshness rule
    // above exists to stop, through the one branch that skipped it.
    evidence: status === "stale"
      ? `${staleFrag ? `${staleFrag.file} ` : ""}written for an EARLIER change, not this diff — ${String(evidenceRef(ev) ?? evidenceDeferred(ev)).slice(0, 90)}`
      : fromDiff && !fresh
        ? "(satisfied by diff)"
        : evidenceRef(ev) ?? (evidenceDeferred(ev) ? `DEFERRED: ${evidenceDeferred(ev)}` : null),
  });
}

for (const p of fragmentProblems) console.error(`✗ evidence fragment unreadable — ${p}`);
if (fragmentProblems.length && enforce) process.exit(1);

if (!requirements.length) {
  console.log(`✓ DoD compiler: no completion requirements derived from ${files.length} changed files`);
  process.exit(0);
}

console.log(`DoD compiler — ${files.length} changed files vs ${base} → ${requirements.length} derived requirement(s):`);
let missing = 0;
for (const r of requirements) {
  const mark = r.status === "passed" ? "✓" : r.status === "deferred" ? "◐" : "✗";
  // STALE counts as missing: an entry written for an earlier change is not
  // evidence for this one, and treating it as such is what let this gate pass
  // itself on unrelated work.
  if (r.status === "missing" || r.status === "stale") missing++;
  console.log(`  ${mark} [${r.id}] (${r.touched} file${r.touched === 1 ? "" : "s"}) ${r.status.toUpperCase()}${r.evidence ? ` — ${r.evidence}` : ""}`);
  if (r.status === "missing" || r.status === "stale") console.log(`      ${r.description}`);
}
if (missing && enforce) {
  console.error(
    `\n✗ ${missing} required completion evidence item(s) missing or STALE.\n` +
    `  Add them to a NEW per-PR fragment, ${FRAGMENT_DIR}/<branch-slug>.json:\n` +
    `    { "evidence": { "<requirement-id>": { "ref": "..." } } }   (or { "deferred": "<reason>" })\n` +
    `  One file per PR never conflicts with a sibling PR. (Rewriting the legacy\n` +
    `  .completion/evidence.json entry still counts, but conflicts with every concurrent PR.)\n` +
    `  STALE means the entry EXISTS but was written for an earlier change — the same text\n` +
    `  is already on the base branch, so it is not evidence for YOUR diff.`,
  );
  process.exit(1);
}
console.log(missing ? `\n◐ ${missing} missing (advisory mode — pass --enforce to gate)` : "\n✓ all derived requirements have evidence or explicit deferral");
