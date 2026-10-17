/**
 * deps-check.mjs: a broken shared node_modules is REPORTED at session start, not discovered by a failing tsc.
 *
 * 2026-10-17: a filtered pnpm add in the primary pruned vite from the shared store; every junctioned worktree's
 * nickstire tsc and vitest broke and Nour found it by hand. The check prints one line. Three states, never two
 * (empty-vs-error): OK only when every workspace was read and every direct dependency resolved; FAILED names
 * what is missing; UNKNOWN when the check could not measure. A read error never prints OK.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkDeps, findPrimary } from "./deps-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "deps-check-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const json = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v));
};
const installed = (ws, name) => json(join(ws, "node_modules", name, "package.json"), { name, version: "1.0.0" });

/** A small monorepo: root + apps/nickstire + apps/statenour + packages/lenses, everything installed. */
function fixture(name) {
  const r = join(tmp, name);
  json(join(r, "package.json"), { name: "root", devDependencies: { turbo: "2" } });
  installed(r, "turbo");
  json(join(r, "apps", "nickstire", "package.json"), { name: "nicks-tire-auto", dependencies: { react: "19" }, devDependencies: { vite: "7", "@vitejs/plugin-react": "5" } });
  for (const d of ["react", "vite", "@vitejs/plugin-react"]) installed(join(r, "apps", "nickstire"), d);
  json(join(r, "apps", "statenour", "package.json"), { name: "@statenour/web", dependencies: { "@statenour/lenses": "workspace:*" }, optionalDependencies: { fsevents: "2" } });
  installed(join(r, "apps", "statenour"), "@statenour/lenses");
  json(join(r, "packages", "lenses", "package.json"), { name: "@statenour/lenses" });
  mkdirSync(join(r, "apps", "not-a-workspace"), { recursive: true }); // a folder without package.json is skipped
  return r;
}

test("a complete tree is OK, with the counts it measured", () => {
  const r = checkDeps(fixture("complete"));
  assert.equal(r.state, "OK");
  assert.equal(r.line, "[deps] OK (4 workspaces, 5 deps)");
});

test("one missing dep is FAILED, naming the workspace and the package, with the fix", () => {
  const root = fixture("missing");
  rmSync(join(root, "apps", "nickstire", "node_modules", "vite"), { recursive: true });
  rmSync(join(root, "apps", "nickstire", "node_modules", "@vitejs"), { recursive: true });
  const r = checkDeps(root);
  assert.equal(r.state, "FAILED");
  assert.match(r.line, /^\[deps\] FAILED: apps\/nickstire missing vite, @vitejs\/plugin-react; /);
  assert.match(r.line, /run a full pnpm install --frozen-lockfile in the primary \(no --filter\) when no sibling session is mid-run/);
  assert.doesNotMatch(r.line, /\bOK\b/);
});

test("a dep resolved from an ancestor node_modules counts (node walks up), but never above the repo root", () => {
  const root = fixture("hoisted");
  rmSync(join(root, "apps", "nickstire", "node_modules", "react"), { recursive: true });
  installed(root, "react");
  assert.equal(checkDeps(root).state, "OK", "react in the root node_modules resolves for apps/nickstire");
  const outside = join(tmp, "node_modules", "vite", "package.json"); // the parent of every fixture: outside the repo
  json(outside, { name: "vite" });
  rmSync(join(root, "apps", "nickstire", "node_modules", "vite"), { recursive: true });
  assert.equal(checkDeps(root).state, "FAILED", "a package above the repo root does not count");
});

test("an unreadable package.json is UNKNOWN, never OK", () => {
  const root = fixture("unreadable");
  writeFileSync(join(root, "apps", "statenour", "package.json"), "{ not json");
  const r = checkDeps(root);
  assert.equal(r.state, "UNKNOWN");
  assert.match(r.line, /^\[deps\] UNKNOWN: .*apps\/statenour\/package\.json/);
});

test("nothing to measure is UNKNOWN, never OK (no root package.json; no node_modules at all)", () => {
  const empty = join(tmp, "empty");
  mkdirSync(empty, { recursive: true });
  assert.equal(checkDeps(empty).state, "UNKNOWN");
  const bare = fixture("bare");
  rmSync(join(bare, "node_modules"), { recursive: true });
  for (const ws of ["apps/nickstire", "apps/statenour"]) rmSync(join(bare, ws, "node_modules"), { recursive: true });
  const r = checkDeps(bare);
  assert.equal(r.state, "UNKNOWN");
  assert.match(r.line, /no node_modules/);
});

test("from a worktree, the check reads the PRIMARY checkout (the one every junction points at)", () => {
  const primary = fixture("primary");
  const wt = join(primary, ".claude", "worktrees", "agent-1");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${primary.replace(/\\/g, "/")}/.git/worktrees/agent-1\n`);
  mkdirSync(join(primary, ".git"), { recursive: true });
  assert.equal(resolve(findPrimary(wt)), resolve(primary));
  assert.equal(resolve(findPrimary(primary)), resolve(primary), "the primary resolves to itself");
});

test("the CLI exits 0 even on a failure (fail open: the line is the signal)", () => {
  const root = fixture("cli");
  rmSync(join(root, "apps", "nickstire", "node_modules", "vite"), { recursive: true });
  const r = spawnSync(process.execPath, [join(HERE, "deps-check.mjs"), root], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\[deps\] FAILED: apps\/nickstire missing vite;/);
  const bad = spawnSync(process.execPath, [join(HERE, "deps-check.mjs"), join(tmp, "does-not-exist")], { encoding: "utf8" });
  assert.equal(bad.status, 0);
  assert.match(bad.stdout, /^\[deps\] UNKNOWN: /);
});

test("SessionStart runs it on startup, after every existing SessionStart hook (add, never reorder)", () => {
  const groups = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8")).hooks.SessionStart;
  const hits = groups.flatMap((g, i) => (g.hooks ?? []).filter((h) => /deps-check\.mjs/.test(h.command)).map((h) => ({ i, g, h })));
  assert.equal(hits.length, 1, "exactly one deps-check SessionStart hook");
  assert.equal(hits[0].g.matcher, "startup");
  assert.equal(hits[0].i, groups.length - 1, "appended as the last group");
  assert.equal(hits[0].h.command, 'node "${CLAUDE_PROJECT_DIR}/scripts/agent-os/deps-check.mjs"');
});

test("the CONFIGURED SessionStart command runs verbatim through a shell and prints one [deps] line, exit 0 (hookCommand.test.mjs pattern)", () => {
  const groups = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8")).hooks.SessionStart;
  const command = groups.flatMap((g) => g.hooks ?? []).find((h) => /deps-check\.mjs/.test(h.command))?.command;
  assert.ok(command, "no deps-check SessionStart hook configured");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /^\[deps\] (OK \(\d+ workspaces, \d+ deps\)|FAILED: .+|UNKNOWN: .+)\n$/, `one [deps] line expected, got:\n${r.stdout}${r.stderr}`);
});
