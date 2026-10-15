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
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const APP = resolve(__dirname, "..", "..");
const SCRIPT = "scripts/scan-secrets.ts";

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
 * spawnSync's result shape without spawnSync's cost: a synchronous child holds the vitest
 * worker's event loop for the whole run (the tsx scan is ~5 s quiet, far longer loaded),
 * so under load the worker could not answer the runner's RPC and the file died with
 * "Timeout calling onTaskUpdate" though no test failed.
 */
function spawnAsync(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input?: string; shell?: boolean; timeout?: number },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: opts.shell, timeout: opts.timeout, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.stdin.on("error", () => {}); // the child may exit before it reads its input
    child.on("error", (e) => done({ status: null, stdout, stderr: `${stderr}${e.message}` }));
    child.on("close", (status) => done({ status, stdout, stderr }));
    child.stdin.end(opts.input ?? "");
  });
}

/**
 * Stage `source` as STAGED_AS in a throwaway index and run the scanner.
 * `extraEnv` exists to replay the real hook environment on purpose.
 */
async function runStaged(source: string | null, extraEnv: Record<string, string> = {}, args: string[] = []) {
  const indexFile = join(tmpdir(), `ss-canary-${process.pid}-${Math.random().toString(36).slice(2)}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile, ...extraEnv };
  const git = (args: string[], input?: string) => spawnAsync("git", args, { cwd: APP, env, input });
  try {
    expect((await git(["read-tree", "HEAD"])).status, "could not seed the scratch index").toBe(0);

    if (source !== null) {
      // The sentinel stages a cacheinfo entry pointing at an object that does
      // NOT exist, so `git cat-file -s :<path>` fails — an index entry the
      // scanner cannot read. That is the only way to reach the unreadable
      // branch now that the read goes through the object store.
      let sha = "0000000000000000000000000000000000000001";
      if (source !== UNREADABLE) {
        const blob = await git(["hash-object", "-w", "--stdin"], source);
        expect(blob.status, "could not write the probe blob").toBe(0);
        sha = blob.stdout.trim();
      }
      expect(
        (await git(["update-index", "--add", "--cacheinfo", `100644,${sha},${STAGED_AS}`])).status,
        "could not stage the probe into the scratch index",
      ).toBe(0);
    }

    const r = await spawnAsync("pnpm", ["exec", "tsx", SCRIPT, "--staged", ...args], { cwd: APP, env, shell: true, timeout: 180_000 });
    return { out: `${r.stdout}${r.stderr}`, code: r.status };
  } finally {
    spawnSync("node", ["-e", `require("fs").rmSync(${JSON.stringify(indexFile)},{force:true})`]);
  }
}

const VIOLATION = `export const NOT_A_REAL_KEY = "${FAKE_KEY}";\n`;
const BENIGN = `export const GREETING = "hello";\n`;
/**
 * Sentinel: stage an index entry whose blob is missing from the object store.
 *
 * ⚠ PLAIN ASCII on purpose. The sentinel started as a U+0000-prefixed string and
 * CI went red on `tests/repo/source-files-are-text.test.ts`: the escape reached
 * disk as a RAW control byte, which makes the whole file read as binary, and
 * every text-scanning lint then skips it in silence. That guard's own sibling
 * test ("the escape produces the identical runtime string a raw NUL would")
 * exists because a previous session hit this from the other direction. The
 * sentinel is only ever compared by identity below, so it never needed to be
 * exotic — and describing the byte in a comment reintroduced it once, so this
 * text names the code point instead of spelling it.
 */
const UNREADABLE = "UNREADABLE_SENTINEL_no_blob_in_the_object_store";

describe("scan-secrets --staged actually scans", () => {
  it("BREAKS: it catches a staged key under the REAL hook env (valid GIT_DIR)", async () => {
    const { out, code } = await runStaged(VIOLATION, { GIT_DIR: gitDirOf() });

    // Exit code alone is not proof — a parse or config error is non-zero too.
    expect(out, "the rule was not named, so this could be an unrelated crash").toContain(RULE);
    expect(code, "a staged secret must not exit 0").not.toBe(0);
    expect(out).not.toMatch(PASS_LINE);
  }, 200_000);

  it("catches the same key in a clean env — the control the old suite had", async () => {
    const { out, code } = await runStaged(VIOLATION);
    expect(out).toContain(RULE);
    expect(code).not.toBe(0);
  }, 200_000);

  it("a BENIGN staged file passes and reports one file scanned, in both envs", async () => {
    // The ALLOW half. Without it, a scanner that rejected everything would score
    // green above, and the first false positive would get it switched off.
    //
    // ⚠ This one is an ALLOW control ONLY — do not read it as evidence the
    // scanner is working. Measured against the pre-fix script it passed anyway,
    // because the old receipt printed `targetFiles.length` (taken before the
    // skip) and so said "scanned 1 files" about a file it never opened. The
    // deny cases above are what actually detect the fail-open.
    for (const [label, env] of [["clean env", {}], ["hook env", { GIT_DIR: gitDirOf() }]] as const) {
      const { out, code } = await runStaged(BENIGN, env);
      expect(code, `a clean staged file must pass (${label})`).toBe(0);
      expect(out, `the scanner did not open the staged file (${label})`).toMatch(/scanned 1 files/);
    }
  }, 200_000);

  /**
   * A staged entry the scanner CANNOT read must fail closed in BOTH output
   * modes. Raised by Codex on PR #2363 as a P2 (`--staged --json` skipped the
   * failure path, so a machine consumer read `findings: []` as secret-free) —
   * the same defect I had found in my own re-read, and its coverage gap was
   * real: nothing exercised the unreadable branch in either mode.
   */
  it("BREAKS: an UNREADABLE staged entry exits non-zero and prints NO pass line", async () => {
    const { out, code } = await runStaged(UNREADABLE);
    expect(code, "an unread staged file must not exit 0").not.toBe(0);
    expect(out).toMatch(/could not be read from the index/);
    expect(out).toMatch(/NOT scanned, NOT a pass/);
    expect(out).not.toMatch(PASS_LINE);
  }, 200_000);

  it("BREAKS: --json reports the read failure instead of an empty findings array", async () => {
    const { out, code } = await runStaged(UNREADABLE, {}, ["--json"]);
    expect(code, "--json must not exit 0 over an unread staged file").not.toBe(0);

    // The payload has to CARRY the verdict — a machine consumer never sees the
    // exit code of a step it only parses stdout from.
    const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    expect(json.unreadable, "the unreadable list is missing from the JSON").toContain(STAGED_AS);
    expect(json.findings).toEqual([]);
    // `scanned` is what lets a consumer tell "clean" from "read nothing".
    expect(json.scanned).toBe(0);
  }, 200_000);

  it("--json on a real finding still reports it, and carries scanned", async () => {
    // The control for the pair above: the JSON shape change must not have
    // broken the ordinary reporting path.
    const { out, code } = await runStaged(VIOLATION, {}, ["--json"]);
    expect(code).not.toBe(0);
    const json = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    expect(json.findings.map((f: { rule: string }) => f.rule)).toContain(RULE);
    expect(json.scanned).toBe(1);
  }, 200_000);

  it("NOTHING STAGED does not borrow the pass line", async () => {
    // The CI shape: a checkout stages nothing, so a bare --staged run reads
    // nothing. That must not look like a clean bill of health.
    const { out, code } = await runStaged(null);
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
