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
for (const f of PKGS.filter(existsSync)) {
  try {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(f, "utf8")).scripts ?? {})) {
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

// Roots that something OTHER than a human decides to run.
const automaticRoots = [...scripts.keys()].filter((a) => {
  const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, String.fromCharCode(92) + "$&");
  return new RegExp("(?:pnpm|npm|yarn)(?:\\s+run)?\\s+(?:--filter\\s+\\S+\\s+)?" + escaped + "(?:\\s|$)").test(invokerText);
});
const automaticAliases = reachableFrom(automaticRoots);
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

  // Named directly by a hook or workflow, without going through an alias.
  if (invokerText.includes(needle)) {
    return { resolved: true, tier: "AUTOMATIC", why: `${needle} runs directly from a hook or workflow` };
  }

  const auto = aliasesRunning(needle, automaticAliases);
  if (auto.length) {
    return { resolved: true, tier: "AUTOMATIC", why: `${needle} runs via ${auto.join(", ")}, reachable from a hook or workflow` };
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
  const bad = findings.gate.filter((f) => !f.resolved && f.tier);
  const vague = findings.gate.filter((f) => !f.resolved && !f.tier);
  unresolvedGates = bad.length;

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

console.log(
  `\nscanned ${docs.length} markdown files · ` +
    `gate ${findings.gate.length} (${unresolvedGates} unresolved) · ` +
    `completeness ${findings.completeness.length} · count ${findings.count.length}`,
);

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
      target: { kind: "script", value: "scripts/check-anti-slop.sh" },
      tier: "MANUAL",
      mentions: "verify:hard",
    },
    {
      // UNWIRED vs MISSING are different answers; a named script that does not
      // exist must not be reported as merely unwired.
      target: { kind: "script", value: "scripts/pre-push-check.sh" },
      tier: undefined,
      why: "does not exist",
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = resolveGate(c.target);
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
  const KNOWN_EDGE = { from: "verify:hard", to: "check:anti-slop" };
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
