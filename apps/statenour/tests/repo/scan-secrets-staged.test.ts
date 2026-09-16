/**
 * The staged secret scanner must actually SCAN — under the environment a real
 * `git commit` uses, and against the bytes that are being committed.
 *
 * WHY THIS EXISTS. Until 2026-09-16 `scan-secrets.ts --staged` scanned ZERO
 * files on every commit and printed `✓ scan-secrets · no findings · scanned 1
 * files` while doing it. Measured, not inferred:
 *
 *   git exports `GIT_DIR` (absolute) and no `GIT_WORK_TREE` to its hooks, and
 *   lefthook runs this job with `root: "apps/statenour"`. With `GIT_DIR` set and
 *   `GIT_WORK_TREE` unset, git treats the CURRENT DIRECTORY as the work-tree
 *   root, so `git rev-parse --show-toplevel` answered `<repo>/apps/statenour`
 *   while `git diff --cached --name-only` kept answering repo-root-relative
 *   paths. `join(repoRoot, f)` then built `.../apps/statenour/apps/statenour/…`,
 *   `statSync` threw, and the loop skipped the file in silence. The count in the
 *   receipt was taken before the skip, so it reported a file it never opened.
 *
 *   A planted `AKIA…` key: clean env → CRITICAL, exit 1. `GIT_DIR` set →
 *   "no findings", exit 0. An AWS key would have committed cleanly.
 *
 * Every pre-existing test of this scanner ran with a CLEAN environment, which is
 * why all of them passed throughout. So the load-bearing case here is the one
 * that sets `GIT_DIR` — the others are its controls.
 *
 * SAFETY. Nothing is written to the working tree and the real index is never
 * opened: `GIT_INDEX_FILE` points at a throwaway index seeded from HEAD, and the
 * probe file exists only as a blob written straight into that index. A crash
 * mid-test therefore cannot strand a fake key under `lib/`. This is only
 * possible because `--staged` now reads the INDEX rather than the disk — which
 * was itself a bug: `git add` a key, edit it out of the working copy, and a
 * disk-reading scanner found nothing while the secret entered the commit.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const APP = resolve(__dirname, "..", "..");
const SCRIPT = "scripts/scan-secrets.ts";
const CHILD_MAX_BUFFER = 8 * 1024 * 1024;

/** Obviously fake, matches `\bAKIA[0-9A-Z]{16}\b`, and on no allow-list. */
const FAKE_KEY = `AKIA${"Q".repeat(16)}`;
const RULE = "aws_access_key";
const STAGED_AS = "apps/statenour/lib/ZzSecretScanCanaryProbe.ts";
const PASS_LINE = /no findings/;

function gitDirOf(): string {
  const r = spawnSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: APP, encoding: "utf8" });
  const d = (r.stdout ?? "").trim();
  expect(d, "could not resolve the git dir").not.toBe("");
  return d;
}

/**
 * Stage `source` as STAGED_AS in a throwaway index and run the scanner.
 * `extraEnv` exists to replay the real hook environment on purpose.
 */
function runStaged(source: string | null, extraEnv: Record<string, string> = {}) {
  const indexFile = join(tmpdir(), `ss-canary-${process.pid}-${Math.random().toString(36).slice(2)}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile, ...extraEnv };
  const git = (args: string[], input?: string) =>
    spawnSync("git", args, { cwd: APP, env, encoding: "utf8", input, maxBuffer: CHILD_MAX_BUFFER });
  try {
    expect(git(["read-tree", "HEAD"]).status, "could not seed the scratch index").toBe(0);

    if (source !== null) {
      const blob = git(["hash-object", "-w", "--stdin"], source);
      expect(blob.status, "could not write the probe blob").toBe(0);
      expect(
        git(["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},${STAGED_AS}`]).status,
        "could not stage the probe into the scratch index",
      ).toBe(0);
    }

    const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT, "--staged"], {
      cwd: APP,
      env,
      encoding: "utf8",
      shell: true,
      timeout: 180_000,
      maxBuffer: CHILD_MAX_BUFFER,
    });
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
  } finally {
    spawnSync("node", ["-e", `require("fs").rmSync(${JSON.stringify(indexFile)},{force:true})`]);
  }
}

const VIOLATION = `export const NOT_A_REAL_KEY = "${FAKE_KEY}";\n`;
const BENIGN = `export const GREETING = "hello";\n`;

describe("scan-secrets --staged actually scans", () => {
  it("BREAKS: it catches a staged key under the REAL hook env (valid GIT_DIR)", () => {
    const { out, code } = runStaged(VIOLATION, { GIT_DIR: gitDirOf() });

    // Exit code alone is not proof — a parse or config error is non-zero too.
    expect(out, "the rule was not named, so this could be an unrelated crash").toContain(RULE);
    expect(code, "a staged secret must not exit 0").not.toBe(0);
    expect(out).not.toMatch(PASS_LINE);
  }, 200_000);

  it("catches the same key in a clean env — the control the old suite had", () => {
    const { out, code } = runStaged(VIOLATION);
    expect(out).toContain(RULE);
    expect(code).not.toBe(0);
  }, 200_000);

  it("a BENIGN staged file passes and reports one file scanned, in both envs", () => {
    // The ALLOW half. Without it, a scanner that rejected everything would score
    // green above, and the first false positive would get it switched off.
    //
    // ⚠ This one is an ALLOW control ONLY — do not read it as evidence the
    // scanner is working. Measured against the pre-fix script it passed anyway,
    // because the old receipt printed `targetFiles.length` (taken before the
    // skip) and so said "scanned 1 files" about a file it never opened. The
    // deny cases above are what actually detect the fail-open.
    for (const [label, env] of [["clean env", {}], ["hook env", { GIT_DIR: gitDirOf() }]] as const) {
      const { out, code } = runStaged(BENIGN, env);
      expect(code, `a clean staged file must pass (${label})`).toBe(0);
      expect(out, `the scanner did not open the staged file (${label})`).toMatch(/scanned 1 files/);
    }
  }, 200_000);

  it("NOTHING STAGED does not borrow the pass line", () => {
    // The CI shape: a checkout stages nothing, so a bare --staged run reads
    // nothing. That must not look like a clean bill of health.
    const { out, code } = runStaged(null);
    expect(code, "an empty staged set is not an error").toBe(0);
    expect(out).toMatch(/NOTHING SCANNED/);
  }, 200_000);
});

describe("the fixes that make the above possible are still in place", () => {
  const src = readFileSync(resolve(APP, SCRIPT), "utf8");

  it("git runs with the hook's GIT_DIR / GIT_WORK_TREE stripped", () => {
    // Source assertion, declared as one — the behavioural proof is the hook-env
    // pair above. This makes a future "tidy up the env handling" argue with a test.
    expect(src).toContain("delete env.GIT_DIR;");
    expect(src).toContain("delete env.GIT_WORK_TREE;");
    // Keeping GIT_INDEX_FILE is what makes a PARTIAL commit scan the right bytes.
    expect(src).not.toMatch(/delete env\.GIT_INDEX_FILE/);
  });

  it("--staged reads the INDEX, not the working tree", () => {
    expect(src).toMatch(/function stagedBlob/);
    expect(src).toMatch(/"show", `:\$\{repoRelPath\}`/);
    // The old shape built a filesystem path from --show-toplevel. It must not
    // come back: that is what the wrong toplevel was able to poison.
    expect(src).not.toMatch(/getStagedFiles\(\)\.map\(\(f\) => join\(repoRoot, f\)\)/);
  });

  it("a staged file that cannot be read is LOUD, not a silent continue", () => {
    expect(src).toMatch(/could not be read from the index/);
    expect(src).toMatch(/NOT scanned, NOT a pass/);
  });
});
