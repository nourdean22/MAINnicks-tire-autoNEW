#!/usr/bin/env node
/**
 * Live-canary gate (2026-09-23) — decides whether a LIVE GitHub-API canary runs.
 *
 * WHY: CI's GITHUB_TOKEN gets ~1,000 REST requests/hour per repo. The full-sweep
 * canary in branch-sweep.test.mjs classifies every remote branch through
 * repo-status.mjs: MEASURED 657 requests per agent-policy run (158 branches, ~4 calls
 * each), out of 670 for the whole run. Two runs an hour exhausted the budget, and
 * every PR then failed with "403 API rate limit exceeded for installation" — in
 * this job AND in test.yml's path filter, so no PR could show a real test result.
 *
 * RULE: a live canary runs when (in order, first match wins)
 *   1. its env var is set: "1" forces a run, "0" forces a skip (operator override);
 *   2. the event is workflow_dispatch or schedule (someone asked for the full check);
 *   3. the diff touches its SUBJECT — the canary's own entry scripts, every local
 *      module they import (computed, not hand-listed, so a new import can't drift
 *      out of the gate), this gate, and the named workflow files;
 *   4. the diff cannot be computed -> RUN (unknown fails toward coverage, not toward
 *      silence; CI always computes it, so this only fires in odd local checkouts).
 * Otherwise it is skipped, and the skip reason is printed — never a silent skip.
 *
 * The diff comes from git (never the API). In CI, agent-policy.yml runs
 * `node live-gate.mjs --base <sha>`, which fails the job if that diff can't be
 * computed and exports AGENT_OS_DIFF_BASE for the tests. Locally, with no base set,
 * the diff is against the merge-base with origin/main.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/** Every live canary this gate governs. `entries` are scripts whose import
 * closure is the subject; `extra` are repo-relative paths added verbatim. */
export const LIVE_CANARIES = {
  AGENT_OS_LIVE_SWEEP: {
    label: "branch-sweep full pipeline",
    entries: ["branch-sweep.mjs", "branch-sweep.test.mjs"],
    extra: [".github/workflows/branch-sweep.yml", ".github/workflows/agent-policy.yml"],
  },
  AGENT_OS_LIVE_RESCUE: {
    label: "repo-rescue real fixtures",
    entries: ["repo-rescue.mjs", "repo-rescue.test.mjs"],
    extra: [".github/workflows/agent-policy.yml"],
  },
};

const FORCE_EVENTS = new Set(["workflow_dispatch", "schedule"]);

/** Repo-relative paths of `entries` plus every `./x.mjs` they import, transitively. */
export function importClosure(entries, dir = HERE) {
  const seen = new Set();
  const queue = entries.map((e) => resolve(dir, e));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+\.mjs)["']/g)) {
      queue.push(resolve(dirname(file), m[1]));
    }
  }
  return [...seen].map((f) => relative(ROOT, f).split("\\").join("/")).sort();
}

export function subjectFor(name) {
  const c = LIVE_CANARIES[name];
  if (!c) throw new Error(`live-gate: unknown canary ${name}`);
  const self = relative(ROOT, fileURLToPath(import.meta.url)).split("\\").join("/");
  return [...new Set([...importClosure(c.entries), self, ...c.extra])].sort();
}

/** Pure decision. changedFiles === null means "diff could not be computed". */
export function decide({ name, envValue, eventName, changedFiles, subject }) {
  if (envValue === "1") return { run: true, reason: `${name}=1 forces a live run` };
  if (envValue === "0") return { run: false, reason: `${name}=0 forces a skip` };
  if (FORCE_EVENTS.has(eventName)) return { run: true, reason: `event ${eventName} runs every live canary` };
  if (changedFiles === null) return { run: true, reason: "diff could not be computed — running live rather than skipping blind" };
  const hits = changedFiles.filter((f) => subject.includes(f));
  if (hits.length) return { run: true, reason: `diff touches its subject: ${hits.join(", ")}` };
  return {
    run: false,
    reason: `diff (${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}) touches none of its ${subject.length} subject files — set ${name}=1 to force`,
  };
}

function git(args, cwd = ROOT) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Files changed since `base` — committed, uncommitted and untracked (in CI the
 * tree is clean, so this is exactly base..HEAD) — or null if git cannot say. With
 * no base, uses the merge-base with origin/main (local runs). */
export function changedFilesSince(base, cwd = ROOT) {
  const from = base || git(["merge-base", "HEAD", "origin/main"], cwd);
  if (!from) return null;
  const tracked = git(["diff", "--name-only", from], cwd);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd);
  if (tracked === null || untracked === null) return null;
  return [...new Set([...tracked.split("\n"), ...untracked.split("\n")])].filter(Boolean).sort();
}

/** What a test file calls: decision for one canary from the live environment. */
export function liveDecision(name) {
  const envValue = process.env[name];
  const eventName = process.env.GITHUB_EVENT_NAME;
  const needsDiff = envValue !== "1" && envValue !== "0" && !FORCE_EVENTS.has(eventName);
  const changedFiles = needsDiff ? changedFilesSince(process.env.AGENT_OS_DIFF_BASE) : [];
  const d = decide({ name, envValue, eventName, changedFiles, subject: subjectFor(name) });
  return { ...d, reason: `[live-gate] ${LIVE_CANARIES[name].label}: ${d.run ? "RUN" : "SKIP"} — ${d.reason}` };
}

// CLI (CI): `node live-gate.mjs --base <sha>` prints every canary's decision and
// reason, then `AGENT_OS_DIFF_BASE=<sha>` on stdout for $GITHUB_ENV, so each test
// recomputes the same decision itself and logs the REAL reason next to its skip.
// Exits 1 if the diff cannot be computed: in CI that is a broken checkout, and it
// must be loud, not a fallback live run that quietly spends the budget this gate
// exists to protect.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--base");
  const base = i > -1 ? process.argv[i + 1] : "";
  const eventName = process.env.GITHUB_EVENT_NAME;
  const changedFiles = changedFilesSince(base);
  if (changedFiles === null) {
    console.error(`[live-gate] cannot compute git diff ${base || "(merge-base origin/main)"}..HEAD — is the base commit fetched?`);
    process.exit(1);
  }
  const shown = changedFiles.slice(0, 20).join(", ") + (changedFiles.length > 20 ? `, … +${changedFiles.length - 20} more` : "");
  console.error(`[live-gate] ${changedFiles.length} changed file(s) vs ${base || "merge-base origin/main"}: ${shown}`);
  for (const name of Object.keys(LIVE_CANARIES)) {
    const d = decide({ name, envValue: process.env[name], eventName, changedFiles, subject: subjectFor(name) });
    console.error(`[live-gate] ${LIVE_CANARIES[name].label}: ${d.run ? "RUN" : "SKIP"} — ${d.reason}`);
  }
  if (base) console.log(`AGENT_OS_DIFF_BASE=${base}`);
}
