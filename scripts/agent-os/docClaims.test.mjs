/**
 * Canaries for the DOC-CLAIM gate (scripts/check-doc-claims.mjs).
 *
 * Discovered automatically by verify.mjs, so this file IS the wiring -- no CI
 * edit, per the design note in verify.mjs. `pnpm agent:verify` runs it, and
 * .github/workflows/agent-policy.yml runs that on every PR.
 *
 * WHY THIS FILE EXISTS AT ALL. The checker's whole subject is controls that
 * claim to run and do not. Shipping it report-only would have made it the
 * fourteenth instance of the class it was written to find -- and the repo rule
 * is explicit: no hook, gate, lint, guard, alert or probe ships without a test
 * that BREAKS it and asserts it fails. So the third test below plants a false
 * gate claim and requires --strict to exit 1. Without that arm, a checker that
 * silently stopped detecting anything would score green forever.
 *
 * THE PLANT USES A TEMPORARY INDEX. check-doc-claims.mjs discovers files with
 * `git ls-files`, which reads GIT_INDEX_FILE. Pointing that at a scratch index
 * lets the canary become visible to the scan without `git add`-ing anything
 * into the shared staging area -- this checkout is shared with concurrent
 * sessions and staging a file into it would land in someone else's commit.
 *
 * (That `git ls-files` discovery is also a real limit worth knowing: an
 * UNTRACKED markdown file is invisible to the checker. As a gate that is fine
 * -- staged files are in the index by then -- but an ad-hoc run against a
 * brand-new doc will report a clean zero it did not earn.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKER = join(ROOT, "scripts", "check-doc-claims.mjs");

function runChecker(args, env = {}) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (r.error) assert.fail(`could not run the checker: ${r.error.message}`);
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("the resolver self-test passes", () => {
  const { code, out } = runChecker(["--selftest"]);
  assert.equal(code, 0, `selftest failed:\n${out}`);
  // Pin the MECHANISM, not just the verdict. v3 of the checker reached the
  // right conclusion about check-anti-slop.sh through an invented reason
  // ("appears in no composite" -- it appears in verify:hard), and a verdict-only
  // assertion would have passed that too.
  assert.match(out, /check-anti-slop\.sh -> MANUAL/);
  assert.match(out, /verify:hard/);
  assert.match(out, /walk traverses verify:hard -> check:anti-slop/);
});

test("--strict is green against the repo as it stands", () => {
  const { code, out } = runChecker(["--strict"]);
  assert.equal(code, 0, `--strict is red; fix the claim or the gate, do not relax the check:\n${out}`);
});

test("BREAKS: a planted false gate claim makes --strict exit 1", () => {
  const scratch = mkdtempSync(join(tmpdir(), "doc-claim-canary-"));
  const canaryDoc = join(ROOT, "docs", "agent-audit", ".claim-canary-tmp.md");
  const canaryIndex = join(scratch, "index");
  try {
    writeFileSync(
      canaryDoc,
      "# canary\n\nAnti-slop is **verified at push time** via `scripts/check-anti-slop.sh`.\n",
    );

    // Seed a scratch index from HEAD, add ONLY the canary. The shared index is
    // never opened.
    const env = { GIT_INDEX_FILE: canaryIndex };
    for (const argv of [["read-tree", "HEAD"], ["update-index", "--add", "--", canaryDoc]]) {
      const g = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
      assert.equal(g.status, 0, `git ${argv[0]} failed: ${g.stderr}`);
    }

    const armed = runChecker(["--strict"], env);
    assert.equal(armed.code, 1, `the gate did NOT bite on a planted false claim:\n${armed.out}`);
    assert.match(armed.out, /claim-canary-tmp/);
    // The claim is false because the script runs only from verify:hard, which
    // nothing invokes -- MANUAL, not UNWIRED. If this ever reads UNWIRED the
    // graph walk has broken and every claim would collapse to the same verdict.
    assert.match(armed.out, /\[MANUAL\]/);
  } finally {
    rmSync(canaryDoc, { force: true });
    rmSync(scratch, { recursive: true, force: true });
  }

  // DISARMED: prove the red above came from the canary and not from the repo.
  // Without this, a permanently-red gate would satisfy the test above forever.
  const disarmed = runChecker(["--strict"]);
  assert.equal(disarmed.code, 0, `still red after removing the canary:\n${disarmed.out}`);
});
