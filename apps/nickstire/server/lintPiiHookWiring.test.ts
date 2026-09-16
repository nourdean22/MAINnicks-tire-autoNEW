/**
 * `lint:pii` now gates commits — this file is the canary that proves it, and
 * proves it under the environment a real `git commit` actually supplies.
 *
 * WHY THIS EXISTS. Until 2026-09-16 the PII linter ran in `pnpm run verify` and
 * in CI but sat in NO `lefthook.yml` job, so the pre-commit mode the script
 * implements never ran at commit time and no commit was ever blocked on staged
 * PII. Wiring a gate is the easy half; the hard half is that a gate which
 * silently scans nothing is worse than no gate, because it reads as safety.
 * Three staged-diff gates in this repo were doing exactly that on the day this
 * one was wired (PR #2363) — including statenour's staged SECRET scanner.
 *
 * THE HOOK ENVIRONMENT IS THE LOAD-BEARING CASE. `git commit` exports `GIT_DIR`
 * (absolute) and no `GIT_WORK_TREE` to its hooks, and lefthook runs this job
 * with `root: "apps/nickstire"`. With `GIT_DIR` set and `GIT_WORK_TREE` unset,
 * git treats the CURRENT DIRECTORY as the work-tree root, so per-file pathspecs
 * and `--show-toplevel` answer the wrong root while `--name-only` keeps
 * answering repo-root-relative paths. `lint-pii.mjs` strips both variables for
 * its own git calls precisely so this cannot happen; the `GIT_DIR` tests below
 * are what keep that strip honest. Every test here has a clean-env twin, and
 * the clean-env twin is the CONTROL — it passed throughout the era when the
 * other gates were blind.
 *
 * MODE IS ASSERTED, NOT ASSUMED. `lint-pii.mjs` falls back to AUDIT mode when
 * no in-scope file is staged, and audit mode does not block. So a harness bug
 * that stages nothing would print a cheerful green receipt over ~900 repo files
 * and every "clean" assertion below would pass vacuously. Each test therefore
 * asserts the literal `(pre-commit)` label. A clean zero and a broken harness
 * print the same thing unless you check which one you got.
 *
 * SAFETY. Nothing is written to the working tree and the real index is never
 * opened: `GIT_INDEX_FILE` points at a throwaway index seeded from HEAD, and
 * the probe exists only as a blob written straight into that index. A crash
 * mid-test cannot strand a fake phone number under `server/`.
 *
 * ONE ACKNOWLEDGED DEPENDENCY. The probe numbers below are real-shaped Cleveland
 * numbers, NOT the 555 range the linter's own fix advice recommends — they have
 * to be, because a 555 exchange is exempt by NANP reservation and a 555 probe
 * would make every DENY assertion here vacuous. This file is therefore safe only
 * while `.test.ts` stays OUT of `lint:pii`'s scope. If that scope ever widens,
 * this file trips the gate it is testing; waive the probe lines with
 * `// pii-allow:` rather than softening them into fiction.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const APP = resolve(__dirname, "..");
const REPO = resolve(APP, "..", "..");
const SCRIPT = "scripts/lint-pii.mjs";
const CHILD_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Cleveland area code, exchange 777 (NOT the 555 fiction range the rule
 * deliberately exempts), and on none of the three business-owned allowlist
 * entries. Every one of those three properties is load-bearing — see the
 * ALLOWED cases below, each of which changes exactly one of them.
 */
const PROBE_PHONE = "216-777-1234";
const WHY = "Hardcoded Cleveland-area phone in source";

/** In scope (`server/**`), and NOT a `.test.ts` — those are out of scope. */
const STAGED_AS = "apps/nickstire/server/ZzPiiCanaryProbe.ts";

const PRE_COMMIT_LABEL = "(pre-commit)";

function gitDirOf(): string {
  const r = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: APP, encoding: "utf8" });
  const d = (r.stdout ?? "").trim();
  expect(d, "could not resolve the git dir — the whole suite would be vacuous").not.toBe("");
  return d;
}

/**
 * Stage `source` as STAGED_AS in a throwaway index, then run the real linter.
 * `extraEnv` exists to replay the hook environment on purpose; `viaPnpm` runs
 * the exact string the lefthook job runs, indirection included.
 */
function runStaged(
  source: string,
  extraEnv: Record<string, string> = {},
  viaPnpm = false,
): { out: string; code: number | null } {
  const indexFile = join(tmpdir(), `pii-canary-${process.pid}-${Math.random().toString(36).slice(2)}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile, ...extraEnv };
  const git = (args: string[], input?: string) =>
    spawnSync("git", args, { cwd: APP, env, encoding: "utf8", input, maxBuffer: CHILD_MAX_BUFFER });

  expect(git(["read-tree", "HEAD"]).status, "could not seed the scratch index").toBe(0);

  const blob = git(["hash-object", "-w", "--stdin"], source);
  expect(blob.status, "could not write the probe blob").toBe(0);
  expect(
    git(["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},${STAGED_AS}`]).status,
    "could not stage the probe into the scratch index",
  ).toBe(0);

  const r = viaPnpm
    ? spawnSync("pnpm", ["run", "lint:pii"], {
        cwd: APP,
        env,
        encoding: "utf8",
        shell: true,
        timeout: 180_000,
        maxBuffer: CHILD_MAX_BUFFER,
      })
    : spawnSync(process.execPath, [SCRIPT], {
        cwd: APP,
        env,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: CHILD_MAX_BUFFER,
      });

  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
}

/** A violation: a bare number in executable code, no waiver. */
const SOURCE_BLOCKED = [
  "export const lastKnownCaller = {",
  `  phone: "${PROBE_PHONE}",`,
  "};",
  "",
].join("\n");

describe("lint:pii blocks a staged Cleveland phone — in BOTH environments", () => {
  /**
   * The case that matters. A nonzero exit is NOT proof on its own: a syntax
   * error, a missing module or a git failure all exit nonzero too, and a
   * deny-canary that only checks the code has passed on a config error before
   * in this repo. So the specific rule text must appear in the output.
   */
  it("BLOCKS under a VALID GIT_DIR — the environment a real commit supplies", () => {
    const { out, code } = runStaged(SOURCE_BLOCKED, { GIT_DIR: gitDirOf() });
    expect(out).toContain(PRE_COMMIT_LABEL);
    expect(out).toContain(WHY);
    expect(out).toContain(PROBE_PHONE);
    expect(code).toBe(1);
  });

  it("CONTROL: blocks with a clean env too", () => {
    const { out, code } = runStaged(SOURCE_BLOCKED);
    expect(out).toContain(PRE_COMMIT_LABEL);
    expect(out).toContain(WHY);
    expect(code).toBe(1);
  });

  /**
   * The hook does not run the script — it runs `pnpm run lint:pii`. That
   * indirection is a link in the chain, so one test pays the pnpm cost to
   * prove the package.json script resolves to a linter that still blocks.
   */
  it("blocks through the literal command the lefthook job runs", () => {
    const { out, code } = runStaged(SOURCE_BLOCKED, { GIT_DIR: gitDirOf() }, true);
    expect(out).toContain(WHY);
    expect(code).toBe(1);
  });
});

describe("lint:pii lets the designed escape hatches through", () => {
  /**
   * Without these, the gate would be one a frustrated reader routes around
   * with `--no-verify`, and then it gates nothing. guard-red-team names
   * mention-vs-execution as the largest source of guard false positives.
   * Each case flips exactly ONE property of the blocked probe.
   */
  const allowed: Array<[string, string]> = [
    [
      "an explicit `// pii-allow:` waiver with a reason, ON the offending line",
      [
        "export const internalLine = {",
        `  phone: "${PROBE_PHONE}", // pii-allow: back-office line, filtered so recovery crons never dial it`,
        "};",
        "",
      ].join("\n"),
    ],
    [
      "a 555 exchange (RFC/NANP-reserved for fiction)",
      ["export const fixtureCaller = {", '  phone: "216-555-0100",', "};", ""].join("\n"),
    ],
    [
      "prose that merely MENTIONS a number while explaining the guard",
      [
        "// The internal line is stored digits-only and never dialled;",
        `// historically that was written as ${PROBE_PHONE} in this comment.`,
        "export const dialGuardEnabled = true;",
        "",
      ].join("\n"),
    ],
  ];

  for (const [label, source] of allowed) {
    it(`ALLOWS ${label} — under GIT_DIR`, () => {
      const { out, code } = runStaged(source, { GIT_DIR: gitDirOf() });
      // Mode first. Without this the assertion is satisfiable by an audit-mode
      // run that never looked at the staged probe at all.
      expect(out).toContain(PRE_COMMIT_LABEL);
      expect(out).not.toContain("NOTHING SCANNED");
      expect(out).toContain("clean");
      expect(code).toBe(0);
    });
  }

  /**
   * The waiver's design claim, asserted rather than trusted: "waive by
   * SIGNATURE, never by filename — the marker sits on the offending line, so a
   * second violation appearing anywhere else in the same file still fails."
   * That granularity is the whole reason this is not a file-level exclusion,
   * and it is the property that would silently rot first — a well-meaning
   * "simplification" to a per-file skip would keep every test above green.
   */
  it("a waiver silences ITS OWN line only — a second violation in the same file still blocks", () => {
    const { out, code } = runStaged(
      [
        "export const internalLine = {",
        `  phone: "${PROBE_PHONE}", // pii-allow: back-office line, deliberately hardcoded`,
        '  fallback: "216-888-4321",',
        "};",
        "",
      ].join("\n"),
      { GIT_DIR: gitDirOf() },
    );
    expect(out).toContain(PRE_COMMIT_LABEL);
    expect(out).toContain("1 violation");
    expect(out).toContain("216-888-4321");
    // The waived number must NOT be among the reported violations.
    expect(out).not.toContain(PROBE_PHONE);
    expect(code).toBe(1);
  });
});

describe("the glob's blast radius is honest about itself", () => {
  /**
   * The lefthook glob is extension-only, so it triggers on files the linter's
   * own IN_SCOPE does not cover (`client/**`). The script then finds nothing
   * staged in scope and falls back to AUDIT mode over the whole app.
   *
   * That fallback is deliberate — the alternative is a directory glob, which
   * would be a SECOND definition of scope free to drift from the script's. But
   * "deliberate" is only defensible if the fallback (a) cannot block a commit
   * and (b) LABELS itself, so nobody reads an audit receipt as confirmation
   * that their staged changes were checked. Both are asserted here rather than
   * assumed from reading the source.
   */
  it("an out-of-scope stage falls back to a NON-BLOCKING audit that says `(audit)`", () => {
    const indexFile = join(tmpdir(), `pii-scope-${process.pid}-${Math.random().toString(36).slice(2)}.index`);
    const env = { ...process.env, GIT_INDEX_FILE: indexFile, GIT_DIR: gitDirOf() };
    const git = (args: string[], input?: string) =>
      spawnSync("git", args, { cwd: APP, env, encoding: "utf8", input, maxBuffer: CHILD_MAX_BUFFER });

    expect(git(["read-tree", "HEAD"]).status).toBe(0);
    const blob = git(["hash-object", "-w", "--stdin"], "export const x = 1;\n");
    expect(blob.status).toBe(0);
    // client/** is matched by the lefthook glob but NOT by the linter's IN_SCOPE.
    expect(
      git([
        "update-index", "--add", "--cacheinfo",
        `100644,${blob.stdout.trim()},apps/nickstire/client/src/ZzPiiScopeProbe.tsx`,
      ]).status,
    ).toBe(0);

    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: APP, env, encoding: "utf8", timeout: 180_000, maxBuffer: CHILD_MAX_BUFFER,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;

    expect(out).toContain("(audit)");
    expect(out).not.toContain(PRE_COMMIT_LABEL);
    // Non-blocking is the load-bearing half: a full-app audit that exited 1
    // would fail commits over pre-existing findings in untouched files.
    expect(r.status).toBe(0);
  });
});

describe("audit-mode enumeration is GIT_DIR-invariant", () => {
  /**
   * THE CALL SITE THE FAIL-CLOSED SWEEP MISSED. #2374 shipped this gate with
   * `env: GIT_ENV` on the two staged-diff git calls and NOT on the audit-mode
   * `git ls-files`. Measured from `apps/nickstire/` immediately after that
   * merge:
   *
   *   clean env   -> clean (919 files scanned)
   *   GIT_DIR set -> clean (38 files scanned)
   *
   * and the 38 were not a subset. With `GIT_DIR` set and `GIT_WORK_TREE`
   * unset, git treats the cwd as the work-tree root, so `git ls-files` returns
   * REPO-ROOT-relative paths (`apps/nickstire/server/…`) which miss
   * `isInScope`'s `^server/` anchor entirely; what survived was the repo
   * root's own `scripts/`. The run reported success over a different
   * package's files and printed a green receipt doing it.
   *
   * Audit mode does not block, so no violation was ever waved through a
   * commit — but "the receipt is meaningless" is the same defect this script
   * exists to catch, and it was three tests away from being caught.
   */
  const auditCount = (extraEnv: Record<string, string> = {}): number => {
    const r = spawnSync(process.execPath, [SCRIPT, "--audit"], {
      cwd: APP,
      env: { ...process.env, ...extraEnv },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: CHILD_MAX_BUFFER,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    const m = /\((\d+) files scanned\)/.exec(out);
    expect(m, `no files-scanned count in the receipt:\n${out.slice(0, 400)}`).not.toBeNull();
    return Number(m![1]);
  };

  it("scans the SAME number of files with and without GIT_DIR", () => {
    const clean = auditCount();
    const hook = auditCount({ GIT_DIR: gitDirOf() });
    expect(hook).toBe(clean);
  });

  /**
   * Equality alone is not enough: if BOTH environments broke the same way,
   * `38 === 38` would pass. The floor is what makes the pair load-bearing. It
   * is set well below the real figure (919 at the time of writing) so ordinary
   * growth and deletion never touch it, while the failure mode this test
   * exists for — an enumeration that collapses to a different package's files
   * — is far below it.
   */
  it("and that number is a real enumeration, not a collapsed one", () => {
    expect(auditCount({ GIT_DIR: gitDirOf() })).toBeGreaterThan(500);
  });
});

describe("the gate is actually WIRED into pre-commit", () => {
  /**
   * The tests above prove the linter blocks. They cannot prove git calls it —
   * that is what this reads. Structural on purpose, and paired with the
   * behavioural half above rather than standing alone: a config assertion by
   * itself is exactly the "mention, not execution" test this repo keeps
   * catching itself writing.
   */
  const yml = readFileSync(join(REPO, "lefthook.yml"), "utf8");

  /**
   * `pre-commit:` is the FIRST line of the file, so anchoring the slice on a
   * preceding newline returned index -1 and `slice(-1, …)` yielded an empty
   * string — every assertion below then failed on `''`, which is how this bug
   * announced itself. Failing closed was luck, not design: an assertion shaped
   * as `expect(block).not.toContain(...)` would have passed vacuously on that
   * same empty string. So the block is resolved explicitly and its bounds are
   * asserted before anything is read out of it.
   */
  const start = yml.search(/^pre-commit:/m);
  const end = yml.search(/^pre-push:/m);
  expect(start, "no pre-commit block in lefthook.yml").toBeGreaterThanOrEqual(0);
  expect(end, "no pre-push block — the slice bound is wrong").toBeGreaterThan(start);
  const preCommit = yml.slice(start, end);

  it("has a nickstire-lint-pii job in pre-commit, not somewhere else in the file", () => {
    expect(preCommit).toContain("nickstire-lint-pii:");
  });

  it("runs it from the nickstire root, or the script resolves the wrong app", () => {
    const job = preCommit.slice(preCommit.indexOf("nickstire-lint-pii:"));
    expect(job).toMatch(/root:\s*"apps\/nickstire"/);
    expect(job).toMatch(/run:\s*pnpm run lint:pii/);
  });

  it("triggers on every extension the linter's own scope covers", () => {
    const job = preCommit.slice(preCommit.indexOf("nickstire-lint-pii:"));
    const glob = /glob:\s*"([^"]+)"/.exec(job)?.[1] ?? "";
    // `scripts/**` is in scope and is full of .mjs — a ts-only glob would let
    // a staged .mjs leak past a gate that would otherwise have caught it.
    for (const ext of ["ts", "tsx", "mjs", "js"]) expect(glob).toContain(ext);
  });

  it("is the same script `pnpm run verify` already runs — one definition, not two", () => {
    const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
    expect(pkg.scripts["lint:pii"]).toContain(SCRIPT);
    expect(pkg.scripts.verify).toContain("lint:pii");
  });
});
