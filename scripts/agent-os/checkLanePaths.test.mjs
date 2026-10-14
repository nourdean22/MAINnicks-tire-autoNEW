// Canary + parity for check-lane-paths.mjs. Every exit code is driven through the REAL CLI in a
// throwaway git repo; GIT_* is stripped first (guard-red-team rule 6) so a hook-inherited
// GIT_DIR can never point the fixture at the shared .git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_DIR, offendingPaths, readOwnedPaths } from "./check-lane-paths.mjs";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-lane-paths.mjs");
const ENV = stripGitLocalEnv(process.env);

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: ENV,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function put(dir, rel, body = "x\n") {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

/** Fresh repo: one base commit on `main`, then checked out on branch `lane`. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "lane-paths-"));
  git(dir, "init", "-q", "-b", "main");
  put(dir, "README.md");
  put(dir, "apps/nickstire/server/old.ts");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "lane");
  return dir;
}

function commitAll(dir, msg = "c") {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", msg);
}

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: ENV, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("CANARY: a planted out-of-lane file fails with exit 1 and names exactly that path", () => {
  const dir = fixture();
  put(dir, "apps/statenour/lib/ok.ts");
  put(dir, "apps/nickstire/server/planted.ts");
  commitAll(dir);
  const r = run(dir, "--lane", "statenour", "--base", "main", "--head", "HEAD");
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /OUT-OF-LANE apps\/nickstire\/server\/planted\.ts/);
  assert.doesNotMatch(r.err, /apps\/statenour\/lib\/ok\.ts/);
  assert.match(r.err, /1 of 2 changed path/);
});

test("CONTROL: an in-lane-only diff passes with exit 0 and counted the path (not an empty diff)", () => {
  const dir = fixture();
  put(dir, "apps/statenour/lib/ok.ts");
  commitAll(dir);
  const r = run(dir, "--lane", "statenour", "--base", "main", "--head", "HEAD");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /OK lane statenour: 1 changed path\(s\)/);
});

test("EMPTY: a committed diff with zero changed paths exits 2 and never reads as OK", () => {
  const dir = fixture();
  const r = run(dir, "--lane", "statenour", "--base", "main", "--head", "HEAD");
  assert.equal(r.code, 2, `${r.out}${r.err}`);
  assert.match(r.err, /EMPTY lane statenour: 0 changed path\(s\) \(main\.\.\.HEAD\), nothing verified/);
  assert.doesNotMatch(r.out, /OK lane/);
});

test("EMPTY: a working-tree check with nothing changed exits 2 and never reads as OK", () => {
  const dir = fixture();
  const r = run(dir, "--lane", "statenour", "--base", "main");
  assert.equal(r.code, 2, `${r.out}${r.err}`);
  assert.match(r.err, /EMPTY lane statenour: 0 changed path\(s\) \(main\.\.\.working tree\), nothing verified/);
  assert.doesNotMatch(r.out, /OK lane/);
});

test("unknown lane, invalid lane name, missing args and a bad ref each exit 2 (never 0 or 1)", () => {
  const dir = fixture();
  put(dir, "apps/nickstire/server/planted.ts");
  commitAll(dir);
  assert.equal(run(dir, "--lane", "nope", "--base", "main").code, 2);
  assert.equal(run(dir, "--lane", "../agents/lane-platform", "--base", "main").code, 2);
  assert.equal(run(dir, "--lane", "statenour").code, 2);
  const bad = run(dir, "--lane", "statenour", "--base", "no-such-ref", "--head", "HEAD");
  assert.equal(bad.code, 2);
  assert.match(bad.err, /ERROR git/);
});

test("no --head: uncommitted AND untracked out-of-lane edits are caught", () => {
  const dir = fixture();
  put(dir, "apps/statenour/lib/ok.ts");
  commitAll(dir);
  put(dir, "README.md", "edited\n"); // tracked, uncommitted
  put(dir, "apps/worker/new.ts"); // untracked
  const r = run(dir, "--lane", "statenour", "--base", "main");
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /OUT-OF-LANE README\.md/);
  assert.match(r.err, /OUT-OF-LANE apps\/worker\/new\.ts/);
});

test("a rename out of another lane names the source path", () => {
  const dir = fixture();
  mkdirSync(join(dir, "apps/statenour"), { recursive: true });
  renameSync(join(dir, "apps/nickstire/server/old.ts"), join(dir, "apps/statenour/old.ts"));
  commitAll(dir);
  const r = run(dir, "--lane", "statenour", "--base", "main", "--head", "HEAD");
  assert.equal(r.code, 1);
  assert.match(r.err, /OUT-OF-LANE apps\/nickstire\/server\/old\.ts/);
});

test("base moving ahead after the fork adds nothing to the lane's diff (merge-base range)", () => {
  const dir = fixture();
  put(dir, "apps/statenour/lib/ok.ts");
  commitAll(dir);
  git(dir, "checkout", "-q", "main");
  put(dir, "apps/nickstire/server/sibling.ts");
  commitAll(dir);
  git(dir, "checkout", "-q", "lane");
  assert.equal(run(dir, "--lane", "statenour", "--base", "main", "--head", "lane").code, 0);
});

test("research owns nothing: any diff fails", () => {
  const dir = fixture();
  put(dir, "docs/notes.md");
  commitAll(dir);
  assert.equal(run(dir, "--lane", "research", "--base", "main", "--head", "HEAD").code, 1);
});

test("research owns nothing, so an EMPTY diff is its clean read-only answer (exit 0, not 2)", () => {
  const dir = fixture();
  const r = run(dir, "--lane", "research", "--base", "main", "--head", "HEAD");
  assert.equal(r.code, 0, `${r.out}${r.err}`);
  assert.match(r.out, /OK lane research: 0 changed path\(s\), all owned/);
});

test("glob matcher: no prefix bleed, ** spans dirs, root files are exact", () => {
  const globs = ["apps/statenour/**", "package.json", "docs/agent-os/**"];
  assert.deepEqual(
    offendingPaths(
      ["apps/statenour/a/b/c.ts", "apps/statenourX/a.ts", "apps/statenour", "package.json", "apps/x/package.json",
        "docs/agent-os/x.md", "docs/agent-osX.md", ".claude/x", "package.json.bak"],
      globs,
    ),
    ["apps/statenourX/a.ts", "apps/statenour", "apps/x/package.json", "docs/agent-osX.md", ".claude/x", "package.json.bak"],
  );
});

test("platform lane owns .devcontainer, .cursor and .vscode, and a sibling name does not bleed in", () => {
  const platform = readOwnedPaths("platform");
  assert.deepEqual(
    offendingPaths([".devcontainer/devcontainer.json", ".cursor/rules/example.mdc", ".vscode/settings.json"], platform),
    [],
  );
  assert.deepEqual(offendingPaths([".vscode-extra/x.json", ".cursorrc"], platform), [".vscode-extra/x.json", ".cursorrc"]);
});

// ── Parity: frontmatter is the machine source; the prose line must agree with it ──────────────
const laneFiles = readdirSync(AGENTS_DIR).filter((f) => /^lane-.+\.md$/.test(f));

test("parity: lane files exist", () => assert.ok(laneFiles.length >= 6, `found ${laneFiles.length}`));

for (const f of laneFiles) {
  const lane = f.slice("lane-".length, -".md".length);
  const text = readFileSync(join(AGENTS_DIR, f), "utf8");

  test(`parity ${lane}: script reads exactly the frontmatter list`, () => {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1].split(/\r?\n/);
    assert.equal(fm.filter((l) => l.startsWith("ownedPaths:")).length, 1, "exactly one ownedPaths key");
    const start = fm.findIndex((l) => l.startsWith("ownedPaths:"));
    // Independent read: every indented list line after the key, quoted or not, so an unquoted
    // item the script would silently drop makes this unequal.
    const items = [];
    for (const l of fm.slice(start + 1)) {
      if (!/^\s+-/.test(l)) break;
      items.push(l.replace(/^\s+-\s+/, "").replace(/^"|"$/g, "").trim());
    }
    assert.deepEqual(readOwnedPaths(lane), items);
  });

  test(`parity ${lane}: prose "Owned paths" agrees with frontmatter`, () => {
    const globs = readOwnedPaths(lane);
    const section = /## Owned paths[^\n]*\n([\s\S]*?)\n## /.exec(text);
    if (!section) {
      assert.deepEqual(globs, [], `${f} has no Owned paths section, so it must own nothing`);
      assert.match(text, /never edits files/i);
      return;
    }
    // Owned sentences only: from the sentence that sends things to "Cross-lane needs" on, the
    // backticked paths are what the lane does NOT own.
    const sentences = section[1].split(/\.\s+/);
    const cut = sentences.findIndex((s) => /Cross-lane/.test(s));
    const owned = (cut === -1 ? sentences : sentences.slice(0, cut)).join(". ");
    const prose = [...owned.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(prose.length > 0, "prose names at least one path");
    for (const p of prose) assert.ok(globs.includes(p), `prose path ${p} missing from ownedPaths`);
    // Extras beyond the prose may only be explicit root files, never a directory grant.
    for (const g of globs.filter((x) => !prose.includes(x))) assert.ok(!g.includes("/") && !g.includes("*"), `unlisted grant ${g}`);
  });
}
