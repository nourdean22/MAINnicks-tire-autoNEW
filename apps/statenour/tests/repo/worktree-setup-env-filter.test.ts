/**
 * tests/repo/worktree-setup-env-filter.test.ts · 2026-09-15
 *
 * scripts/worktree-setup.ps1 copies env files into a new worktree. Its old
 * glob had two defects, both observed the day this landed:
 *
 *   1. It copied git-TRACKED files. `.env.example` is checked in, so a
 *      worktree created from origin/main opened with the primary checkout's
 *      older copy written over the branch's version -- apps/nickstire/.env.example
 *      lost 29 lines (#2246's "Optical finish" block). It reads as a modified
 *      file nobody edited and is committable by accident.
 *
 *   2. Its path filter tested `-notmatch "\.worktrees"`, which does NOT match
 *      `.claude\worktrees\...` -- that segment is `worktrees`, no leading dot.
 *      Setup walked every sibling harness worktree: of 39 files selected, 34
 *      came from siblings (including another session's live `.env`) and 36
 *      were tracked templates, to deliver the 3 real local secrets.
 *
 * BEHAVIOUR, not presence: this drives the real scripts/worktree-env-files.ps1
 * against a throwaway git repo and asserts WHICH files come back. It never
 * creates a worktree and never junctions node_modules, so it is safe to run
 * while sibling sessions are live.
 *
 * The third assertion is the one that stops a vacuous pass: a filter that
 * excluded EVERYTHING would satisfy "the template is not copied" while
 * breaking the script's entire purpose, so the real secret must still be
 * selected.
 *
 * Windows-only -- worktree-setup.ps1 is a Windows artifact (it junctions with
 * mklink /j) and this invokes powershell.exe. Skipped elsewhere with a named
 * skip so the skip stays visible, matching tests/repo/brain-archive-wrapper.test.ts.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const isWindows = process.platform === "win32";
const selectorScript = path.join(__dirname, "..", "..", "..", "..", "scripts", "worktree-env-files.ps1");

/** A throwaway git repo carrying one of every case the filter must decide. */
function buildFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-env-filter-"));
  const write = (rel: string, body: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  write("apps/app1/.env.example", "# checked-in template\nFOO=example\n");
  write(".env", "SECRET=real\n");
  write("camera/.env.local", "SECRET=local\n");
  write(".claude/worktrees/sibling/.env", "SECRET=another-session\n");
  write("node_modules/some-pkg/.env", "SECRET=vendored\n");

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "canary@example.com");
  git("config", "user.name", "canary");
  // ONLY the template is tracked; everything else stays untracked.
  git("add", "--", "apps/app1/.env.example");
  git("commit", "-qm", "fixture: track the env template");
  return root;
}

function selectEnvFiles(root: string): string[] {
  const stdout = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", selectorScript, "-SourceRoot", root],
    { encoding: "utf8" },
  );
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => path.relative(fs.realpathSync(root), fs.realpathSync(line)).replace(/\\/g, "/"));
}

describe.skipIf(!isWindows)("worktree-setup env-file selection", () => {
  it("the fixture really does stage the bug: the template matches .env* AND is tracked", () => {
    const root = buildFixture();
    try {
      const tracked = execFileSync("git", ["-C", root, "ls-files"], { encoding: "utf8" })
        .split(/\r?\n/)
        .filter(Boolean);
      // Without this, a fixture that silently stopped tracking the template
      // would make every assertion below pass for the wrong reason.
      expect(tracked).toContain("apps/app1/.env.example");
      expect(path.basename("apps/app1/.env.example").startsWith(".env")).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects the real local secrets, and never a tracked template or a sibling worktree", () => {
    const root = buildFixture();
    try {
      const selected = selectEnvFiles(root);

      // The script's whole purpose: real secrets DO get copied. A filter that
      // excluded everything would pass the negative assertions below.
      expect(selected).toContain(".env");
      expect(selected).toContain("camera/.env.local");

      // Defect 1: a git-tracked template must never be overwritten.
      expect(selected).not.toContain("apps/app1/.env.example");

      // Defect 2: sibling worktrees must not be walked at all.
      expect(selected).not.toContain(".claude/worktrees/sibling/.env");

      // Pre-existing exclusion that must survive the refactor.
      expect(selected).not.toContain("node_modules/some-pkg/.env");

      expect(selected.sort()).toEqual([".env", "camera/.env.local"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("worktree-setup.ps1 delegates to the selector rather than re-globbing", () => {
    // Wiring tripwire: source-level, and weaker than the assertions above --
    // driving the real setup script would require creating a worktree and
    // junctioning node_modules, which is unsafe while sibling sessions run.
    // It still fails if someone reinstates an inline Get-ChildItem glob.
    const setup = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "..", "scripts", "worktree-setup.ps1"),
      "utf8",
    );
    expect(setup).toContain("worktree-env-files.ps1");
    expect(setup).not.toMatch(/Get-ChildItem[^\n]*-Filter\s+"\.env\*"/);
  });
});
