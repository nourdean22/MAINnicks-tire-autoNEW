// Canary for scripts/agent-os/bootstrap-machine.mjs (job 2026-10-26-always-on-hardening): one command puts the
// machine-local half of the always-on stance on a new machine or account, --check only reports, and the SessionStart
// "[health] machine" line names what is missing with the exact fix, including each required plugin this account has
// not enabled. Every run is the REAL script as a child process against a fixture home (--home); the settings arm runs
// the CONFIGURED SessionStart command verbatim through a shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "bootstrap-machine.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const REQUIRED = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "required-plugins.json"), "utf8")).required;
const SCRATCH = mkdtempSync(join(tmpdir(), "bootstrap-test-"));

const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const env = (home) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))), CLAUDE_PROJECT_DIR: ROOT, HOME: home, USERPROFILE: home });
const run = (home, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--home", home, ...args], { encoding: "utf8", cwd: ROOT, env: env(home), timeout: 30000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
function files(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : out.push(relative(dir, join(d, e.name)).replaceAll("\\", "/")); };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** A home that already has unrelated settings, an unrelated hook and an unrelated user skill: none may change. */
function makeHome(label) {
  const home = join(SCRATCH, label);
  write(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", enabledPlugins: { "x@y": true },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "rtk hook claude" }] }] } }, null, 2));
  write(join(home, ".claude", "skills", "mine", "SKILL.md"), "---\nname: mine\ndescription: unrelated\n---\n");
  write(join(home, ".claude", "CLAUDE.md"), "# my rules\n\nkeep this line\n");
  return home;
}

/** Enable every required plugin in the fixture the way the harness records it. */
function enableRequired(home) {
  const installed = { version: 2, plugins: {} };
  const enabled = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  for (const p of REQUIRED) {
    if (p.source === "installed") {
      const dir = join(home, ".claude", "plugins", "cache", "m", p.name, "1.0.0");
      write(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: p.name }));
      installed.plugins[p.key] = [{ scope: "user", installPath: dir }];
      enabled.enabledPlugins[p.key] = true;
    } else {
      const dir = join(home, ".claude", "plugins", "synced", "org_acct", `${p.name}~g2`);
      write(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: p.name }));
      write(join(dir, ".in_use"), "");
    }
  }
  write(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify(installed));
  write(join(home, ".claude", "settings.json"), JSON.stringify(enabled, null, 2));
  write(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "acct", organizationUuid: "org" } }));
}

test("--check on a bare home reports every missing item, changes nothing, exits 1", () => {
  const home = makeHome("check-bare");
  const before = files(home);
  const r = run(home, "--check");
  assert.equal(r.code, 1, r.out);
  for (const item of ["always-on-skills.mjs", "find-skills-turn.mjs", "SessionStart", "UserPromptSubmit", "CLAUDE.md", "karpathy-guidelines", "prompt-gallery"]) {
    assert.match(r.out, new RegExp(`MISSING[^\\n]*${item.replace(".", "\\.")}`), `no MISSING line for ${item}:\n${r.out}`);
  }
  assert.deepEqual(files(home), before, "--check wrote a file");
});

test("apply installs each item with a receipt; a second run changes nothing; --check is then clean", () => {
  const home = makeHome("apply");
  const r1 = run(home);
  assert.equal(r1.code, 0, r1.out);
  assert.match(r1.out, /installed .*always-on-skills\.mjs/);
  assert.equal(readFileSync(join(home, ".claude", "hooks", "always-on-skills.mjs"), "utf8"), readFileSync(join(HERE, "always-on-skills.mjs"), "utf8"));
  assert.equal(readFileSync(join(home, ".claude", "skills", "prompt-gallery", "SKILL.md"), "utf8"),
    readFileSync(join(ROOT, ".claude", "skills", "prompt-gallery", "SKILL.md"), "utf8"));
  const snapshot = files(home).map((f) => [f, statSync(join(home, f)).mtimeMs]);
  const r2 = run(home);
  assert.equal(r2.code, 0, r2.out);
  assert.doesNotMatch(r2.out, /installed|updated/, `second run changed something:\n${r2.out}`);
  assert.deepEqual(files(home).map((f) => [f, statSync(join(home, f)).mtimeMs]), snapshot);
  assert.equal(run(home, "--check").code, 0);
});

test("apply touches nothing else: unrelated settings, hooks, skills and CLAUDE.md lines survive", () => {
  const home = makeHome("preserve");
  run(home);
  const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(s.model, "opus");
  assert.deepEqual(s.enabledPlugins, { "x@y": true });
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, "rtk hook claude");
  assert.equal(s.hooks.SessionStart.filter((g) => JSON.stringify(g).includes("always-on-skills.mjs")).length, 1);
  assert.match(readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8"), /^# my rules\n\nkeep this line\n/);
  assert.ok(existsSync(join(home, ".claude", "skills", "mine", "SKILL.md")));
  const unexpected = files(home).filter((f) => !/^\.claude\/(settings\.json|CLAUDE\.md|hooks\/|skills\/|bootstrap-backup\/)/.test(f));
  assert.deepEqual(unexpected, []);
});

test("a drifted machine hook reads DRIFT in --check and is restored by apply", () => {
  const home = makeHome("drift");
  run(home);
  write(join(home, ".claude", "hooks", "always-on-skills.mjs"), "// edited by hand\n");
  const c = run(home, "--check");
  assert.equal(c.code, 1);
  assert.match(c.out, /DRIFT[^\n]*always-on-skills\.mjs/);
  assert.match(run(home).out, /updated .*always-on-skills\.mjs/);
});

test("health line on a bare home: [health] machine with FIX FIRST naming the bootstrap and each required plugin", () => {
  const r = run(makeHome("health-bare"), "--check", "--hook");
  assert.equal(r.code, 0, "a SessionStart hook exits 0");
  const lines = r.out.trim().split(/\r?\n/);
  assert.equal(lines.length, 1, r.out);
  assert.match(lines[0], /^\[health\] machine /);
  assert.match(lines[0], /FIX FIRST: \(1\) node [^|]*bootstrap-machine\.mjs/);
  for (const p of REQUIRED) assert.ok(lines[0].includes(p.enable), `no enable line for ${p.name}`);
});

test("health line when everything is in place: ok, no FIX FIRST", () => {
  const home = makeHome("health-ok");
  run(home);
  enableRequired(home);
  const r = run(home, "--check", "--hook");
  assert.match(r.out.trim(), /^\[health\] machine ok/);
  assert.doesNotMatch(r.out, /FIX FIRST/);
});

test("one required plugin missing: only that one is named", () => {
  const home = makeHome("health-one");
  run(home);
  enableRequired(home);
  const p = REQUIRED.find((x) => x.source === "installed");
  const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  s.enabledPlugins[p.key] = false;
  write(join(home, ".claude", "settings.json"), JSON.stringify(s));
  const r = run(home, "--check", "--hook");
  assert.match(r.out, /FIX FIRST/);
  assert.ok(r.out.includes(p.enable));
  assert.equal(REQUIRED.filter((x) => r.out.includes(x.enable)).length, 1, r.out);
});

test("settings: the configured SessionStart startup command runs verbatim and prints one [health] machine line", () => {
  const cmdHook = (SETTINGS.hooks?.SessionStart ?? []).flatMap((g) => g.hooks ?? []).find((h) => h.command?.includes("bootstrap-machine.mjs"));
  assert.ok(cmdHook, "bootstrap-machine.mjs --check --hook is not registered on SessionStart");
  const home = makeHome("configured");
  const cmd = process.platform === "win32" ? cmdHook.command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : cmdHook.command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ source: "startup" }), encoding: "utf8", cwd: ROOT, env: env(home), timeout: 30000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\[health\] machine /);
});

test("the shell wrappers exist and call the node script with their arguments", () => {
  assert.match(readFileSync(join(HERE, "bootstrap-machine.ps1"), "utf8"), /bootstrap-machine\.mjs/);
  assert.match(readFileSync(join(HERE, "bootstrap-machine.sh"), "utf8"), /bootstrap-machine\.mjs" "\$@"/);
});
