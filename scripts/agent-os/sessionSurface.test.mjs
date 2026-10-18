// Canary for session-surface.mjs, the SessionStart hook that prints one [surface] line: hook events, MCP servers,
// plugins and PATH tools. Each segment is read independently and a failed read renders UNKNOWN, never a zero or ok
// (empty-vs-error). Controls run the REAL script against a fixture home (--home) and a fixture project dir, and the
// wiring test runs the CONFIGURED command string verbatim.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "session-surface.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "session-surface-test-"));
const WIN = process.platform === "win32";

/** A fixture home (2 hook events, 2 user MCP servers, 2 of 3 plugins on) and a project (3 hook events, 1 local server). */
function fixture(label, { claudeJson = true } = {}) {
  const home = join(SCRATCH, label, "home");
  const project = join(SCRATCH, label, "project");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({
    hooks: { SessionStart: [], Stop: [] },
    enabledPlugins: { "a@m": true, "b@m": false, "c@m": true },
  }));
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [], UserPromptSubmit: [], Stop: [] } }));
  if (claudeJson) {
    writeFileSync(join(home, ".claude.json"), JSON.stringify({
      mcpServers: { alpha: { command: "x" }, beta: { command: "y" } },
      projects: { [project.replace(/\\/g, "/")]: { mcpServers: { gamma: {} } } },
    }));
  }
  return { home, project };
}

/** A PATH holding only an empty dir, or a dir with a fake `rtk` (never executed: presence is a lookup). */
function pathDir(label, withRtk) {
  const dir = join(SCRATCH, `path-${label}`);
  mkdirSync(dir, { recursive: true });
  if (withRtk) {
    const f = join(dir, WIN ? "rtk.cmd" : "rtk");
    writeFileSync(f, WIN ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n");
    if (!WIN) chmodSync(f, 0o755);
  }
  return dir;
}

function run({ home, project }, { pathEnv, script = SCRIPT } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: project };
  if (pathEnv !== undefined) {
    for (const k of Object.keys(env)) if (k.toUpperCase() === "PATH") delete env[k];
    env.PATH = pathEnv;
  }
  const r = spawnSync(process.execPath, [script, "--home", home], { encoding: "utf8", cwd: project, env, timeout: 20000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const oneLine = (r) => {
  assert.equal(r.code, 0, r.err);
  const got = r.out.split(/\r?\n/).filter(Boolean);
  assert.equal(got.length, 1, `expected one line, got:\n${r.out}`);
  assert.match(got[0], /^\[surface\] /);
  assert.ok(got[0].length <= 300, `line is ${got[0].length} chars`);
  return got[0];
};

test("full fixture: one line with hooks, mcp, plugins and path segments, counted right", () => {
  const line = oneLine(run(fixture("full")));
  assert.match(line, /hooks: 2\+3 events/);
  assert.match(line, /mcp: [^|]*alpha, beta/);
  assert.match(line, /mcp: [^|]*gamma/);
  assert.match(line, /connectors: not readable here/);
  assert.match(line, /plugins: 2 enabled/);
  assert.match(line, /path: rtk (ok|MISSING), uv (ok|MISSING), gh (ok|MISSING), railway (ok|MISSING)/);
});

test(".claude.json missing: the mcp segment reads UNKNOWN (reason), the other segments still render, exit 0", () => {
  const line = oneLine(run(fixture("no-claude-json", { claudeJson: false })));
  assert.match(line, /mcp: UNKNOWN \([^)]+\)/);
  assert.doesNotMatch(line, /mcp: [^|]*(user|local) none/, "a failed read must not render as none");
  assert.match(line, /hooks: 2\+3 events/);
  assert.match(line, /plugins: 2 enabled/);
});

test("broken user settings.json: hooks and plugins read UNKNOWN for that side only; mcp still renders", () => {
  const f = fixture("broken-settings");
  writeFileSync(join(f.home, ".claude", "settings.json"), "{ nope");
  const line = oneLine(run(f));
  assert.match(line, /hooks: UNKNOWN \([^)]+\)\+3 events/);
  assert.match(line, /plugins: UNKNOWN \([^)]+\)/);
  assert.match(line, /mcp: [^|]*alpha, beta/);
});

test("PATH without rtk: the path segment names rtk MISSING", () => {
  const line = oneLine(run(fixture("no-rtk"), { pathEnv: pathDir("empty", false) }));
  assert.match(line, /rtk MISSING/);
});

test("PATH with a fake rtk: the path segment names rtk ok (positive control for the lookup)", () => {
  const line = oneLine(run(fixture("with-rtk"), { pathEnv: pathDir("rtk", true) }));
  assert.match(line, /rtk ok/);
});

function configured() {
  const group = (SETTINGS.hooks?.SessionStart ?? []).find((g) => !g.matcher || g.matcher === "*");
  const hooks = group?.hooks ?? [];
  return { hooks, at: hooks.findIndex((h) => h.command?.includes("session-surface.mjs")), lease: hooks.findIndex((h) => h.command?.includes("session-lease-status.mjs")) };
}

test("settings: the SessionStart all-sources group runs session-surface right after session-lease-status, forward slashes", () => {
  const { hooks, at, lease } = configured();
  assert.ok(at >= 0, "session-surface.mjs is not registered in the SessionStart all-sources group");
  assert.equal(at, lease + 1);
  assert.match(hooks[at].command, /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/session-surface\.mjs"$/);
});

test("the CONFIGURED command runs verbatim through a shell and prints one [surface] line, exit 0", () => {
  const { hooks, at } = configured();
  assert.ok(at >= 0, "session-surface.mjs is not registered");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  const cmd = WIN ? hooks[at].command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : hooks[at].command;
  const r = spawnSync(cmd, { shell: WIN ? true : "/bin/sh", input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[surface\] hooks: .+ \| mcp: .+ \| plugins: .+ \| path: .+$/m);
});

test("MUTANT no-op lookup: a presence check that always succeeds is caught by the MISSING control", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const anchor = 'if (r.status === 0) return { state: "ok" };';
  assert.ok(src.includes(anchor), "mutation anchor not found");
  const file = join(SCRATCH, "noop-lookup.mjs");
  writeFileSync(file, src.replace(anchor, 'return { state: "ok" };'));
  const line = oneLine(run(fixture("mutant"), { pathEnv: pathDir("empty-m", false), script: file }));
  assert.doesNotMatch(line, /rtk MISSING/, "the mutant should claim rtk ok, proving the MISSING control can fail");
  rmSync(file);
});

// Linux CI (2026-10-18, PR #3150): /bin/sh on the runner is dash, whose `command -v <missing>` exits 127 (bash exits
// 1, where.exe /q exits 1). A lookup that RAN and found nothing is MISSING on every platform; only a spawn error, a
// signal (timeout) or another exit code is UNKNOWN. Pinned on the classifier because Windows cannot run dash.
test("classifyLookup: 0 ok, 1 and 127 MISSING, any other exit, spawn error or signal UNKNOWN with a reason", async () => {
  const { classifyLookup } = await import("./session-surface.mjs");
  const enoent = Object.assign(new Error("spawn /bin/sh ENOENT"), { code: "ENOENT" });
  const cases = [
    [{ status: 0, signal: null }, "ok"],
    [{ status: 1, signal: null }, "MISSING"],
    [{ status: 127, signal: null }, "MISSING"],
    [{ status: 2, signal: null }, "UNKNOWN"],
    [{ status: null, signal: null, error: enoent }, "UNKNOWN"],
    [{ status: null, signal: "SIGTERM" }, "UNKNOWN"],
  ];
  for (const [input, want] of cases) {
    const got = classifyLookup(input);
    assert.equal(got.state, want, `${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
    if (want === "UNKNOWN") assert.match(got.reason, /lookup (exit 2|ENOENT|killed by SIGTERM)/, "UNKNOWN must say which");
  }
});
