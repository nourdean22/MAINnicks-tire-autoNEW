/**
 * Canaries for classify-branch.mjs (Session Authority · 2026-09-23).
 *
 * Fixtures are this session's own real audit findings, not synthetic data — the
 * branches that motivated the whole build: branches merged with their ref deleted,
 * a truly-stranded one, and nickstire/reel-generate-schedule, whose real live data
 * caught a genuine bug in this file's first draft (see file header): a merged PR
 * against a branch is not proof the branch's CURRENT tip is landed if the branch
 * kept moving afterward. That bug was only found by testing against ground truth,
 * not by reasoning about the code — the reason these tests stay pinned to real
 * numbers rather than only abstract cases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBranch, applyOverride, CLASSIFICATIONS } from "./classify-branch.mjs";

test("LANDED (ref deleted): a merged:true PR is authoritative once the branch ref itself is gone", () => {
  const r = classifyBranch({
    branch: "claude/nicks-eval-coverage-2026-09-18",
    existsOnOrigin: false, // ref deleted post-merge, as this session found for 7 of 12 branches
    prs: [{ number: 2460, merged: true, mergedAt: "2026-09-18T20:00:00Z" }],
  });
  assert.equal(r.classification, CLASSIFICATIONS.LANDED);
  assert.match(r.reason, /#2460/);
});

test("LANDED (ref deleted) ignores a list-endpoint-style merged:false when a later per-PR entry says merged:true", () => {
  const r = classifyBranch({
    branch: "x",
    existsOnOrigin: false,
    prs: [
      { number: 10, merged: false },
      { number: 11, merged: true },
    ],
  });
  assert.equal(r.classification, CLASSIFICATIONS.LANDED);
});

test("LANDED (ref still exists): 0 ahead of main is sufficient on its own, no PR needed", () => {
  const r = classifyBranch({ branch: "x", existsOnOrigin: true, prs: [], aheadOfMain: 0, behindOfMain: 50 });
  assert.equal(r.classification, CLASSIFICATIONS.LANDED);
});

test("REAL BUG this file's first draft had: a branch that STILL EXISTS with a merged PR but nonzero ahead-of-main is NOT LANDED", () => {
  // nickstire/reel-generate-schedule, live data: PR #2184 genuinely merged an
  // earlier state of this branch, but 3 more commits landed afterward (7 ahead of
  // main today). The first draft of classifyBranch called this LANDED because SOME
  // PR showed merged:true — caught only by running the real binary against real
  // GitHub data (repo-rescue.test.mjs), not by unit tests with synthetic evidence.
  const r = classifyBranch({
    branch: "nickstire/reel-generate-schedule",
    existsOnOrigin: true,
    prs: [{ number: 2184, merged: true, mergedAt: "2026-09-08T01:37:29Z" }],
    aheadOfMain: 7,
    behindOfMain: 402,
  });
  assert.equal(r.classification, CLASSIFICATIONS.QUARANTINE, "must NOT be LANDED — the branch moved past its own merged PR");
  assert.equal(r.signals.hasMergedPrButStillAhead, true);
  assert.match(r.reason, /#2184/);
  assert.match(r.reason, /never auto-treated as ordinary SALVAGE|NEEDS_SPECIAL_HANDLING/);
});

test("QUARANTINE: no branch ref and no PR record at all (genuinely stranded)", () => {
  const r = classifyBranch({
    branch: "claude/nicks-tire-camera-gaps-36762d",
    existsOnOrigin: false,
    prs: [],
  });
  assert.equal(r.classification, CLASSIFICATIONS.QUARANTINE);
  assert.match(r.reason, /nothing provable/);
});

test("QUARANTINE: branch exists, no merged PR, ordinary ahead/behind — default, not auto-SALVAGE", () => {
  const r = classifyBranch({
    branch: "some/branch",
    existsOnOrigin: true,
    prs: [{ number: 5, merged: false }],
    aheadOfMain: 3,
    behindOfMain: 12,
  });
  assert.equal(r.classification, CLASSIFICATIONS.QUARANTINE);
  assert.equal(r.signals.hasMergedPrButStillAhead, false);
});

test("applyOverride: layers a human classification, records who/when/from-what", () => {
  const auto = classifyBranch({ branch: "x", existsOnOrigin: true, prs: [], aheadOfMain: 4 });
  const overridden = applyOverride(auto, CLASSIFICATIONS.NEEDS_SPECIAL_HANDLING, {
    reason: "reviewed manually",
    by: "operator",
  });
  assert.equal(overridden.classification, CLASSIFICATIONS.NEEDS_SPECIAL_HANDLING);
  assert.equal(overridden.override.previousClassification, CLASSIFICATIONS.QUARANTINE);
  assert.equal(overridden.override.by, "operator");
});

test("applyOverride: refuses to let a human declare LANDED without merged-PR/zero-ahead evidence", () => {
  const auto = classifyBranch({ branch: "x", existsOnOrigin: true, prs: [], aheadOfMain: 4 });
  assert.throws(() => applyOverride(auto, CLASSIFICATIONS.LANDED), /cannot be set by override/);
});

test("applyOverride: rejects an unknown classification string", () => {
  const auto = classifyBranch({ branch: "x", existsOnOrigin: false, prs: [] });
  assert.throws(() => applyOverride(auto, "MOSTLY_FINE_PROBABLY"), /unknown classification/);
});
