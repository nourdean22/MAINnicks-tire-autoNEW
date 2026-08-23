/**
 * Canaries for the DOC-CLAIM gate (scripts/check-doc-claims.mjs).
 *
 * Discovered automatically by verify.mjs, so this file IS the wiring -- no CI
 * edit, per the design note in verify.mjs. `pnpm agent:verify` runs it, and
 * .github/workflows/agent-policy.yml runs that on every PR.
 *
 * WHY IT EXISTS. The checker's whole subject is controls that claim to run and
 * do not. Shipping it report-only would have made it the next instance of the
 * class it was written to find, and this repo's rule is explicit: no hook,
 * gate, lint, guard, alert or probe ships without a test that BREAKS it and
 * asserts it fails.
 *
 * EVERYTHING HERE EVALUATES A COMMIT, NEVER THE WORKING TREE.
 *
 * The first version of this file tested the working tree and passed locally
 * while the same code failed in CI -- and CI was right. Local said 707 markdown
 * files and 0 unresolved claims; CI said 722 and 1. Two causes, both invisible
 * from inside the checkout: it sits on a branch 192 commits behind origin/main,
 * so `git ls-files` could not see 15 files that exist on main; and a concurrent
 * session had an UNCOMMITTED fix to the one false claim, so the scan read a
 * corrected file that exists in no commit anywhere.
 *
 * A canary calibrated against one dirty checkout tests that checkout, not the
 * repo. Pinning to a ref makes a local run and a CI run of the same ref the
 * same measurement -- and, as a bonus, this file now writes nothing into a
 * checkout that concurrent sessions share.
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

function runChecker(args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { cwd: ROOT, encoding: "utf8" });
  if (r.error) assert.fail(`could not run the checker: ${r.error.message}`);
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

/**
 * Run `fn` against a throwaway commit = HEAD + one extra file. Nothing is
 * written into the working tree and the shared index is never opened; the
 * commit is never referenced, so git garbage-collects it.
 */
function withCanaryCommit(path, contents, fn) {
  const scratch = mkdtempSync(join(tmpdir(), "doc-claim-fixture-"));
  try {
    const blobFile = join(scratch, "blob");
    writeFileSync(blobFile, contents);
    const blob = git(["hash-object", "-w", blobFile]);
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    git(["read-tree", "HEAD"], env);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], env);
    // A TREE, not a commit. `git commit-tree` needs an author identity, which
    // CI runners do not have -- it failed there with "Author identity unknown"
    // while passing locally: the third local-vs-CI divergence in this file's
    // short life. ls-tree and cat-file both accept a tree-ish, so the commit
    // object was never needed in the first place.
    return fn(git(["write-tree"], env));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Same as withCanaryCommit, for fixtures that need more than one file. */
function withTwoFiles(files, fn) {
  const scratch = mkdtempSync(join(tmpdir(), "doc-claim-multi-"));
  try {
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    git(["read-tree", "HEAD"], env);
    for (const [i, f] of files.entries()) {
      const blobFile = join(scratch, `blob${i}`);
      writeFileSync(blobFile, f.body);
      const blob = git(["hash-object", "-w", blobFile]);
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], env);
    }
    return fn(git(["write-tree"], env));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function git(argv, env = {}) {
  const r = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, `git ${argv.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

test("the resolver self-test passes", () => {
  const { code, out } = runChecker(["--selftest", "--ref=HEAD"]);
  assert.equal(code, 0, `selftest failed:\n${out}`);
  // Pin the MECHANISM, not just the verdict. v3 of the checker reached the right
  // conclusion about check-anti-slop.sh through an invented reason ("appears in
  // no composite" -- it IS in verify:hard), and a verdict-only assertion would
  // have passed that too.
  //
  // Asserting the TIER and the leaf alias only, deliberately. An earlier version
  // also required the message to name `verify:hard`; that passed locally and
  // failed in CI, because verify:hard reaches check:anti-slop only in a sibling
  // session's uncommitted package.json (origin/main has 17 links, not 18).
  assert.match(out, /check-anti-slop\.sh -> MANUAL/);
  assert.match(out, /check:anti-slop/);
  // A hand-measured edge that exists on origin/main -- link 9 of verify:hard's 17.
  assert.match(out, /walk traverses verify:hard -> check:raw-sql/);
});

test("--strict is green against HEAD", () => {
  const { code, out } = runChecker(["--strict", "--ref=HEAD"]);
  assert.equal(code, 0, `--strict is red; fix the claim or record it in KNOWN_FALSE, do not relax the check:\n${out}`);
});

test("BREAKS: a planted false gate claim makes --strict exit 1", () => {
  const scratch = mkdtempSync(join(tmpdir(), "doc-claim-canary-"));
  const indexFile = join(scratch, "index");
  const blobFile = join(scratch, "canary.md");
  let armedRef;
  try {
    writeFileSync(
      blobFile,
      "# canary\n\nAnti-slop is **verified at push time** via `scripts/check-anti-slop.sh`.\n",
    );
    const blob = git(["hash-object", "-w", blobFile]);

    // Build a throwaway COMMIT = HEAD + the canary doc, in a scratch index.
    // Nothing is written into the working tree and the shared index is never
    // opened -- this checkout is shared with concurrent sessions.
    const env = { GIT_INDEX_FILE: indexFile };
    git(["read-tree", "HEAD"], env);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},docs/agent-audit/.claim-canary.md`], env);
    armedRef = git(["write-tree"], env); // tree-ish; see withCanaryCommit

    const armed = runChecker(["--strict", `--ref=${armedRef}`]);
    assert.equal(armed.code, 1, `the gate did NOT bite on a planted false claim:\n${armed.out}`);
    assert.match(armed.out, /claim-canary/);
    // MANUAL, not UNWIRED: the script is reachable from verify:hard, which no
    // hook runs. If this ever reads UNWIRED the graph walk has broken and every
    // claim would collapse to one verdict.
    assert.match(armed.out, /\[MANUAL\]/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  // DISARMED. Proves the red above came from the canary and not from the repo:
  // without this, a permanently-red gate would satisfy the arm above forever.
  const disarmed = runChecker(["--strict", "--ref=HEAD"]);
  assert.equal(disarmed.code, 0, `still red without the canary:\n${disarmed.out}`);
});

test("negation: a truthful 'never runs in CI' is not reported, its positive twin is", () => {
  /*
   * Raised in review: the GATE regex classified truthful NEGATIVE statements as
   * enforcement claims. `CONSOLIDATION-PLAN-2026-05-16.md:84` says E2E "never
   * runs in CI" and was reported unresolved -- so once --strict is wired, the
   * most honest sentences in the repo would hold the gate red exactly like
   * stale enforcement claims.
   *
   * Both directions in ONE fixture, because a test that only proves the
   * negative is suppressed cannot tell suppression apart from the detector
   * having stopped working altogether.
   */
  const fixture = [
    "# fixture",
    "",
    "The e2e suite **never runs in CI** via `scripts/check-anti-slop.sh`.",
    "The anti-slop check is **enforced in CI** via `scripts/check-anti-slop.sh`.",
    "",
  ].join("\n");

  const { out, code } = withCanaryCommit("docs/agent-audit/.negation-fixture.md", fixture, (ref) =>
    runChecker(["--only=gate", `--ref=${ref}`]),
  );
  void code;
  const lines = out.split("\n").filter((l) => l.includes(".negation-fixture.md"));
  assert.equal(
    lines.length,
    1,
    `expected exactly ONE finding (the positive claim); got ${lines.length}:\n${lines.join("\n")}`,
  );
  assert.match(out, /enforced in CI/, "the positive claim must still be detected");
  assert.doesNotMatch(out, /never runs in CI/, "the negated claim must not be reported");
});

test("historical records are skipped, live docs are not — same clause, both paths", () => {
  /*
   * A doc whose NAME or PATH stamps its frame (_archive/, 90-archive/,
   * research-packs/, an ISO date in the filename) is a record of what was true
   * then, not a current-truth claim. Re-dating one would assert a measurement
   * nobody made -- a brand-new false claim manufactured by the tool built to
   * remove them.
   *
   * Both directions in ONE fixture, because a test that only proves the archive
   * copy is skipped cannot distinguish that from the detector having died: an
   * identical clause at a live path must still be reported.
   */
  // Phrasing matters: COMPLETENESS matches `nothing\s+(else\s+)?calls`, so
  // "Nothing in this repo ever calls" does NOT match. The first draft of this
  // fixture used that phrasing and the test failed asserting the live copy was
  // reported -- the fixture was wrong, not the filter. Recorded because a
  // fixture that does not trigger the detector tests nothing at all.
  const clause = "# fixture\n\nNothing calls `resumeStuckCampaigns()` any more.\n";
  const live = "docs/agent-audit/.hist-fixture-live.md";
  const archived = "docs/90-archive/.hist-fixture-archived.md";

  const out = withTwoFiles(
    [{ path: live, body: clause }, { path: archived, body: clause }],
    (ref) => runChecker(["--only=completeness", `--ref=${ref}`]).out,
  );

  assert.match(out, /hist-fixture-live/, "the LIVE copy must still be reported");
  assert.doesNotMatch(out, /hist-fixture-archived/, "the ARCHIVED copy must be skipped");
  // The skip must be announced, not merely performed -- probe rule 5. A silent
  // exclusion prints the same green as a clean sweep.
  assert.match(out, /skipped \d+ historical\/archive files/);
});

test("BREAKS: a KNOWN_FALSE entry that is no longer needed fails the run", () => {
  // The allowlist rule copied from PR #1808: a REDUNDANT entry is an error, not
  // a shrug. Simulated by pointing the checker at a ref where the held claim is
  // already fixed -- origin/main is the wrong direction, so build a commit that
  // rewrites DESIGN.md:5 into a true sentence and assert the gate complains that
  // the entry can go. Without this arm the allowlist could silently become a
  // permanent excuse list, which is precisely how the class this repo tracks
  // regenerates.
  const scratch = mkdtempSync(join(tmpdir(), "doc-claim-redundant-"));
  const indexFile = join(scratch, "index");
  const fixed = join(scratch, "DESIGN.md");
  try {
    const original = spawnSync("git", ["show", "HEAD:apps/statenour/docs/DESIGN.md"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(original.status, 0, "could not read DESIGN.md from HEAD");
    const lines = original.stdout.split("\n");
    lines[4] = "**Three of these are gate-checked** by `scripts/check-anti-slop.sh`, run by `pnpm verify:hard`:";
    writeFileSync(fixed, lines.join("\n"));
    const blob = git(["hash-object", "-w", fixed]);

    const env = { GIT_INDEX_FILE: indexFile };
    git(["read-tree", "HEAD"], env);
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},apps/statenour/docs/DESIGN.md`], env);
    const ref = git(["write-tree"], env); // tree-ish; see withCanaryCommit

    const r = runChecker(["--strict", `--ref=${ref}`]);
    assert.equal(r.code, 1, `a redundant KNOWN_FALSE entry did NOT fail the run:\n${r.out}`);
    assert.match(r.out, /no longer needed/);
    assert.match(r.out, /DESIGN\.md:5/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
