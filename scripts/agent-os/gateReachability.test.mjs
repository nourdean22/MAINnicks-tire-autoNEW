/**
 * Canary for check-gate-reachability.mjs.
 *
 * THE SELF-REFERENCE PROBLEM. This is the one file in the repo where a presence
 * assertion would be actively absurd: the defect under guard is an artifact that
 * EXISTS and runs nowhere. `assert(existsSync("check-gate-reachability.mjs"))`
 * would pass just as happily if the script were never invoked by anything —
 * which is precisely the state it was written to detect. So every arm below
 * asserts BEHAVIOUR, and the fixtures are ones this file owns.
 *
 * THE ARMS, and why each exists:
 *   1. ORPHAN REPORTED — plant a gate nothing invokes; require it named.
 *   2. THREE WIRINGS SPARED — verify-chain, CI workflow, lefthook. Without
 *      these, arm 1 would pass for a checker that simply reports everything.
 *   3. RULES NOT DRAWN TOO WIDE — `:fix` and `turbo run` aliases are exempt by
 *      rule, so this arm plants a bare `tsx` gate ALONGSIDE them and requires
 *      only the bare one reported. An exemption wide enough to swallow the real
 *      defect is the failure mode that matters.
 *   4. ALLOWLIST HYGIENE — every entry carries a reason, and no entry is
 *      REDUNDANT. A waiver for something now reachable is stale paperwork that
 *      teaches readers the list is decorative (the rule #1809 established).
 *   5. THE MUTATION ARM — the important one. A scratch copy of the checker is
 *      edited to always find nothing, and required to exit 0 on the orphan
 *      fixture. Without it, arm 1 would pass for a CLI that exits 1 for some
 *      unrelated reason. The mutation is asserted to have APPLIED first,
 *      because a no-op edit makes the whole arm vacuous and still green.
 *   6. THE LIVE REPO — the arm that makes this a GATE rather than a unit test.
 *      Without it the suite would exercise the logic on fixtures and never look
 *      at the repo: a control that runs and examines nothing.
 *   7. `--root` WITH NO VALUE exits 2. Added after a post-merge self-audit found
 *      the original silently fell back to the live repo and exited 0, so a
 *      canary with a typo'd --root would have measured the wrong tree and
 *      passed — a false green inside the tool built to catch false greens.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  findUnreachableGates,
  isAliasOrFixer,
  loadPackages,
  loadExternalRefs,
  ALLOW,
} from "./check-gate-reachability.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, "check-gate-reachability.mjs");
const REPO_ROOT = join(HERE, "..", "..");

/** Build a throwaway repo. `scripts` is the app package's script map. */
function fixtureRepo({ scripts, workflow, lefthook }) {
  const dir = mkdtempSync(join(tmpdir(), "gatereach-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture-root", scripts: {} }));
  mkdirSync(join(dir, "apps", "app1"), { recursive: true });
  writeFileSync(join(dir, "apps", "app1", "package.json"), JSON.stringify({ name: "app1", scripts }));
  if (workflow) {
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), workflow);
  }
  if (lefthook) writeFileSync(join(dir, "lefthook.yml"), lefthook);
  return dir;
}

/** Run a checker CLI against a fixture root; never throws. */
function runCli(dir, checker = CHECKER) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [checker, "--root", dir], { encoding: "utf8" }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const BASE = {
  verify: "pnpm run lint:wired",
  "lint:wired": "node scripts/wired.mjs",
};

test("arm 1 · a gate nothing invokes is reported, and the CLI exits 1", () => {
  const dir = fixtureRepo({ scripts: { ...BASE, "lint:orphan": "tsx scripts/orphan.ts" } });
  try {
    const r = runCli(dir);
    assert.equal(r.code, 1, "an unreachable gate must fail the run");
    assert.match(r.out, /lint:orphan/, "the orphan must be named");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("arm 2 · a gate is spared when reached via verify chain, CI, or lefthook", () => {
  const cases = [
    ["verify chain", { scripts: { verify: "pnpm run lint:thing", "lint:thing": "tsx x.ts" } }],
    [
      "CI workflow",
      {
        scripts: { "lint:thing": "tsx x.ts" },
        workflow: "jobs:\n  a:\n    steps:\n      - run: pnpm --filter app1 lint:thing\n",
      },
    ],
    [
      "lefthook",
      { scripts: { "lint:thing": "tsx x.ts" }, lefthook: "pre-commit:\n  commands:\n    t:\n      run: pnpm run lint:thing\n" },
    ],
  ];
  for (const [label, spec] of cases) {
    const dir = fixtureRepo(spec);
    try {
      const r = runCli(dir);
      assert.equal(r.code, 0, `${label}: a reachable gate must not be reported — got:\n${r.out}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("arm 3 · the alias/fixer rules do not swallow a real orphan", () => {
  const pkgs = [
    {
      name: "app1",
      scripts: {
        "lint:fix": "prettier --write .",
        "check:all": "turbo run check",
        "check:affected": "turbo run check --affected",
        "lint:cron-wiring": "tsx scripts/lint-cron-wiring.ts", // the real 2026-08-23 defect
      },
    },
  ];
  const reported = findUnreachableGates(pkgs, [], []).map((r) => r.script);
  assert.deepEqual(reported, ["lint:cron-wiring"], "only the bare script is a gate; aliases and fixers are not");
  assert.ok(isAliasOrFixer("lint:fix", "prettier --write ."), ":fix is a writer, not a gate");
  assert.ok(isAliasOrFixer("check:all", "turbo run check"), "a pure turbo alias is not new work");
  assert.ok(!isAliasOrFixer("lint:cron-wiring", "tsx scripts/lint-cron-wiring.ts"), "a bare script IS a gate");
});

test("arm 4 · every allowlist entry has a reason and none is redundant", () => {
  for (const a of ALLOW) {
    assert.ok(a.pkg && a.script, "an allowlist entry needs pkg and script");
    assert.ok(a.reason && a.reason.trim().length > 20, `${a.script}: a waiver needs a real reason, not a stub`);
  }
  // Redundancy: with the allowlist EMPTY, each entry must still be genuinely
  // unreachable in the live repo. If one is not, it has been wired since and
  // the entry must be deleted — a stale waiver teaches readers the list is
  // decorative. Delete the entry; do not delete this arm.
  const live = findUnreachableGates(loadPackages(REPO_ROOT), loadExternalRefs(REPO_ROOT), []).map(
    (x) => `${x.pkg}::${x.script}`,
  );
  for (const a of ALLOW) {
    assert.ok(
      live.includes(`${a.pkg}::${a.script}`),
      `${a.pkg} · ${a.script} is REACHABLE now, so its allowlist entry is redundant — delete the entry.`,
    );
  }
});

test("arm 6 · THE LIVE REPO ITSELF has no unreachable gate", () => {
  // Arms 1-5 prove the checker WORKS. This is the arm that makes it a GATE:
  // without it, `pnpm agent:verify` would exercise the logic on fixtures and
  // never look at the repo — a control that runs but examines nothing, which is
  // the precise defect check-gate-reachability.mjs was written to catch. Leaving
  // it out would have made this file a worked example of its own subject.
  const r = runCli(REPO_ROOT);
  assert.equal(
    r.code,
    0,
    `a check:*/lint:* script in this repo is reachable from nothing.\n${r.out}`,
  );
});

test("arm 7 · `--root` with no value exits 2, it does not silently scan the live repo", () => {
  // The defect this arm exists for was in the ORIGINAL of this gate, found in a
  // post-merge self-audit. `process.argv[i + 1]` is `undefined` when --root is
  // the last argument, and passing `undefined` RE-TRIGGERS the `root = ROOT`
  // default parameter — so the run scanned the live repo and exited 0 while the
  // caller believed it was pointed at a fixture. A canary with a typo'd --root
  // would have measured the wrong tree and passed: a false green inside the
  // tool built to catch false greens.
  // Both shapes: --root as the LAST argument (value genuinely missing), and
  // --root with an empty string. The first is the one that produced the bug.
  for (const argv of [["--root"], ["--root", ""], ["--root", "--other"]]) {
    const r = spawnSync(process.execPath, [CHECKER, ...argv], { encoding: "utf8" });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    assert.equal(
      r.status,
      2,
      `argv ${JSON.stringify(argv)} must refuse (exit 2), not fall back to the live repo — got ${r.status}:\n${out}`,
    );
    assert.match(out, /--root given with no directory/);
  }
});

test("arm 5 · a checker that finds nothing cannot pass this suite", () => {
  const src = readFileSync(CHECKER, "utf8");
  const NEEDLE = "  const out = [];";
  assert.ok(src.includes(NEEDLE), "mutation target moved — update this arm rather than deleting it");
  const mutated = src.replace(NEEDLE, "  const out = []; return out;");
  assert.notEqual(mutated, src, "the mutation did not apply — this arm would be vacuous");

  const scratch = join(mkdtempSync(join(tmpdir(), "gatereach-mut-")), "mutated.mjs");
  const dir = fixtureRepo({ scripts: { ...BASE, "lint:orphan": "tsx scripts/orphan.ts" } });
  try {
    writeFileSync(scratch, mutated);
    assert.equal(runCli(dir).code, 1, "precondition: the real checker fails on this fixture");
    assert.equal(
      runCli(dir, scratch).code,
      0,
      "a blinded checker still exited non-zero — arm 1's failure did not come from the finding",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(scratch), { recursive: true, force: true });
  }
});
