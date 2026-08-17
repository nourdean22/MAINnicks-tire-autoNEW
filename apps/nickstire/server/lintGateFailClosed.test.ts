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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APP = process.cwd();
const SCRIPT = "scripts/lint-brand-voice.ts";

function run(env: Record<string, string> = {}) {
  const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
    cwd: APP,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: true,
    timeout: 180_000,
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
      cwd: APP, encoding: "utf8", shell: true, timeout: 180_000,
    });
    expect(`${r.stdout ?? ""}`).toMatch(/Mode: AUDIT/);
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
