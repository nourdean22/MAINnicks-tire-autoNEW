/**
 * Canaries for branch-sweep.mjs's pure parts (Session Authority · 2026-09-23).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mergeWithPriorOverrides, renderLedgerMarkdown } from "./branch-sweep.mjs";
import { CLASSIFICATIONS } from "./classify-branch.mjs";
import { resolveToken } from "./github-client.mjs";
import { liveDecision } from "./live-gate.mjs";

// ~657 GitHub API requests per run (measured 2026-09-23, 158 branches) — two runs an
// hour exhausted CI's per-repo token budget. Gated to diffs that touch the sweep's
// own code (see live-gate.mjs); the reason prints either way.
const sweepGate = liveDecision("AGENT_OS_LIVE_SWEEP");
console.log(sweepGate.reason);

test("mergeWithPriorOverrides: a prior override survives when the fresh classification is still QUARANTINE", () => {
  const fresh = [{ branch: "x", classification: CLASSIFICATIONS.QUARANTINE, reason: "fresh reason" }];
  const prior = {
    branches: [
      {
        branch: "x",
        classification: CLASSIFICATIONS.NEEDS_SPECIAL_HANDLING,
        override: { by: "operator", reason: "reviewed last week" },
      },
    ],
  };
  const merged = mergeWithPriorOverrides(fresh, prior);
  assert.equal(merged[0].classification, CLASSIFICATIONS.NEEDS_SPECIAL_HANDLING);
  assert.equal(merged[0].override.by, "operator");
});

test("mergeWithPriorOverrides: a stale override is DROPPED once fresh evidence proves LANDED", () => {
  const fresh = [{ branch: "x", classification: CLASSIFICATIONS.LANDED, reason: "PR #99 merged" }];
  const prior = {
    branches: [{ branch: "x", classification: CLASSIFICATIONS.SALVAGE, override: { by: "operator", reason: "old" } }],
  };
  const merged = mergeWithPriorOverrides(fresh, prior);
  assert.equal(merged[0].classification, CLASSIFICATIONS.LANDED, "proof of landing must outrank a stale override");
  assert.equal(merged[0].override, undefined);
});

test("mergeWithPriorOverrides: a branch with no prior entry (first time seen) is untouched", () => {
  const fresh = [{ branch: "brand-new", classification: CLASSIFICATIONS.QUARANTINE, reason: "r" }];
  const merged = mergeWithPriorOverrides(fresh, null);
  assert.equal(merged[0].classification, CLASSIFICATIONS.QUARANTINE);
});

test("renderLedgerMarkdown: groups by classification, attention-needing groups before LANDED", () => {
  const ledger = {
    generatedAt: "2026-09-23T00:00:00Z",
    owner: "o",
    repo: "r",
    branches: [
      { branch: "landed-1", classification: CLASSIFICATIONS.LANDED, reason: "merged" },
      { branch: "quarantine-1", classification: CLASSIFICATIONS.QUARANTINE, reason: "no PR" },
    ],
  };
  const md = renderLedgerMarkdown(ledger);
  const quarantineIdx = md.indexOf("## QUARANTINE");
  const landedIdx = md.indexOf("## LANDED");
  assert.ok(quarantineIdx > -1 && landedIdx > -1);
  assert.ok(quarantineIdx < landedIdx, "QUARANTINE (needs a look) must render before LANDED (nothing to do)");
  assert.match(md, /`quarantine-1`/);
});

test("renderLedgerMarkdown: a pipe character in a reason does not break the table", () => {
  const ledger = {
    generatedAt: "x",
    owner: "o",
    repo: "r",
    branches: [{ branch: "b", classification: CLASSIFICATIONS.QUARANTINE, reason: "a | b" }],
  };
  const md = renderLedgerMarkdown(ledger);
  assert.match(md, /a \\\| b/);
});

test("LIVE, report-only: the full sweep pipeline runs end-to-end against real GitHub data, writes nothing", { skip: !sweepGate.run ? sweepGate.reason : !resolveToken() ? "no GitHub token" : false }, () => {
  const env = { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" };
  const out = execSync(`${process.execPath} branch-sweep.mjs --report-only`, {
    cwd: import.meta.dirname,
    encoding: "utf8",
    env,
    timeout: 90000, // 130+ branches, several API calls each, at concurrency 8
  });
  assert.match(out, /^# Branch sweep/);
  assert.match(out, /nourdean22\/MAINnicks-tire-autoNEW/);
});
