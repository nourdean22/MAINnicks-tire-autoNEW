/**
 * The brand-voice gate must not print a PASS when it could not read the diff.
 *
 * Reproduced 2026-08-17 on a merge commit: `execSync` defaults to a 1 MiB
 * maxBuffer, a merge staging `prerendered/**` overflowed it, the catch swallowed
 * ENOBUFS, and the script printed
 *   `[brand-voice] 0 file(s) scanned · 52 kernel rules · 0 violations · ok`
 * exiting 0 — BYTE-IDENTICAL to a genuinely clean commit, because most commits
 * stage no voice surfaces and so legitimately scan zero files. lefthook showed a
 * green check over an unscanned commit.
 *
 * These run the REAL script as a child process. A source-text assertion could
 * not tell the two outputs apart either — the whole defect is that they were the
 * same string, so only the exit code and the absence of the pass line prove it.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const APP = process.cwd();
const SCRIPT = "scripts/lint-brand-voice.ts";
// The audit enumerates the whole repository. Its output can exceed Node's
// 1 MiB spawnSync default on CI, which truncated the final mode receipt.
const CHILD_MAX_BUFFER = 8 * 1024 * 1024;

function run(env: Record<string, string> = {}, args: string[] = []) {
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, ...args], {
    cwd: APP,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: true,
    timeout: 180_000,
    maxBuffer: CHILD_MAX_BUFFER,
  });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
}

const PASS_LINE = /· 0 violations · ok/;

/**
 * The environment a REAL `git commit` hands its hooks: `GIT_DIR` absolute,
 * `GIT_WORK_TREE` unset. Measured, not assumed — a probe hook in a throwaway
 * repo printed `GIT_INDEX_FILE=[.git/index]` in a plain checkout and an
 * absolute `.../worktrees/<name>/index` inside a worktree, with `GIT_DIR`
 * exported alongside.
 *
 * Every test above this line ran with a CLEAN env, which is why they all passed
 * while the gate scanned nothing on every actual commit for months.
 */
function hookEnv(): Record<string, string> {
  const r = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: APP, encoding: "utf8" });
  const gitDir = (r.stdout ?? "").trim();
  expect(gitDir, "could not resolve the git dir for the hook-env probe").not.toBe("");
  return { GIT_DIR: gitDir };
}

describe("lint-brand-voice does not fail open", () => {
  it("an UNREADABLE staged diff exits non-zero and prints NO pass line", () => {
    // A corrupt index makes every git invocation fail (`index file smaller than
    // expected`, exit 128), which is the same observable state an ENOBUFS
    // overflow produced.
    //
    // ⚠ This used to be driven by `GIT_DIR: "/nonexistent-git-dir-for-test"`.
    // That stopped working on 2026-09-16 — ON PURPOSE. The script now strips
    // `GIT_DIR` before invoking git, because a VALID one (which every real
    // `git commit` exports) silently mis-resolved the pathspecs and blinded the
    // whole gate. So `GIT_DIR` is no longer a lever on this script's behaviour
    // in either direction, and the next test pins exactly that.
    const indexFile = join(tmpdir(), `bv-corrupt-${process.pid}.index`);
    try {
      writeFileSync(indexFile, "not-an-index");
      const { out, code } = run({ GIT_INDEX_FILE: indexFile });
      expect(code, "an unread diff must not exit 0").not.toBe(0);
      expect(out).not.toMatch(PASS_LINE);
      expect(out).toMatch(/COULD NOT READ THE DIFF/);
      expect(out).toMatch(/NOT a pass/);
    } finally {
      rmSync(indexFile, { force: true });
    }
  }, 200_000);

  it("an ambient GIT_DIR cannot steer the gate — it is stripped, not trusted", () => {
    // The fix's contract, from the other side: a bogus GIT_DIR in the
    // environment must change NOTHING, because the script deletes it and lets
    // git discover the repo from cwd. Before the fix this exact input made the
    // script fail loudly, which is how the original canary above "passed" while
    // the real hook env (a VALID GIT_DIR) passed silently over unscanned code.
    const bogus = run({ GIT_DIR: "/nonexistent-git-dir-for-test" });
    const clean = run();
    expect(bogus.code, "a bogus GIT_DIR must not change the outcome").toBe(clean.code);
    expect(bogus.out).not.toMatch(/COULD NOT READ/);
  }, 200_000);

  it("a normal run does not crash, so the guard is not just breaking the gate", () => {
    // Deliberately does NOT assert the pass line. Whether a bare run reports
    // "N file(s) scanned ... ok" or "NOTHING CHANGED to scan" depends on what
    // happens to be staged in the checkout this suite runs in, and a canary
    // that depends on ambient state is a canary that will be deleted. The
    // deterministic allow-canary below pins the pass line properly.
    const { out, code } = run();
    expect(code).toBe(0);
    expect(out).not.toMatch(/COULD NOT READ/);
    expect(out).toMatch(/· 0 violations · ok|NOTHING CHANGED to scan/);
  }, 200_000);

  it("NOTHING STAGED does not borrow the pass line — nothing read is not nothing wrong", () => {
    // An empty throwaway index means "no changes staged" with certainty,
    // whatever the real index holds. This is the exact shape CI ran in.
    const indexFile = join(tmpdir(), `bv-empty-index-${process.pid}.index`);
    try {
      const seed = spawnSync("git", ["read-tree", "HEAD"], {
        cwd: APP,
        env: { ...process.env, GIT_INDEX_FILE: indexFile },
        encoding: "utf8",
      });
      expect(seed.status, "could not seed the empty scratch index").toBe(0);
      const { out, code } = run({ GIT_INDEX_FILE: indexFile });
      expect(code, "an empty diff is not an error").toBe(0);
      expect(out).toMatch(/NOTHING CHANGED to scan/);
      expect(out, "a vacuous run must not be indistinguishable from a clean one").not.toMatch(PASS_LINE);
    } finally {
      rmSync(indexFile, { force: true });
    }
  }, 200_000);

  it("--range needs a ref, and an unresolvable one FAILS CLOSED", () => {
    const missing = run({}, ["--range"]);
    expect(missing.code, "--range with no value must not proceed").not.toBe(0);
    expect(missing.out).toMatch(/--range needs a ref/);

    const bogus = run({}, ["--range", "zz-not-a-ref-bv-canary"]);
    expect(bogus.code, "an unresolvable base must not exit 0").not.toBe(0);
    expect(bogus.out).toMatch(/COULD NOT READ THE DIFF/);
    expect(bogus.out).not.toMatch(PASS_LINE);
  }, 200_000);

  it("RANGE mode is not vacuous — a range that touches a voice surface scans it", () => {
    // This is the CI mode, and the reason it exists: `.github/workflows/test.yml`
    // used to run the BARE script on a checkout that stages nothing, so it
    // scanned zero files on every run and printed the pass line.
    //
    // The range is derived, not hard-coded: the newest commit that touched
    // `server/services/vapi.ts` (an IN_SCOPE path), diffed from its parent. That
    // keeps the test meaningful on any branch instead of depending on what this
    // particular branch happens to contain.
    // WORKSPACE-relative, because a pathspec passed TO git resolves against
    // cwd — the inverse of `--name-only`'s repo-root-relative OUTPUT. Getting
    // this backwards returns an empty result rather than an error, which is the
    // same convention trap that produced the bug this suite guards.
    const log = spawnSync("git", ["log", "-1", "--format=%H", "--", "server/services/vapi.ts"], {
      cwd: APP,
      encoding: "utf8",
    });
    const sha = (log.stdout ?? "").trim();
    expect(sha, "no commit in history touches the in-scope probe path").not.toBe("");

    // `~1`, NOT `^`. The helper spawns with `shell: true`, and on Windows that
    // is cmd.exe, where `^` is the ESCAPE character — it is stripped before git
    // ever sees it. The ref then resolves to the commit itself, the range
    // collapses to `<sha>...HEAD`, and when that sha IS head the range is empty:
    // the linter correctly reports NOTHING CHANGED and the test fails for a
    // reason that has nothing to do with the gate. `~1` means the same thing to
    // git and is inert in both shells.
    const { out } = run({}, ["--range", `${sha}~1`]);

    // The exit code is deliberately NOT asserted. That range may reach back over
    // real history and legitimately contain pre-existing violations, so it can
    // exit 1 — which is the gate working, not failing. What this test is for is
    // NON-VACUITY: the range mode must have READ something.
    //
    // WHAT THIS USED TO ASSERT, AND WHY IT WAS WRONG. It required the output to
    // match `Mode: RANGE (added lines in`. That line is printed ONLY inside the
    // findings report (`lint-brand-voice.ts`, after `Found N violation(s)`); a
    // clean scan exits earlier on the `N file(s) scanned … ok` line and never
    // prints it. So the assertion did not test non-vacuity at all — it required
    // the probe range to CONTAIN VIOLATIONS, and passed only because the newest
    // commit touching the probe path happened to be old enough that the range
    // swept up months of history.
    //
    // It broke on 2026-09-18 the moment a commit touched `server/services/
    // vapi.ts` cleanly: the range narrowed to that one commit, the linter
    // scanned the file and found nothing — the correct outcome — and the test
    // failed. A test that goes red when the code is RIGHT is a test that will be
    // deleted or worked around, so it is fixed rather than tolerated.
    //
    // Non-vacuity is now asserted on what it actually means: something was read.
    expect(
      out,
      "RANGE mode read NOTHING over a range that changes a voice surface — the CI vacuum is back",
    ).toMatch(/\b[1-9]\d* file\(s\) scanned|in [1-9]\d* file\(s\)/);
    expect(out).not.toMatch(/NOTHING CHANGED to scan/);

    // The mode LABEL is still pinned — but only where it is actually emitted.
    // This keeps the original intent (range mode must announce itself as range,
    // not silently fall back to staged-diff mode) without requiring violations
    // to exist for the check to run.
    if (/Found [1-9]\d* brand-voice violation/.test(out)) {
      expect(out, "reported findings but did not announce RANGE mode").toMatch(
        /Mode: RANGE \(added lines in/,
      );
    }
  }, 200_000);

  it("audit mode still works — it reads git ls-files through the same helper", () => {
    const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, "--audit"], {
      cwd: APP,
      encoding: "utf8",
      shell: true,
      timeout: 180_000,
      maxBuffer: CHILD_MAX_BUFFER,
    });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(r.status).toBe(0);
    expect(out).toMatch(/Mode: AUDIT/);
  }, 200_000);
});

/**
 * The DENY canary. Everything above proves the gate fails CLOSED when it cannot
 * read, and does not crash on a clean tree — controls, both of them. Neither
 * proves the gate ever CATCHES anything, and "0 file(s) scanned ... ok" is what
 * a gate that catches nothing prints.
 *
 * That is not hypothetical here. Until 2026-09 the pre-commit path scanned zero
 * files on every commit: `IN_SCOPE`'s regexes are anchored to workspace-relative
 * paths (`^client/src/pages/...`), while `git diff --cached --name-only` returns
 * REPO-ROOT-relative paths (`apps/nickstire/client/src/pages/...`) no matter what
 * cwd git is given. `scopeOf()` therefore matched nothing, forever, silently.
 * scripts/lib/brandVoiceScope.test.ts pins that at the unit level; this pins it
 * end-to-end through the real binary, which is the only level at which the
 * "scanned zero files" failure is observable.
 *
 * HOW IT STAGES WITHOUT TOUCHING ANYTHING. GIT_INDEX_FILE points git at a
 * throwaway index seeded from HEAD, and the violating file is written straight
 * into that index as a blob via hash-object + update-index --cacheinfo. No file
 * is ever created in the working tree and the real index is never opened — so a
 * crash mid-test cannot strand a brand-voice-violating file under
 * client/src/pages/, which would break the gate for every other session sharing
 * this checkout. The script only ever reads `git diff --cached`, never the file
 * on disk, so an index-only blob is indistinguishable from a real staged edit.
 */
describe("lint-brand-voice actually BLOCKS a real violation (the deny canary)", () => {
  // Repo-root-relative ON PURPOSE — this is the exact path shape git reports,
  // and the shape that silently matched nothing before the strip was added.
  const STAGED_AS = "apps/nickstire/client/src/pages/ZzDenyCanaryProbe.tsx";
  const VIOLATION = "cliche.satisfaction-guaranteed";
  const SOURCE = [
    "export function ZzDenyCanaryProbe() {",
    "  return <p>Satisfaction guaranteed on every repair.</p>;",
    "}",
    "",
  ].join("\n");

  function runWithStagedBlob(source: string, extraEnv: Record<string, string> = {}) {
    const indexFile = join(tmpdir(), `bv-deny-canary-${process.pid}-${Math.random().toString(36).slice(2)}.index`);
    // The child must NOT inherit an ambient GIT_INDEX_FILE/GIT_DIR from a hook
    // that spawned this run; every git call below is pinned to `indexFile`.
    // `extraEnv` exists to replay the REAL hook environment on purpose.
    const env = { ...process.env, GIT_INDEX_FILE: indexFile, ...extraEnv };
    const git = (args: string[], input?: string) =>
      spawnSync("git", args, { cwd: APP, env, encoding: "utf8", input, maxBuffer: CHILD_MAX_BUFFER });

    try {
      // Seed the throwaway index from HEAD so ONLY the probe differs.
      expect(git(["read-tree", "HEAD"]).status, "could not seed the scratch index").toBe(0);

      const blob = git(["hash-object", "-w", "--stdin"], source);
      expect(blob.status, "could not write the probe blob").toBe(0);
      const sha = blob.stdout.trim();

      expect(
        git(["update-index", "--add", "--cacheinfo", `100644,${sha},${STAGED_AS}`]).status,
        "could not stage the probe into the scratch index",
      ).toBe(0);

      const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
        cwd: APP,
        env,
        encoding: "utf8",
        shell: true,
        timeout: 180_000,
        maxBuffer: CHILD_MAX_BUFFER,
      });
      return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
    } finally {
      rmSync(indexFile, { force: true });
    }
  }

  it("exits non-zero, names the rule, and prints NO pass line", () => {
    const { out, code } = runWithStagedBlob(SOURCE);

    // Exit code alone is not proof — a config or parse error is also non-zero.
    // The specific rule id has to appear, or this passes on a broken script.
    expect(out, "the violating rule was not reported").toContain(VIOLATION);
    expect(code, "a blocking violation must not exit 0").not.toBe(0);
    expect(out).not.toMatch(PASS_LINE);

    // And it must have actually SCANNED the file — the 2026-09 bug's signature
    // is a zero here, which reads as "nothing in scope" rather than as failure.
    expect(out, "the gate scanned zero files — the path-scope bug is back").not.toMatch(
      /\b0 file\(s\) scanned/,
    );
  }, 200_000);

  /**
   * THE SAME CANARY, UNDER THE ENVIRONMENT GIT ACTUALLY USES.
   *
   * This is the case the suite above missed for months, and it is the whole
   * reason the gate never fired. The test above runs with a clean env and
   * passes; add the `GIT_DIR` that every real `git commit` exports and, before
   * 2026-09-16, the identical staged violation produced
   * `0 file(s) scanned · 52 kernel rules · 0 violations · ok` and exit 0.
   *
   * Note the irony worth preserving: the FIRST test in this file already used
   * `GIT_DIR` to simulate an unreadable diff — but pointed at a NONEXISTENT
   * path, so git failed loudly. A VALID `GIT_DIR` is worse: git succeeds and
   * silently resolves pathspecs against the wrong root.
   */
  it("BREAKS: it blocks the same violation under the REAL hook env (valid GIT_DIR)", () => {
    const { out, code } = runWithStagedBlob(SOURCE, hookEnv());

    expect(out, "the violating rule was not reported under the hook env").toContain(VIOLATION);
    expect(code, "a blocking violation must not exit 0 under the hook env").not.toBe(0);
    expect(out).not.toMatch(PASS_LINE);
    expect(out, "scanned zero files under the hook env — the GIT_DIR fail-open is back").not.toMatch(
      /\b0 file\(s\) scanned/,
    );
  }, 200_000);

  /**
   * The ALLOW half of the pair. Without it, a gate that blocks EVERYTHING —
   * including clean copy — would score green on every test above, and the first
   * person it blocked wrongly would switch it off.
   */
  it("a BENIGN in-scope change passes and reports one file scanned, in both envs", () => {
    const BENIGN = [
      "export function ZzAllowCanaryProbe() {",
      "  return <p>Same-day on most tire jobs. Call (216) 862-0005.</p>;",
      "}",
      "",
    ].join("\n");

    for (const [label, env] of [["clean env", {}], ["hook env", hookEnv()]] as const) {
      const { out, code } = runWithStagedBlob(BENIGN, env);
      expect(code, `a clean in-scope change must pass (${label})`).toBe(0);
      expect(out, `the gate did not scan the changed file (${label})`).toMatch(/\b1 file\(s\) scanned/);
      expect(out).toMatch(PASS_LINE);
    }
  }, 200_000);
});

describe("the reads are bounded, so the overflow cannot recur", () => {
  const src = readFileSync(resolve(APP, SCRIPT), "utf8");

  it("every git call goes through the bounded helper — no bare execSync remains", () => {
    // `execSync` has a 1 MiB default; the helper pins 64 MiB explicitly.
    expect(src).not.toMatch(/\bexecSync\s*\(/);
    expect(src).toContain("const GIT_MAX_BUFFER = 64 * 1024 * 1024;");
    expect(src).toContain("maxBuffer: GIT_MAX_BUFFER");
  });

  it("it asks for NAMES first and filters to voice surfaces before reading content", () => {
    // This is what removes the overflow at the root: a megabyte of staged
    // prerendered HTML is never read, because it is not a voice surface.
    const start = src.indexOf("function scanDiff");
    expect(start, "scanDiff is gone — this assertion is measuring nothing").toBeGreaterThan(-1);
    const fn = src.slice(start, src.indexOf("const findings: Finding[]"));
    expect(fn).toContain('"--name-only"');
    expect(fn).toContain("scopeOf(f) !== null");
    // Per-file diffs keep each read bounded regardless of total diff size.
    expect(fn).toMatch(/"diff", "--cached", "-U0", "--", file/);
  });

  it("git runs with GIT_DIR and GIT_WORK_TREE stripped, and GIT_INDEX_FILE kept", () => {
    // Source assertion, and declared as one: the BEHAVIOURAL proof is the
    // hook-env deny/allow pair above. This pins the intent so a future
    // "simplify the env handling" edit has to argue with a named test.
    expect(src).toContain("delete env.GIT_DIR;");
    expect(src).toContain("delete env.GIT_WORK_TREE;");
    // Keeping GIT_INDEX_FILE is what makes a PARTIAL commit gate the right bytes.
    expect(src).not.toMatch(/delete env\.GIT_INDEX_FILE/);
    expect(src).toContain("env: GIT_ENV");
  });

  it("a changed in-scope file with an EMPTY per-file diff is UNREADABLE, not clean", () => {
    // Defence in depth behind the env fix: root-cause-independent, so a future
    // cwd or path-convention regression cannot reopen the same silent hole.
    expect(src).toContain('if (one.trim() === "")');
    expect(src).toMatch(/came back EMPTY/);
  });

  it("paths reach git as argv, never interpolated into a shell string", () => {
    // A filename containing a space or a quote must not be able to change the
    // command that runs.
    expect(src).toContain('execFileSync("git", args');
    expect(src).not.toMatch(/execFileSync\(\s*`git /);
  });
});
