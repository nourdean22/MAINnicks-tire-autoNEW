#!/usr/bin/env node
/**
 * check-gate-reachability — a gate nothing runs is not a gate.
 *
 * THE DEFECT, 2026-08-23. At 12:01 that day #1806 wired three nickstire gates
 * into CI and left this comment in `.github/workflows/test.yml`:
 *
 *     three gates that were in `pnpm run verify` and in no CI job at all
 *
 * At 12:42 — forty-one minutes later, same afternoon, same app — #1808 added
 * `lint:cron-wiring` to `apps/nickstire/package.json` and wired it into
 * NOTHING. Not a workflow, not the `verify` chain, not lefthook. The session
 * that fixed the unwired-control class introduced a fresh instance of it before
 * the day was out, and every gate in the repo was green while it happened,
 * because no control anywhere asks the question this script asks.
 *
 * That is the whole argument for this file. The knowledge was not missing —
 * it was written down, in a code comment, by the same people, hours earlier.
 * The ENFORCEMENT was missing. A class of defect that a team can name and
 * still re-commit the same afternoon is a class that needs a machine.
 *
 * WHAT REACHABLE MEANS. A `check:*` / `lint:*` script is reachable if it is:
 *   1. invoked from a `.github/workflows/*.yml` job, or
 *   2. invoked from `lefthook.yml`, or
 *   3. chained (transitively) from a ROOT script — `verify` / `verify:hard` —
 *      which are the documented human-and-agent entry points in AGENTS.md.
 *
 * Rule 3 is deliberately generous. `verify:hard` is not itself a CI job, and a
 * stricter gate would flag ~20 statenour checks that are working exactly as
 * designed. This script answers "can anything reach it at all", NOT "is it
 * enforced in CI" — those are different questions and conflating them would
 * produce a wall of noise that gets the gate disabled. The second question is
 * the canary-subject question, and it belongs to each gate's own canary.
 *
 * WHY IT IS NOT A PRESENCE ASSERTION. Asserting "check-gate-reachability.mjs
 * exists" would be self-refuting in this file of all files: the defect being
 * guarded IS an artifact that exists and runs nowhere. The canary in
 * gateReachability.test.mjs plants an ORPHAN SCRIPT in a fixture and requires
 * it to be reported, requires a wired one NOT to be reported, and mutates a
 * scratch copy of this checker to always return [] and requires the CLI to
 * still fail. Behaviour in three directions, never presence.
 *
 * ALLOWLIST POLICY, inherited from check-et-clock.mjs: `reason` is mandatory.
 * An unexplained entry is how a gate becomes theatre.
 *
 * EXIT CODES: 0 clean · 1 an unreachable gate was found · 2 the guard could not
 * run. Never 0 on "I could not look" — a guard that fails open prints the same
 * green as a healthy repo, which is the defect it guards.
 *
 * Usage:  node scripts/agent-os/check-gate-reachability.mjs
 *         (auto-run by `pnpm agent:verify` via its *.test.mjs canary)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Scripts treated as entry points: AGENTS.md documents these as the gates humans/agents run. */
export const ROOT_SCRIPTS = ["verify", "verify:hard"];

/** Gate-shaped script names this guard is responsible for. */
export const GATE_RE = /^(check|lint):/;

/**
 * Two things NAMED like a gate that are not one. Both are RULES, not allowlist
 * entries, because each describes a class: a list would need a new line every
 * time someone adds another `lint:fix`, and a gate that demands paperwork for
 * a known-benign shape is a gate people delete.
 *
 *   · `*:fix` — `prettier --write` and friends MUTATE the tree. A fixer that
 *     ran in CI would be a bug, not a control. Never gate-shaped.
 *   · a command that is ONLY `turbo run <tasks>` — an alias, not new work. Its
 *     tasks are what CI actually invokes (`turbo run check lint test build
 *     --affected`), so the reachability question belongs to the TASK, and
 *     re-asking it of the human-facing spelling produces noise, not safety.
 *
 * Anything else matching GATE_RE must be reachable or allowlisted. The
 * defect this file exists for — `lint:cron-wiring`, a bare `tsx` script — is
 * caught by neither rule, which is the test of whether they are drawn too wide.
 */
export function isAliasOrFixer(script, cmd) {
  if (/:fix$/.test(script)) return true;
  return /^\s*turbo\s+run\s+[a-zA-Z0-9:._\s-]*$/.test(String(cmd ?? ""));
}

/**
 * Legitimate unreachable gates. `reason` is MANDATORY — a bare name is rejected
 * by the canary, because an unexplained waiver is indistinguishable from a bug.
 */
export const ALLOW = [
  {
    pkg: "@statenour/web",
    script: "check:secrets",
    reason:
      "lefthook.yml:33 deliberately calls `tsx scripts/scan-secrets.ts --staged` directly instead of this script — the unstaged form flags local .env files. The scanner IS wired; this npm alias is the unwired half, on purpose.",
  },
  {
    pkg: "@statenour/web",
    script: "check:env:prod",
    reason:
      "reads PRODUCTION env and is operator-invoked by design. Wiring it into CI would either fail (no prod secrets on the runner) or require putting them there — the gate would create the risk it is meant to check.",
  },
  {
    pkg: "@statenour/web",
    script: "check:mutations",
    reason:
      "the non-strict report. `check:mutations:strict` is the enforced form and IS chained in verify:hard; this spelling exists so a developer can read the findings without failing the run.",
  },
];

/** Parse the pnpm/npm script invocations out of one shell command string. */
export function scriptRefsIn(cmd, selfPkg) {
  const refs = [];
  if (!cmd) return refs;
  // pnpm --filter <pkg> <script>   /   pnpm --filter "<pkg>..." <script>
  for (const m of cmd.matchAll(/pnpm\s+--filter\s+"?([@a-zA-Z0-9/._-]+?)(?:\.\.\.)?"?\s+(?:run\s+)?([a-zA-Z0-9:._-]+)/g)) {
    refs.push({ pkg: m[1], script: m[2] });
  }
  // root shortcuts documented in AGENTS.md: pnpm nick <script> · pnpm stn <script>
  for (const m of cmd.matchAll(/pnpm\s+(nick|stn|worker)\s+(?:run\s+)?([a-zA-Z0-9:._-]+)/g)) {
    const pkg = m[1] === "nick" ? "nicks-tire-auto" : m[1] === "stn" ? "@statenour/web" : "@statenour/worker";
    refs.push({ pkg, script: m[2] });
  }
  // turbo run <task> <task> ... — bare task names map to same-named package scripts
  for (const m of cmd.matchAll(/turbo\s+run\s+([a-zA-Z0-9:._\s-]+)/g)) {
    for (const t of m[1].split(/\s+/)) {
      if (!t || t.startsWith("-")) break;
      refs.push({ pkg: "*", script: t });
    }
  }
  // plain `pnpm run <script>` / `pnpm <script>` inside this package
  for (const m of cmd.matchAll(/pnpm\s+run\s+([a-zA-Z0-9:._-]+)/g)) {
    refs.push({ pkg: selfPkg ?? "*", script: m[1] });
  }
  for (const m of cmd.matchAll(/(?:^|&&|;|\|\|)\s*pnpm\s+(?!run|exec|--filter|nick\b|stn\b|worker\b|install|dlx)([a-zA-Z0-9:._-]+)/g)) {
    refs.push({ pkg: selfPkg ?? "*", script: m[1] });
  }
  return refs;
}

/**
 * The whole decision, as a pure function so the canary can drive it with
 * fixtures it owns rather than with the live repo.
 *
 * @param packages     [{ name, scripts: { [script]: cmd } }]
 * @param externalRefs [{ pkg, script }] — refs found in CI workflows / lefthook
 * @param allow        [{ pkg, script, reason }]
 * @returns            [{ pkg, script, cmd }] unreachable gates
 */
export function findUnreachableGates(packages, externalRefs = [], allow = []) {
  const key = (p, s) => `${p}::${s}`;
  const allowed = new Set(allow.map((a) => key(a.pkg, a.script)));

  // Seed: root scripts + everything CI/lefthook names.
  const reachable = new Set();
  const queue = [];
  const seed = (pkg, script) => {
    for (const p of packages) {
      if (pkg !== "*" && p.name !== pkg) continue;
      if (!(script in p.scripts)) continue;
      const k = key(p.name, script);
      if (!reachable.has(k)) {
        reachable.add(k);
        queue.push({ pkg: p.name, script });
      }
    }
  };
  for (const p of packages) for (const r of ROOT_SCRIPTS) seed(p.name, r);
  for (const r of externalRefs) seed(r.pkg, r.script);

  // Transitive closure over script -> script chaining.
  while (queue.length) {
    const cur = queue.pop();
    const p = packages.find((x) => x.name === cur.pkg);
    const cmd = p?.scripts?.[cur.script];
    for (const r of scriptRefsIn(cmd, cur.pkg)) seed(r.pkg, r.script);
  }

  const out = [];
  for (const p of packages) {
    for (const [script, cmd] of Object.entries(p.scripts)) {
      if (!GATE_RE.test(script)) continue;
      if (isAliasOrFixer(script, cmd)) continue;
      if (reachable.has(key(p.name, script))) continue;
      if (allowed.has(key(p.name, script))) continue;
      out.push({ pkg: p.name, script, cmd });
    }
  }
  return out.sort((a, b) => (a.pkg + a.script).localeCompare(b.pkg + b.script));
}

/** Collect every package.json this guard is responsible for. */
export function loadPackages(root = ROOT) {
  const files = [join(root, "package.json")];
  const appsDir = join(root, "apps");
  if (existsSync(appsDir)) {
    for (const d of readdirSync(appsDir)) {
      const pj = join(appsDir, d, "package.json");
      if (existsSync(pj)) files.push(pj);
    }
  }
  const packages = [];
  for (const f of files) {
    const json = JSON.parse(readFileSync(f, "utf8"));
    if (!json.name || !json.scripts) continue;
    packages.push({ name: json.name, scripts: json.scripts, file: f });
  }
  return packages;
}

/** Every script name CI workflows and lefthook invoke. */
export function loadExternalRefs(root = ROOT) {
  const texts = [];
  const wf = join(root, ".github", "workflows");
  if (existsSync(wf)) {
    for (const f of readdirSync(wf)) {
      if (f.endsWith(".yml") || f.endsWith(".yaml")) texts.push(readFileSync(join(wf, f), "utf8"));
    }
  }
  const lh = join(root, "lefthook.yml");
  if (existsSync(lh)) texts.push(readFileSync(lh, "utf8"));
  return texts.flatMap((t) => scriptRefsIn(t, "*"));
}

function main() {
  // `--root <dir>` lets the canary drive this exact CLI — exit codes included —
  // against fixture repos it owns, instead of asserting on the live tree. The
  // gate's own reachability question is answered by the live run (no --root).
  const rootArg = process.argv.indexOf("--root");
  const root = rootArg >= 0 ? process.argv[rootArg + 1] : ROOT;

  let packages, externalRefs;
  try {
    packages = loadPackages(root);
    externalRefs = loadExternalRefs(root);
  } catch (err) {
    console.error(`❌ gate reachability: could not run — ${err.message}`);
    process.exit(2);
  }
  if (!packages.length) {
    console.error("❌ gate reachability: no package.json found — refusing to report clean.");
    process.exit(2);
  }

  const bad = ALLOW.filter((a) => !a.reason || !String(a.reason).trim());
  if (bad.length) {
    console.error(`❌ gate reachability: ${bad.length} allowlist entr(ies) with no reason.`);
    process.exit(2);
  }

  const unreachable = findUnreachableGates(packages, externalRefs, ALLOW);
  const gateCount = packages.reduce(
    (n, p) =>
      n + Object.entries(p.scripts).filter(([s, c]) => GATE_RE.test(s) && !isAliasOrFixer(s, c)).length,
    0,
  );

  if (unreachable.length === 0) {
    console.log(
      `✅ gate reachability: all ${gateCount} check:*/lint:* scripts across ${packages.length} packages are reachable ` +
        `(${ALLOW.length} allowlisted, each with a reason)`,
    );
    process.exit(0);
  }

  console.error(`❌ gate reachability: ${unreachable.length} of ${gateCount} gate script(s) reachable from nothing.\n`);
  console.error(`   A gate no CI job, no lefthook step and no verify chain invokes is an`);
  console.error(`   artifact, not a control. #1808 shipped one 41 minutes after #1806 fixed`);
  console.error(`   three of the same shape — the class recurs without a machine watching.\n`);
  for (const u of unreachable) {
    console.error(`   ${u.pkg} · ${u.script}`);
    console.error(`     ${String(u.cmd).slice(0, 96)}`);
  }
  console.error(`\n   fix · add it to a CI job, to lefthook.yml, or to that package's`);
  console.error(`   verify / verify:hard chain — or add it to ALLOW in this script WITH a reason.`);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
