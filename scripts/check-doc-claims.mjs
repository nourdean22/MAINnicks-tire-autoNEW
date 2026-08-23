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
import { execSync } from "node:child_process";

const STRICT = process.argv.includes("--strict");
const KIND = process.argv.find((a) => a.startsWith("--kind="))?.slice(7) ?? "all";

const repoFiles = execSync("git ls-files", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .filter(Boolean);

const docs = repoFiles.filter(
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
const INVOKERS = [
  "lefthook.yml",
  ...repoFiles.filter((f) => f.startsWith(".github/workflows/")),
].filter(existsSync);
const invokerText = INVOKERS.map((f) => readFileSync(f, "utf8")).join(String.fromCharCode(10));

const PKGS = repoFiles.filter((f) => f.endsWith("package.json") && !f.includes("node_modules"));
const compositeText = PKGS.filter(existsSync)
  .map((f) => {
    // COMPOSITES ONLY. A script value that runs exactly one command is that
    // script's own alias, not coverage of it -- counting it is how the second
    // version of this checker STILL cleared DESIGN.md:5:
    //   "check:anti-slop": "bash scripts/check-anti-slop.sh"
    // contains the filename, so a naive value-scan says "covered". A composite
    // chains (&&), which is what makes membership in it mean something.
    try {
      return Object.values(JSON.parse(readFileSync(f, "utf8")).scripts ?? {})
        .filter((v) => typeof v === "string" && v.includes("&&"))
        .join(String.fromCharCode(10));
    }
    catch { return ""; }
  })
  .join(String.fromCharCode(10));

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

/** Does the named thing actually appear in a gate definition? */
function resolveGate(target) {
  if (!target) return { resolved: false, why: "claim names no script or alias to resolve" };
  const needle = target.kind === "script" ? target.value.split("/").pop() : target.value;

  if (target.kind === "script") {
    const found =
      (existsSync(target.value) && target.value) ||
      repoFiles.find((f) => f.endsWith("/" + needle));
    if (!found) return { resolved: false, why: `script ${target.value} does not exist` };
  }

  if (invokerText.includes(needle)) {
    return { resolved: true, why: `${needle} runs from a hook or workflow` };
  }
  if (compositeText.includes(needle)) {
    return { resolved: true, why: `${needle} runs inside a composite npm script` };
  }
  const aliased = PKGS.some((f) => {
    try {
      return Object.keys(JSON.parse(readFileSync(f, "utf8")).scripts ?? {}).some(
        (k) => k === target.value || k.includes(needle.replace(/\.(sh|ts|mjs|js)$/, "")),
      );
    } catch { return false; }
  });
  return {
    resolved: false,
    why: aliased
      ? `${needle} EXISTS and has an npm alias, but runs from NO hook, workflow or composite gate -- defining is not running`
      : `${needle} appears in no hook, workflow or composite gate`,
  };
}

const findings = { completeness: [], gate: [], count: [] };

for (const doc of docs) {
  let text;
  try {
    text = readFileSync(doc, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${doc}:${i + 1}`;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(">")) return;

    if (GATE.test(line)) {
      const target = namedTarget(line);
      const r = resolveGate(target);
      findings.gate.push({ at, line: trimmed.slice(0, 150), ...r });
    }
    if (COMPLETENESS.test(line)) {
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
  const bad = findings.gate.filter((f) => !f.resolved);
  unresolvedGates = bad.length;
  console.log(`\n── GATE claims ── ${findings.gate.length} found, ${bad.length} UNRESOLVED\n`);
  for (const f of bad) console.log(`  ✗ ${f.at}\n      ${f.line}\n      -> ${f.why}\n`);
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

console.log(
  `\nscanned ${docs.length} markdown files · ` +
    `gate ${findings.gate.length} (${unresolvedGates} unresolved) · ` +
    `completeness ${findings.completeness.length} · count ${findings.count.length}`,
);

if (STRICT && unresolvedGates > 0) {
  console.error(`\n✗ ${unresolvedGates} unresolved GATE claim(s). A doc that names a gate must resolve to one.`);
  process.exit(1);
}
