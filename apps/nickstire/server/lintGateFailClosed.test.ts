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
import { readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const APP = process.cwd();
const SCRIPT = "scripts/lint-brand-voice.ts";
// The audit enumerates the whole repository. Its output can exceed Node's
// 1 MiB spawnSync default on CI, which truncated the final mode receipt.
const CHILD_MAX_BUFFER = 8 * 1024 * 1024;

function run(env: Record<string, string> = {}) {
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
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

describe("lint-brand-voice does not fail open", () => {
  it("an UNREADABLE staged diff exits non-zero and prints NO pass line", () => {
    // GIT_DIR at a path that does not exist makes every git invocation fail, which
    // is the same observable state an ENOBUFS overflow produced.
    const { out, code } = run({ GIT_DIR: "/nonexistent-git-dir-for-test" });
    expect(code, "an unread diff must not exit 0").not.toBe(0);
    expect(out).not.toMatch(PASS_LINE);
    expect(out).toMatch(/COULD NOT READ THE STAGED DIFF/);
    expect(out).toMatch(/NOT a pass/);
  }, 200_000);

  it("a normal run still passes cleanly, so the guard is not just breaking the gate", () => {
    const { out, code } = run();
    expect(code).toBe(0);
    expect(out).toMatch(PASS_LINE);
    expect(out).not.toMatch(/COULD NOT READ/);
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

  function runWithStagedViolation() {
    const indexFile = join(tmpdir(), `bv-deny-canary-${process.pid}.index`);
    // The child must NOT inherit an ambient GIT_INDEX_FILE/GIT_DIR from a hook
    // that spawned this run; every git call below is pinned to `indexFile`.
    const env = { ...process.env, GIT_INDEX_FILE: indexFile };
    const git = (args: string[], input?: string) =>
      spawnSync("git", args, { cwd: APP, env, encoding: "utf8", input, maxBuffer: CHILD_MAX_BUFFER });

    try {
      // Seed the throwaway index from HEAD so ONLY the probe differs.
      expect(git(["read-tree", "HEAD"]).status, "could not seed the scratch index").toBe(0);

      const blob = git(["hash-object", "-w", "--stdin"], SOURCE);
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
    const { out, code } = runWithStagedViolation();

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
    const fn = src.slice(src.indexOf("function scanStagedDiff"), src.indexOf("const findings: Finding[]"));
    expect(fn).toContain('"--name-only"');
    expect(fn).toContain("scopeOf(f) !== null");
    // Per-file diffs keep each read bounded regardless of total diff size.
    expect(fn).toMatch(/"diff", "--cached", "-U0", "--", file/);
  });

  it("paths reach git as argv, never interpolated into a shell string", () => {
    // A filename containing a space or a quote must not be able to change the
    // command that runs.
    expect(src).toContain('execFileSync("git", args');
    expect(src).not.toMatch(/execFileSync\(\s*`git /);
  });
});
