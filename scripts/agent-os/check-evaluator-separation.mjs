#!/usr/bin/env node
/**
 * Evaluator separation — the one architecture rule that makes an autonomous
 * proposer safe enough to be creative.
 *
 * A change on a CANDIDATE branch (darwin/*, night-shift/*) may edit the
 * product. It may not, in the same change, edit anything that judges the
 * product: goal contracts, episodes, the experiment kernel, the approval
 * gate, lint gates, CI. If it could, the cheapest way to "pass" would be to
 * move the goalposts — and a loop that runs nightly will find the cheapest
 * way. Evaluator changes ship on ordinary branches, reviewed as evaluator
 * changes.
 *
 * Pure logic in `assess()`; the CLI reads the branch + changed paths from
 * git (or from args in CI). Exit 0 = ok or not a candidate branch, 1 =
 * violation, 2 = harness error. Canaried by evaluatorSeparation.test.mjs.
 *
 *   node scripts/agent-os/check-evaluator-separation.mjs --branch darwin/x --paths a b c
 *   node scripts/agent-os/check-evaluator-separation.mjs            # current branch vs origin/main
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

export function loadConfig(file = join(ROOT, "config", "agent-os", "evaluator-paths.json")) {
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(cfg.candidateBranchPrefixes) || !Array.isArray(cfg.evaluatorPaths)) {
    throw new Error("evaluator-paths.json: candidateBranchPrefixes and evaluatorPaths must be arrays");
  }
  return cfg;
}

export function isCandidateBranch(branch, cfg) {
  return cfg.candidateBranchPrefixes.some((p) => branch.startsWith(p));
}

export function isEvaluatorPath(path, cfg) {
  const norm = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return cfg.evaluatorPaths.some((p) => (p.endsWith("/") ? norm.startsWith(p) : norm === p));
}

/** @returns {{ triggered: boolean, ok: boolean, violations: string[] }} */
export function assess(branch, changedPaths, cfg) {
  if (!isCandidateBranch(branch, cfg)) return { triggered: false, ok: true, violations: [] };
  const violations = changedPaths.filter((p) => isEvaluatorPath(p, cfg));
  return { triggered: true, ok: violations.length === 0, violations };
}

function fromGit() {
  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT }).toString().trim();
  let base = "origin/main";
  try {
    execSync(`git rev-parse --verify ${base}`, { cwd: ROOT, stdio: "ignore" });
  } catch {
    base = "main";
  }
  const paths = execSync(`git diff --name-only ${base}...HEAD`, { cwd: ROOT }).toString().split(/\r?\n/).filter(Boolean);
  return { branch, paths };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const bi = argv.indexOf("--branch");
    const pi = argv.indexOf("--paths");
    const { branch, paths } = bi >= 0 ? { branch: argv[bi + 1], paths: pi >= 0 ? argv.slice(pi + 1) : [] } : fromGit();
    const cfg = loadConfig();
    const v = assess(branch, paths, cfg);
    if (!v.triggered) {
      console.log(`evaluator separation: ${branch} is not a candidate branch — not applicable`);
      process.exit(0);
    }
    if (v.ok) {
      console.log(`evaluator separation: ${branch} touches ${paths.length} path(s), none are evaluators — ok`);
      process.exit(0);
    }
    console.error(`evaluator separation VIOLATED on ${branch}: a candidate change may not edit its own judges:\n  ${v.violations.join("\n  ")}\nShip evaluator changes on a normal branch, reviewed as evaluator changes.`);
    process.exit(1);
  } catch (err) {
    console.error(`evaluator separation: harness error — ${err.message}`);
    process.exit(2);
  }
}
