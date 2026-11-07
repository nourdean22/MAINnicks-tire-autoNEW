// Canary for scripts/agent-os/bootstrap-machine.mjs (job 2026-10-26-always-on-hardening): one command puts the
// machine-local half of the always-on stance on a new machine or account, --check only reports, and the SessionStart
// "[health] machine" line names what is missing with the exact fix, including each required plugin this account has
// not enabled. Every run is the REAL script as a child process against a fixture home (--home); the settings arm runs
// the CONFIGURED SessionStart command verbatim through a shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILLS } from "./always-on-skills.mjs";

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

/** The always-on skills that used to be machine-only; both now have a repo copy in .claude/skills (job 2026-11-03-vendor-always-on-skills). */
const VENDORED_PAIR = ["find-skills", "steal-like-an-artist"];

/** A throwaway repo holding only what bootstrap-machine.mjs reads, with NO .claude/skills: every always-on skill is "no repo copy". */
function bareRepoScript(label) {
  const repo = join(SCRATCH, label);
  for (const f of ["bootstrap-machine.mjs", "always-on-skills.mjs", "plugin-index.mjs", "find-skills-turn.mjs", "session-surface.mjs"]) write(join(repo, "scripts", "agent-os", f), readFileSync(join(HERE, f)));
  for (const f of ["global-claude-md-block.md", "local-services.json", "user-layer.json", "RTK.md"]) write(join(repo, "config", "agent-os", f), readFileSync(join(ROOT, "config", "agent-os", f)));
  // Every other file the layer installs (the output style, 2026-11-06), so the fixture repo stays installable.
  for (const x of JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "user-layer.json"), "utf8")).files ?? []) write(join(repo, x.src), readFileSync(join(ROOT, x.src)));
  mkdirSync(join(repo, ".claude", "skills"), { recursive: true });
  return { repo, script: join(repo, "scripts", "agent-os", "bootstrap-machine.mjs") };
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
  // Merge: apply may already have written mcpServers.graphify here (2026-11-03); the harness itself keeps every key.
  const cj = existsSync(join(home, ".claude.json")) ? JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")) : {};
  write(join(home, ".claude.json"), JSON.stringify({ ...cj, oauthAccount: { accountUuid: "acct", organizationUuid: "org" } }));
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
  for (const s of VENDORED_PAIR) {
    assert.match(r1.out, new RegExp(`installed +~/\\.claude/skills/${s}\\n`), `${s} was not installed from the repo copy:\n${r1.out}`);
    assert.ok(readFileSync(join(home, ".claude", "skills", s, "SKILL.md")).equals(readFileSync(join(ROOT, ".claude", "skills", s, "SKILL.md"))), `${s}/SKILL.md differs from the repo copy`);
  }
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

test("an existing machine SKILL.md keeps its own description; everything else (the triggers line) comes from the repo", () => {
  const home = makeHome("keep-desc");
  const file = join(home, ".claude", "skills", "prompt-gallery", "SKILL.md");
  const machineDesc = "description: Always on (machine wording). On EVERY operator request, check the gallery.";
  write(file, `---\nname: prompt-gallery\n${machineDesc}\n---\n\n# machine body\n`);
  assert.equal(run(home).code, 0);
  const after = readFileSync(file, "utf8");
  const repo = readFileSync(join(ROOT, ".claude", "skills", "prompt-gallery", "SKILL.md"), "utf8");
  assert.ok(after.includes(`${machineDesc}\n`), `machine description lost:\n${after.slice(0, 400)}`);
  assert.match(after, /^triggers: /m, "the repo triggers line must be added");
  assert.equal(after.replace(machineDesc, ""), repo.replace(/^description:.*$/m, ""), "everything but the description must equal the repo copy");
  assert.equal(run(home, "--check").code, 0, "a kept description must read ok, not DRIFT forever");
});

test("find-skills and steal-like-an-artist have a repo copy: a bare home reads MISSING (installable), apply installs the whole folder byte-for-byte, then --check is clean", () => {
  const home = makeHome("vendored-pair");
  const c = run(home, "--check");
  for (const s of VENDORED_PAIR) assert.match(c.out, new RegExp(`MISSING +~/\\.claude/skills/${s}\\n`), `${s} is not installable from the repo:\n${c.out}`);
  assert.doesNotMatch(c.out, /no repo copy/, c.out);
  const a = run(home);
  assert.equal(a.code, 0, a.out);
  assert.doesNotMatch(a.out, /no repo copy/, a.out);
  for (const s of VENDORED_PAIR) {
    const src = join(ROOT, ".claude", "skills", s);
    assert.match(a.out, new RegExp(`installed +~/\\.claude/skills/${s}\\n`), a.out);
    for (const f of files(src)) assert.ok(readFileSync(join(home, ".claude", "skills", s, f)).equals(readFileSync(join(src, f))), `${s}/${f} differs from the repo copy`);
  }
  assert.equal(run(home, "--check").code, 0, "a second --check must be clean");
});

/** Always-on names with no SKILL.md under skillsDir. On NATTYNOUR the machine copy hides the gap, so this runs on the repo alone. */
const withoutRepoCopy = (names, skillsDir) => names.filter((n) => !existsSync(join(skillsDir, n, "SKILL.md")));

test("every skill the always-on hook names has a repo copy, so a fresh clone is never told to invoke a skill it lacks", () => {
  const names = SKILLS.map((s) => s.split(" ")[0]);
  assert.ok(names.length >= 8 && names.includes("find-skills"), `only ${names.length} always-on names read`);
  assert.deepEqual(withoutRepoCopy(names, join(ROOT, ".claude", "skills")), []);
  const partial = join(SCRATCH, "always-on-partial-skills");
  for (const n of names.filter((x) => x !== "steal-like-an-artist")) write(join(partial, n, "SKILL.md"), "x");
  assert.deepEqual(withoutRepoCopy(names, partial), ["steal-like-an-artist"], "the check must name a planted gap");
});

// The "no repo copy" branch (Codex 4380254390) has no real subject now that every always-on skill is vendored, so it runs
// against a throwaway repo with an empty .claude/skills: a machine without the skill reads MISSING, never ok.
test("a skill with no repo copy reads MISSING when the machine lacks it, ok when the machine has it, and apply says it cannot install it (Codex 4380254390)", () => {
  const home = makeHome("machine-only");
  const { repo, script } = bareRepoScript("bare-repo");
  const go = (...args) => {
    const r = spawnSync(process.execPath, [script, "--home", home, ...args], { encoding: "utf8", cwd: repo, env: env(home), timeout: 30000 });
    return `${r.stdout ?? ""}${r.stderr ?? ""}`;
  };
  const check = go("--check");
  for (const s of VENDORED_PAIR) assert.match(check, new RegExp(`MISSING +~/\\.claude/skills/${s} \\(no repo copy`), check);
  const apply = go();
  assert.match(apply, /MISSING[^\n]*steal-like-an-artist[^\n]*no repo copy/, apply);
  assert.doesNotMatch(apply, /installed [^\n]*steal-like-an-artist/, apply);
  for (const s of VENDORED_PAIR) write(join(home, ".claude", "skills", s, "SKILL.md"), `---\nname: ${s}\ndescription: machine-only\n---\n`);
  assert.doesNotMatch(go("--check"), /MISSING +~\/\.claude\/skills\/(find-skills|steal-like-an-artist)/);
});

test("a machine always-on registration that covers only startup reads DRIFT; apply moves it to startup|resume|clear|compact (Codex 4380254400)", () => {
  const home = makeHome("partial-matcher");
  run(home);
  const file = join(home, ".claude", "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  const g = s.hooks.SessionStart.find((x) => JSON.stringify(x).includes("always-on-skills.mjs"));
  g.matcher = "startup";
  write(file, JSON.stringify(s));
  assert.match(run(home, "--check").out, /DRIFT[^\n]*SessionStart always-on-skills\.mjs/);
  run(home);
  const after = JSON.parse(readFileSync(file, "utf8")).hooks.SessionStart.filter((x) => JSON.stringify(x).includes("always-on-skills.mjs"));
  assert.equal(after.length, 1);
  assert.equal(after[0].matcher, "startup|resume|clear|compact");
});

// No --home here: the OS home (HOME/USERPROFILE) is the fixture, so CLAUDE_CONFIG_DIR is what moves the target.
test("CLAUDE_CONFIG_DIR without --home: apply writes under the config dir, not <home>/.claude (Codex 4380254412)", () => {
  const home = makeHome("cfgdir-home");
  const cfg = join(SCRATCH, "cfgdir-target");
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: ROOT, env: { ...env(home), CLAUDE_CONFIG_DIR: cfg }, timeout: 30000 });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(existsSync(join(cfg, "hooks", "always-on-skills.mjs")), "hook not installed under CLAUDE_CONFIG_DIR");
  assert.ok(!existsSync(join(home, ".claude", "hooks")), "wrote under <home>/.claude despite CLAUDE_CONFIG_DIR");
  assert.match(readFileSync(join(cfg, "settings.json"), "utf8"), /cfgdir-target\/hooks\/always-on-skills\.mjs/);
});

// Queue item 5 (bug hunt 2026-10-27): an inherited CLAUDE_CONFIG_DIR beat --home, so a test run could write the REAL
// profile. The decoy stands in for that profile (a temp dir, never the real one): nothing may appear in it.
test("an explicit --home wins over CLAUDE_CONFIG_DIR: apply writes under <home>/.claude only, and --check reads it there", () => {
  const home = makeHome("home-wins");
  const decoy = join(SCRATCH, "home-wins-decoy-profile");
  const e = { ...env(home), CLAUDE_CONFIG_DIR: decoy };
  const r = spawnSync(process.execPath, [SCRIPT, "--home", home], { encoding: "utf8", cwd: ROOT, env: e, timeout: 30000 });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(files(decoy), [], "wrote into CLAUDE_CONFIG_DIR despite an explicit --home");
  assert.ok(existsSync(join(home, ".claude", "hooks", "always-on-skills.mjs")), "hook not installed under --home");
  assert.match(readFileSync(join(home, ".claude", "settings.json"), "utf8"), /home-wins\/\.claude\/hooks\/always-on-skills\.mjs/);
  const c = spawnSync(process.execPath, [SCRIPT, "--home", home, "--check"], { encoding: "utf8", cwd: ROOT, env: e, timeout: 30000 });
  assert.match(c.stdout, /\[bootstrap\] clean/, `--check read somewhere other than --home:\n${c.stdout}`);
  assert.deepEqual(files(decoy), [], "--check wrote into CLAUDE_CONFIG_DIR");
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
  const unexpected = files(home).filter((f) => !/^\.claude\/(settings\.json|CLAUDE\.md|RTK\.md|output-styles\/nour\.md|hooks\/|skills\/|bootstrap-backup\/)|^\.claude\.json$/.test(f));
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

// Graph MCP everywhere (job 2026-11-03-graphify-always-on): the user-level mirror of the repo's .mcp.json and the two
// graph hooks, so every other repo on this machine, and every account that runs the bootstrap, gets the same graph.
const GRAPH_URL = (() => {
  const s = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "local-services.json"), "utf8")).servers.find((x) => x.name === "graphify");
  return `http://127.0.0.1:${s.port}${s.path}`;
})();

test("graph: --check on a bare home names the user-scope MCP entry and both graph hooks as MISSING", () => {
  const r = run(makeHome("graph-bare"), "--check");
  assert.match(r.out, /MISSING\s+~\/\.claude\.json mcpServers graphify/, r.out);
  assert.match(r.out, /MISSING\s+~\/\.claude\/settings\.json SessionStart graph-ensure-mcp\.mjs/, r.out);
  assert.match(r.out, /MISSING\s+~\/\.claude\/settings\.json UserPromptSubmit graph-recall\.mjs/, r.out);
});

test("graph: apply writes the user-scope MCP entry into ~/.claude.json, keeps every other key, registers both hooks with --scope global; a wrong URL reads DRIFT", () => {
  const home = makeHome("graph-apply");
  write(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "a" }, mcpServers: { other: { type: "http", url: "http://x/mcp" } }, projects: { "/p": { allowedTools: [] } } }));
  assert.equal(run(home).code, 0);
  const j = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
  assert.deepEqual(j.mcpServers.graphify, { type: "http", url: GRAPH_URL });
  assert.deepEqual(j.mcpServers.other, { type: "http", url: "http://x/mcp" });
  assert.deepEqual(j.oauthAccount, { accountUuid: "a" });
  assert.deepEqual(j.projects, { "/p": { allowedTools: [] } });
  const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  const ensure = s.hooks.SessionStart.flatMap((g) => g.hooks ?? []).find((h) => h.command.includes("graph-ensure-mcp.mjs"));
  const recall = s.hooks.UserPromptSubmit.flatMap((g) => g.hooks ?? []).find((h) => h.command.includes("graph-recall.mjs"));
  assert.ok(ensure && / --scope global$/.test(ensure.command) && ensure.timeout === 15, JSON.stringify(ensure));
  assert.ok(recall && / --scope global$/.test(recall.command) && recall.timeout === 5, JSON.stringify(recall));
  assert.equal(run(home, "--check").code, 0);
  j.mcpServers.graphify.url = "http://127.0.0.1:9/mcp";
  write(join(home, ".claude.json"), JSON.stringify(j));
  assert.match(run(home, "--check").out, /DRIFT\s+~\/\.claude\.json mcpServers graphify/);
});

test("graph: with CLAUDE_CONFIG_DIR holding its own .claude.json, the MCP entry lands THERE (where plugin-index.globalConfigFile reads), not in <home>/.claude.json", () => {
  const home = makeHome("graph-cfgdir");
  const cfg = join(SCRATCH, "graph-cfgdir-target");
  write(join(cfg, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "c" } }));
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: ROOT, env: { ...env(home), CLAUDE_CONFIG_DIR: cfg }, timeout: 30000 });
  assert.equal(r.status, 0, r.stdout);
  const there = JSON.parse(readFileSync(join(cfg, ".claude.json"), "utf8"));
  assert.deepEqual(there.mcpServers.graphify, { type: "http", url: GRAPH_URL });
  assert.deepEqual(there.oauthAccount, { accountUuid: "c" });
  assert.ok(!existsSync(join(home, ".claude.json")), "nothing written beside the home dir when the config dir holds the file");
});

test("graph: the two user-level `--scope global` commands bootstrap writes run verbatim through a shell (ensure: a [graph] mcp line; recall: the off line on garbage stdin)", () => {
  const home = makeHome("graph-verbatim");
  assert.equal(run(home).code, 0);
  const s = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
  const cmdOf = (event, key) => s.hooks[event].flatMap((g) => g.hooks ?? []).find((h) => h.command.includes(key)).command;
  // The commands name the PRIMARY checkout's scripts; until this branch merges that checkout has no graph-*.mjs, so the
  // path is swapped for this checkout's root (same relative path): the proof is the command string's shape and run.
  const primary = /node "([^"]+)\/scripts\/agent-os\/graph-ensure-mcp\.mjs"/.exec(cmdOf("SessionStart", "graph-ensure-mcp.mjs"))[1];
  const here = ROOT.replaceAll("\\", "/");
  const shell = (cmd, input, extraEnv) => spawnSync(cmd.replaceAll(primary, here), { shell: process.platform === "win32" ? true : "/bin/sh", input, encoding: "utf8", cwd: ROOT, env: { ...env(home), CLAUDE_PROJECT_DIR: join(SCRATCH, "not-a-repo"), NOURCITY_STATE_DIR: join(SCRATCH, "verbatim-state"), GRAPH_ENSURE_LAUNCHER: JSON.stringify([process.execPath, "-e", "process.exit(0)"]), ...extraEnv }, timeout: 30000 });
  mkdirSync(join(SCRATCH, "not-a-repo"), { recursive: true });
  const e = shell(cmdOf("SessionStart", "graph-ensure-mcp.mjs"), JSON.stringify({ source: "startup" }));
  assert.equal(e.status, 0, e.stderr);
  assert.match(e.stdout.trim(), /^\[graph\] mcp/, `ensure: ${e.stdout}${e.stderr}`);
  const r = shell(cmdOf("UserPromptSubmit", "graph-recall.mjs"), "not json");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "", "recall in global scope outside this repo prints nothing, even its off line, before it reads the prompt");
});

test("graph: a ~/.claude.json that is not valid JSON is never overwritten; the item reads DRIFT with the fix-by-hand note", () => {
  const home = makeHome("graph-badjson");
  write(join(home, ".claude.json"), "{ broken");
  const c = run(home, "--check");
  assert.match(c.out, /DRIFT\s+~\/\.claude\.json mcpServers graphify \(.*not valid JSON/);
  run(home);
  assert.equal(readFileSync(join(home, ".claude.json"), "utf8"), "{ broken");
});

// ---- The personal layer (job 2026-11-03-personal-layer-into-repo): config/agent-os/user-layer.json is the one source. ----
const LAYER = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "user-layer.json"), "utf8"));
const WIN = process.platform === "win32";

/** A PATH holding only an empty dir, or a dir with a fake `rtk` (found by the lookup, never executed). */
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
/** The real script (or a fixture repo's copy) under a chosen PATH. */
function runOn(home, { pathEnv, script = SCRIPT, args = [] } = {}) {
  const e = env(home);
  if (pathEnv !== undefined) {
    for (const k of Object.keys(e)) if (k.toUpperCase() === "PATH") delete e[k];
    e.PATH = pathEnv;
  }
  const r = spawnSync(process.execPath, [script, "--home", home, ...args], { encoding: "utf8", cwd: ROOT, env: e, timeout: 30000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const json = (f) => JSON.parse(readFileSync(f, "utf8"));
const mtimes = (home) => files(home).map((f) => [f, statSync(join(home, f)).mtimeMs]);

test("layer: --check on a bare home names each skill, setting, marketplace and MCP entry as MISSING, and writes nothing", () => {
  const home = makeHome("layer-check");
  const before = mtimes(home);
  const r = runOn(home, { args: ["--check"] });
  assert.equal(r.code, 1, r.out);
  for (const s of LAYER.skills) assert.match(r.out, new RegExp(`MISSING\\s+~/\\.claude/skills/${s}\\n`), `no MISSING line for skill ${s}`);
  for (const k of Object.keys(LAYER.settings).filter((x) => x !== "extraKnownMarketplaces")) assert.match(r.out, new RegExp(`MISSING\\s+~/\\.claude/settings\\.json ${k}\\n`), `no MISSING line for setting ${k}`);
  for (const m of Object.keys(LAYER.settings.extraKnownMarketplaces)) assert.match(r.out, new RegExp(`MISSING\\s+~/\\.claude/settings\\.json extraKnownMarketplaces ${m}\\n`), `no MISSING line for marketplace ${m}`);
  assert.match(r.out, /MISSING\s+~\/\.claude\.json mcpServers vapi-docs/, r.out);
  assert.deepEqual(mtimes(home), before, "--check wrote a file");
});

test("layer: apply writes the settings and the MCP entry, keeps every other key, adds no permission, and a second run changes nothing", () => {
  const home = makeHome("layer-apply");
  write(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", cleanupPeriodDays: 30, enabledPlugins: { "x@y": true },
    permissions: { allow: ["Read"] }, extraKnownMarketplaces: { mine: { source: { source: "github", repo: "me/mine" } } } }, null, 2));
  write(join(home, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: "a" }, mcpServers: { other: { type: "http", url: "https://example.test/mcp" } } }));
  const r1 = runOn(home);
  assert.equal(r1.code, 0, r1.out);
  const s = json(join(home, ".claude", "settings.json"));
  for (const [k, v] of Object.entries(LAYER.settings)) if (k !== "extraKnownMarketplaces") assert.deepEqual(s[k], v, k);
  assert.deepEqual(s.extraKnownMarketplaces, { mine: { source: { source: "github", repo: "me/mine" } }, ...LAYER.settings.extraKnownMarketplaces });
  assert.equal(s.model, "opus");
  assert.equal(s.cleanupPeriodDays, 30, "cleanupPeriodDays is Nour's call: bootstrap must not touch it");
  assert.deepEqual(s.enabledPlugins, { "x@y": true }, "enabledPlugins is Nour's call: bootstrap must not touch it");
  assert.deepEqual(s.permissions, { allow: ["Read"] }, "bootstrap adds and removes no permission entry");
  const cj = json(join(home, ".claude.json"));
  assert.deepEqual(cj.oauthAccount, { accountUuid: "a" });
  assert.deepEqual(cj.mcpServers.other, { type: "http", url: "https://example.test/mcp" });
  assert.deepEqual(cj.mcpServers["vapi-docs"], LAYER.mcpServers["vapi-docs"]);
  for (const name of LAYER.skills) assert.ok(existsSync(join(home, ".claude", "skills", name, "SKILL.md")), name);
  const snap = mtimes(home);
  const r2 = runOn(home);
  assert.equal(r2.code, 0, r2.out);
  assert.doesNotMatch(r2.out, /installed|updated/, `second run changed something:\n${r2.out}`);
  assert.deepEqual(mtimes(home), snap);
  assert.equal(runOn(home, { args: ["--check"] }).code, 0);
});

test("layer: a drifted setting reads DRIFT by name, apply restores it and backs the old file up", () => {
  const home = makeHome("layer-drift");
  runOn(home);
  const f = join(home, ".claude", "settings.json");
  write(f, JSON.stringify({ ...json(f), skillListingBudgetFraction: 0.5 }, null, 2));
  const c = runOn(home, { args: ["--check"] });
  assert.equal(c.code, 1);
  assert.match(c.out, /DRIFT\s+~\/\.claude\/settings\.json skillListingBudgetFraction\n/, c.out);
  assert.match(runOn(home).out, /updated\s+~\/\.claude\/settings\.json skillListingBudgetFraction/);
  assert.equal(json(f).skillListingBudgetFraction, LAYER.settings.skillListingBudgetFraction);
  const backups = files(join(home, ".claude", "bootstrap-backup")).filter((x) => x.endsWith("settings.json"));
  assert.ok(backups.some((b) => json(join(home, ".claude", "bootstrap-backup", b)).skillListingBudgetFraction === 0.5), "no backup holds the old value");
});

test("layer: a machine SKILL.md with CRLF keeps its multi-line description without a carriage return, and the install is stable", () => {
  const home = makeHome("layer-crlf");
  write(join(home, ".claude", "skills", "brainstorming", "SKILL.md"), "---\r\nname: brainstorming\r\ndescription: |\r\n  my words\r\n  more words\r\n---\r\nold body\r\n");
  runOn(home);
  const got = readFileSync(join(home, ".claude", "skills", "brainstorming", "SKILL.md"), "utf8");
  assert.match(got, /^description: \|\n  my words\n  more words$/m);
  assert.doesNotMatch(got, /\r/, "a carriage return came through from the machine copy");
  assert.equal(runOn(home, { args: ["--check"] }).code, 0);
});

test("rtk: with no rtk on PATH the hook, RTK.md and the import stay out, the item reads n/a, and --check is clean", () => {
  const home = makeHome("rtk-absent");
  write(join(home, ".claude", "settings.json"), "{}");
  const pathEnv = pathDir("no-rtk", false);
  const r = runOn(home, { pathEnv });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /n\/a\s+~\/\.claude\/settings\.json PreToolUse rtk hook claude \(rtk not on PATH\)/, r.out);
  assert.equal(json(join(home, ".claude", "settings.json")).hooks.PreToolUse, undefined);
  assert.ok(!existsSync(join(home, ".claude", "RTK.md")));
  assert.doesNotMatch(readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8"), /@RTK\.md/);
  assert.equal(runOn(home, { pathEnv, args: ["--check"] }).code, 0);
});

test("rtk: on PATH, the hook, RTK.md and the import install; a machine where rtk went away keeps its existing hook", () => {
  const home = makeHome("rtk-present");
  write(join(home, ".claude", "settings.json"), "{}");
  const pathEnv = pathDir("with-rtk", true);
  assert.equal(runOn(home, { pathEnv, args: ["--check"] }).code, 1);
  const r = runOn(home, { pathEnv });
  assert.equal(r.code, 0, r.out);
  assert.equal(json(join(home, ".claude", "settings.json")).hooks.PreToolUse[0].hooks[0].command, "rtk hook claude");
  assert.equal(readFileSync(join(home, ".claude", "RTK.md"), "utf8"), readFileSync(join(ROOT, "config", "agent-os", "RTK.md"), "utf8"));
  assert.match(readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8"), /^@RTK\.md$/m);
  assert.equal(runOn(home, { pathEnv, args: ["--check"] }).code, 0);
  runOn(home, { pathEnv: pathDir("rtk-gone", false) });
  assert.equal(json(join(home, ".claude", "settings.json")).hooks.PreToolUse[0].hooks[0].command, "rtk hook claude", "bootstrap removes nothing");
});

test("output style (2026-11-06): nour.md installs to ~/.claude/output-styles/, outputStyle reads nour, --check is then clean", () => {
  const home = makeHome("output-style");
  assert.equal(LAYER.settings.outputStyle, "nour", "the layer must select the nour style");
  assert.match(run(home, "--check").out, /MISSING\s+~\/\.claude\/output-styles\/nour\.md/);
  const r = run(home);
  assert.equal(r.code, 0, r.out);
  const src = join(ROOT, "config", "agent-os", "output-styles", "nour.md");
  assert.ok(readFileSync(join(home, ".claude", "output-styles", "nour.md")).equals(readFileSync(src)), "installed style differs from the repo copy");
  assert.equal(json(join(home, ".claude", "settings.json")).outputStyle, "nour");
  // The harness picks the style by its frontmatter name: a mismatch silently falls back to Default.
  assert.match(readFileSync(src, "utf8"), /^---\r?\nname: nour\r?\ndescription: .+/);
  assert.match(run(home, "--check").out, /ok\s+~\/\.claude\/output-styles\/nour\.md/);
});

test("output style: a files[] src that climbs out of config/agent-os refuses, a one-level subfolder passes", () => {
  for (const [label, src, refused] of [["climb", "config/agent-os/../../.env", true], ["climb-sub", "config/agent-os/../x/RTK.md", true], ["dots", "config/agent-os/.../RTK.md", true], ["two-deep", "config/agent-os/a/b/RTK.md", true],["sub", "config/agent-os/output-styles/nour.md", false]]) {
    const { repo, script } = fixtureRepo(`style-src-${label}`);
    const f = join(repo, "config", "agent-os", "user-layer.json");
    write(f, JSON.stringify({ ...json(f), files: [{ src, dest: "output-styles/nour.md" }] }, null, 2));
    const home = makeHome(`style-src-${label}-home`);
    if (refused) assertRefused(runOn(home, { script }), home, mtimes(home), /REFUSE.*user-layer\.json.*file/);
    else assert.equal(runOn(home, { script }).code, 0);
  }
});

test("the bootstrap needs no pnpm, gh or claude: with an empty PATH (a sparse clone, the Desktop bundle) apply still installs the layer", () => {
  const home = makeHome("no-tools");
  const r = runOn(home, { pathEnv: pathDir("empty", false) });
  assert.equal(r.code, 0, r.out);
  assert.ok(existsSync(join(home, ".claude", "skills", "humanizer", "SKILL.md")));
});

test("a skill's executable script stays executable on the machine", { skip: WIN && "Windows has no exec bit" }, () => {
  const home = makeHome("exec-bit");
  runOn(home);
  assert.ok(statSync(join(home, ".claude", "skills", "executing-plans", "scripts", "task-start")).mode & 0o100, "task-start lost its exec bit");
});

test("the block holds the portable rules and nothing machine-specific", () => {
  const home = makeHome("block");
  runOn(home);
  const md = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8");
  assert.match(md, /Lead with the answer or next action/);
  assert.match(md, /Invoke `using-superpowers` at the start of every task/);
  assert.match(md, /keep this line/);
  const block = readFileSync(join(ROOT, "config", "agent-os", "global-claude-md-block.md"), "utf8");
  assert.doesNotMatch(block, /[A-Za-z]:\\|OneDrive|NattyNour|skills-src/i, "the block carries a machine path");
});

test("every layer skill has a repo copy; a community skill carries LICENSE and a pinned SOURCE.md; the quarantined and machine-only skills stay out", () => {
  for (const s of LAYER.skills) assert.ok(existsSync(join(ROOT, ".claude", "skills", s, "SKILL.md")), `${s} has no repo copy`);
  for (const s of ["diagnosing-superpowers", "dispatching-parallel-agents", "executing-plans", "receiving-code-review", "requesting-code-review", "subagent-driven-development", "writing-skills",
    "anti-slop-writing", "ad-creative", "ads", "ads-creative", "ads-meta", "ads-tiktok", "social", "video", "humanizer"]) {
    assert.ok(existsSync(join(ROOT, ".claude", "skills", s, "LICENSE")), `${s} has no LICENSE`);
    assert.match(readFileSync(join(ROOT, ".claude", "skills", s, "SOURCE.md"), "utf8"), /^Pinned: [0-9a-f]{40}\s*$/m, `${s} has no pin`);
  }
  for (const s of ["finishing-a-development-branch", "using-git-worktrees", "writing-plans", "video-cutter", "graphify"]) {
    assert.ok(!LAYER.skills.includes(s), `${s} must stay out of the install list`);
  }
  for (const s of ["finishing-a-development-branch", "using-git-worktrees", "writing-plans", "video-cutter", "graphify"]) assert.ok(!existsSync(join(ROOT, ".claude", "skills", s)), `${s} must not be vendored`);
});

test("the real layer passes the gate: --check on this checkout prints no REFUSE line", () => {
  const r = runOn(makeHome("real-gate"), { args: ["--check"] });
  assert.doesNotMatch(r.out, /REFUSE/, r.out);
});

// Guard rule: a planted secret must make the install refuse. Literals are built from parts so this file stays clean.
const FAKE = {
  "api key": `s${"k"}-ant-${"a1B2".repeat(12)}`,
  "AWS key": `AKIA${"ABCD2345".repeat(2)}`,
  "GitHub token": `gh${"p"}_${"aB3d".repeat(10)}`,
  "private key": `-----BEGIN RSA ${"PRIVATE"} KEY-----`,
  "credential value": `password = "${"hunter2hunter2".repeat(2)}"`,
  "user folder": `C:\\Users\\${"nick"}\\repos`,
  "private address": `192.${"168"}.1.20`,
  "tailnet address": `100.${"100"}.20.3`,
};
const skillDir = (repo, s) => join(repo, ".claude", "skills", s);
function fixtureRepo(label) {
  const f = bareRepoScript(label);
  write(join(skillDir(f.repo, "karpathy-guidelines"), "SKILL.md"), "---\nname: karpathy-guidelines\ndescription: clean\n---\nclean\n");
  return f;
}
const assertRefused = (r, home, before, re, secret) => {
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, re, r.out);
  if (secret) assert.ok(!r.out.includes(secret), "the refusal echoed the secret");
  assert.deepEqual(mtimes(home), before, "a refused install wrote a file");
};

test("positive control: the clean fixture repo installs, so a refusal below is the plant and not the fixture", () => {
  const { script } = fixtureRepo("gate-clean");
  const r = runOn(makeHome("gate-clean-home"), { script });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /REFUSE/, r.out);
});

for (const [kind, secret] of Object.entries(FAKE)) {
  test(`gate: a planted ${kind} in a skill's nested file refuses the install, names file and kind, never prints it, writes nothing`, () => {
    const { repo, script } = fixtureRepo(`gate-${kind.replace(/\W/g, "")}`);
    write(join(skillDir(repo, "karpathy-guidelines"), "references", "note.md"), `line one\r\n${secret}\r\n`);
    const home = makeHome(`gate-${kind.replace(/\W/g, "")}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, new RegExp(`REFUSE.*karpathy-guidelines/references/note\\.md:2.*${kind}`), secret);
    const c = runOn(home, { script, args: ["--check"] });
    assert.equal(c.code, 1);
    assert.match(c.out, /REFUSE/);
  });
}

test("gate: every source file type is scanned: the block, RTK.md, user-layer.json and a hook script", () => {
  const secret = FAKE["GitHub token"];
  const plants = [
    ["block", (r) => join(r, "config", "agent-os", "global-claude-md-block.md"), /global-claude-md-block\.md/],
    ["rtk", (r) => join(r, "config", "agent-os", "RTK.md"), /RTK\.md/],
    ["hook", (r) => join(r, "scripts", "agent-os", "find-skills-turn.mjs"), /find-skills-turn\.mjs/],
  ];
  for (const [label, file, re] of plants) {
    const { repo, script } = fixtureRepo(`gate-src-${label}`);
    const f = file(repo);
    writeFileSync(f, `${readFileSync(f, "utf8")}\n// ${secret}\n`);
    const home = makeHome(`gate-src-${label}-home`);
    const before = mtimes(home);
    // Empty PATH: the RTK.md source must be scanned even on a machine that would not install it.
    assertRefused(runOn(home, { script, pathEnv: pathDir("empty", false) }), home, before, re, secret);
  }
  const { repo, script } = fixtureRepo("gate-src-layer");
  const f = join(repo, "config", "agent-os", "user-layer.json");
  write(f, JSON.stringify({ ...json(f), _doc: secret }));
  const home = makeHome("gate-src-layer-home");
  const before = mtimes(home);
  assertRefused(runOn(home, { script }), home, before, /REFUSE.*user-layer\.json/, secret);
});

test("gate: a .env or key file inside a skill refuses by name, whatever it holds", () => {
  for (const name of [".env", ".env.local", "id_rsa", "server.pem", ".credentials.json"]) {
    const { repo, script } = fixtureRepo(`gate-name-${name.replace(/\W/g, "")}`);
    write(join(skillDir(repo, "karpathy-guidelines"), name), "nothing secret-looking\n");
    const home = makeHome(`gate-name-${name.replace(/\W/g, "")}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, /REFUSE.*karpathy-guidelines/);
  }
});

test("gate: mention is not execution: placeholders and example addresses pass", () => {
  const { repo, script } = fixtureRepo("gate-allow");
  write(join(skillDir(repo, "karpathy-guidelines"), "note.md"), [
    "C:\\Users\\<you>\\repo and C:\\Users\\%USERNAME%\\repo and /home/$USER/x", "version 10.0.26200 and 1.2.3.4", "token: <paste here>", "password = process.env.DB_PASSWORD",
    "the sk- prefix", "100.64.0.0/10 is the tailnet range",
  ].join("\n"));
  const r = runOn(makeHome("gate-allow-home"), { script });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /REFUSE/, r.out);
});

test("gate: no permission entry installs: a permissions key anywhere in the layer refuses before anything is written", () => {
  const cases = {
    "top-level permissions": (l) => ({ ...l, permissions: { allow: ["Bash(*)"] } }),
    "settings.permissions": (l) => ({ ...l, settings: { ...l.settings, permissions: { allow: ["Bash(*)"] } } }),
    "settings.defaultMode": (l) => ({ ...l, settings: { ...l.settings, defaultMode: "bypassPermissions" } }),
    "settings.env": (l) => ({ ...l, settings: { ...l.settings, env: { X: "1" } } }),
    "settings.apiKeyHelper": (l) => ({ ...l, settings: { ...l.settings, apiKeyHelper: "x" } }),
    "settings.enabledPlugins": (l) => ({ ...l, settings: { ...l.settings, enabledPlugins: { "a@b": true } } }),
    "settings.cleanupPeriodDays": (l) => ({ ...l, settings: { ...l.settings, cleanupPeriodDays: 14 } }),
    "settings.hooks": (l) => ({ ...l, settings: { ...l.settings, hooks: { Stop: [] } } }),
    "an MCP header": (l) => ({ ...l, mcpServers: { x: { type: "http", url: "https://a.test", headers: { A: "b" } } } }),
    "an MCP command": (l) => ({ ...l, mcpServers: { x: { type: "stdio", command: "node" } } }),
    "an MCP plain http URL": (l) => ({ ...l, mcpServers: { x: { type: "http", url: "http://a.test" } } }),
    "a file outside the config dir": (l) => ({ ...l, files: [{ src: "config/agent-os/RTK.md", dest: "../evil.md" }] }),
    "a hook with no key": (l) => ({ ...l, hooks: [{ event: "Stop", matcher: "", command: "x" }] }),
    "a hook with no command": (l) => ({ ...l, hooks: [{ event: "Stop", matcher: "", key: "x" }] }),
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const { repo, script } = fixtureRepo(`perm-${label.replace(/\W/g, "")}`);
    const f = join(repo, "config", "agent-os", "user-layer.json");
    write(f, JSON.stringify(mutate(json(f)), null, 2));
    const home = makeHome(`perm-${label.replace(/\W/g, "")}-home`);
    const before = mtimes(home);
    const r = runOn(home, { script });
    assertRefused(r, home, before, /REFUSE.*user-layer\.json/);
    assert.ok(!JSON.stringify(json(join(home, ".claude", "settings.json"))).includes("Bash(*)"), label);
  }
});

test("gate: a skill that registers hooks or grants itself Bash refuses; file-tool grants pass", () => {
  for (const [label, front, refused] of [["hooks", "hooks:\n  Stop: []", true], ["bash", "allowed-tools: Read Bash(python *)", true], ["bash-bare", "allowed-tools: Read Write Bash", true],
    ["bash-list", "allowed-tools:\n  - Read\n  - Bash", true], ["camel", "allowedTools: Bash", true], ["files", "allowed-tools: Read Write Edit Glob Grep", false]]) {
    const { repo, script } = fixtureRepo(`front-${label}`);
    write(join(skillDir(repo, "karpathy-guidelines"), "SKILL.md"), `---\nname: karpathy-guidelines\ndescription: clean\n${front}\n---\nbody\n`);
    const home = makeHome(`front-${label}-home`);
    const before = mtimes(home);
    const r = runOn(home, { script });
    if (refused) assertRefused(r, home, before, /REFUSE.*karpathy-guidelines\/SKILL\.md/);
    else assert.equal(r.code, 0, r.out);
  }
});

// Nour, 2026-11-05 10:45 EST: these three install at user level with their Bash grant. Exactly these three, exactly these grants.
const BASH_SKILLS = { "antislop-human": "Bash(python *) Bash(python3 *) Read Write Edit Glob Grep", "differential-review": "Read Write Grep Glob Bash", "supply-chain-risk-auditor": "Read Write Bash Glob Grep" };
const inLayer = (repo, ...names) => {
  const f = join(repo, "config", "agent-os", "user-layer.json");
  write(f, JSON.stringify({ ...json(f), skills: names }, null, 2));
};

test("bash list: each of the three named skills installs on a bare home with its grant, and the real gate passes", () => {
  const home = makeHome("bash-three");
  const r = runOn(home);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /REFUSE/, r.out);
  for (const [s, grant] of Object.entries(BASH_SKILLS)) {
    assert.ok(LAYER.skills.includes(s), `${s} is not in the install list`);
    assert.match(readFileSync(join(home, ".claude", "skills", s, "SKILL.md"), "utf8"), new RegExp(`^allowed-tools: ${grant.replace(/[()*]/g, "\\$&")}\\r?$`, "m"), s);
  }
});

test("bash list: a fourth skill with a grant copied from the list is refused, and a frontmatter name cannot borrow a listed one", () => {
  for (const [label, front] of [["copied", "name: karpathy-guidelines\ndescription: clean\nallowed-tools: Read Write Grep Glob Bash"], ["borrowed", "name: differential-review\ndescription: clean\nallowed-tools: Read Write Grep Glob Bash"]]) {
    const { repo, script } = fixtureRepo(`bash-fourth-${label}`);
    write(join(skillDir(repo, "karpathy-guidelines"), "SKILL.md"), `---\n${front}\n---\nbody\n`);
    const home = makeHome(`bash-fourth-${label}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, /REFUSE.*karpathy-guidelines\/SKILL\.md:a tool grant/);
  }
});

test("bash list: a nested SKILL.md under a listed skill gets no pass", () => {
  const { repo, script } = fixtureRepo("bash-nested");
  inLayer(repo, "differential-review");
  write(join(skillDir(repo, "differential-review"), "SKILL.md"), `---\nname: differential-review\ndescription: clean\nallowed-tools: ${BASH_SKILLS["differential-review"]}\n---\nbody\n`);
  write(join(skillDir(repo, "differential-review"), "x", "SKILL.md"), `---\nname: x\ndescription: clean\nallowed-tools: ${BASH_SKILLS["differential-review"]}\n---\nbody\n`);
  const home = makeHome("bash-nested-home");
  const before = mtimes(home);
  assertRefused(runOn(home, { script }), home, before, /REFUSE.*differential-review\/x\/SKILL\.md:a tool grant/);
});

test("bash list: a listed skill passes only with its exact grant: a wider one, a second key or hooks refuse, CRLF does not", () => {
  const exact = BASH_SKILLS["differential-review"];
  const cases = [
    ["exact", `allowed-tools: ${exact}`, false],
    ["exact-crlf", `allowed-tools: ${exact}`.replace(/$/, "\r"), false],
    ["wider", `allowed-tools: ${exact} Edit`, true],
    ["wildcard", "allowed-tools: Bash(*)", true],
    ["second-key", `allowed-tools: ${exact}\nallowed-tools: Bash(rm *)`, true],
    ["list-form", "allowed-tools:\n  - Read\n  - Bash", true],
    ["hooks", `allowed-tools: ${exact}\nhooks:\n  Stop: []`, true],
    ["no-grant", "allowed-tools: Read", false],
  ];
  for (const [label, front, refused] of cases) {
    const { repo, script } = fixtureRepo(`bash-exact-${label}`);
    inLayer(repo, "differential-review");
    write(join(skillDir(repo, "differential-review"), "SKILL.md"), `---\nname: differential-review\ndescription: clean\n${front}\n---\nbody\n`);
    const home = makeHome(`bash-exact-${label}-home`);
    const before = mtimes(home);
    const r = runOn(home, { script });
    if (refused) assertRefused(r, home, before, /REFUSE.*differential-review\/SKILL\.md/);
    else assert.equal(r.code, 0, `${label}: ${r.out}`);
  }
});

test("frontmatter spellings cannot hide a grant or a hook: quoted key, flow map, upper case, underscore", () => {
  for (const [label, front] of [["quoted", `"allowed-tools": Read Bash`], ["single", `'allowed-tools': Bash`], ["upper", "ALLOWED-TOOLS: Bash"], ["under", "allowed_tools: Bash"],
    ["flow", "{ allowed-tools: Bash }"], ["quoted-hooks", `"hooks":\n  Stop: []`], ["flow-hooks", "{ hooks: { Stop: [] } }"]]) {
    const { repo, script } = fixtureRepo(`front-spell-${label}`);
    write(join(skillDir(repo, "karpathy-guidelines"), "SKILL.md"), `---\nname: karpathy-guidelines\ndescription: clean\n${front}\n---\nbody\n`);
    const home = makeHome(`front-spell-${label}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, /REFUSE.*karpathy-guidelines\/SKILL\.md/);
  }
});

test("mention is not a grant: a description naming Bash, hooks or allowed-tools passes", () => {
  const { repo, script } = fixtureRepo("front-mention");
  write(join(skillDir(repo, "karpathy-guidelines"), "SKILL.md"), `---\nname: karpathy-guidelines\ndescription: "Use when a hook or Bash call fails; hooks and allowed-tools are not touched here"\n---\nThe allowed-tools: Bash line goes in the frontmatter.\n`);
  const r = runOn(makeHome("front-mention-home"), { script });
  assert.equal(r.code, 0, r.out);
});

// ---- Reader findings on PR 3548 (silent-failure reader, 2026-11-05). ----
const frontTest = (label, front, { refused = true, prefix = "" } = {}) => {
  const { repo, script } = fixtureRepo(`r-${label}`);
  write(join(skillDir(repo, "karpathy-guidelines"), "SKILL.md"), `${prefix}---\nname: karpathy-guidelines\ndescription: clean\n${front}\n---\nbody\n`);
  const home = makeHome(`r-${label}-home`);
  const before = mtimes(home);
  const r = runOn(home, { script });
  if (refused) assertRefused(r, home, before, /REFUSE.*karpathy-guidelines\/SKILL\.md/);
  else assert.equal(r.code, 0, `${label}: ${r.out}`);
};

test("finding 1: any shell or unknown tool in allowed-tools refuses; only the file tools pass", () => {
  for (const [label, tools] of [["powershell", "Read PowerShell(*)"], ["mcp", "mcp__terminal__run_in_terminal"], ["star", "*"], ["agent", "Read Agent"], ["task", "Task"], ["webfetch", "WebFetch"], ["comma", "Read, PowerShell"]]) frontTest(`tool-${label}`, `allowed-tools: ${tools}`);
  frontTest("tool-list", "allowed-tools:\n  - Read\n  - PowerShell");
  frontTest("tool-bracket", `allowed-tools: ["Read", "PowerShell"]`);
  for (const [label, tools] of [["files", "Read Write Edit Glob Grep"], ["comma-ok", "Read, Grep"], ["empty", ""]]) frontTest(`safe-${label}`, `allowed-tools: ${tools}`, { refused: false });
  frontTest("safe-bracket", `allowed-tools: ["Read", "Grep"]`, { refused: false });
});

test("finding 2: files[] may write only named destinations: settings.json and CLAUDE.md refuse", () => {
  for (const dest of ["settings.json", "CLAUDE.md", ".credentials.json", "settings.local.json"]) {
    const { repo, script } = fixtureRepo(`dest-${dest.replace(/\W/g, "")}`);
    const f = join(repo, "config", "agent-os", "user-layer.json");
    write(f, JSON.stringify({ ...json(f), files: [{ src: "config/agent-os/RTK.md", dest }] }, null, 2));
    const home = makeHome(`dest-${dest.replace(/\W/g, "")}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, /REFUSE.*user-layer\.json.*file/);
  }
});

test("finding 3: the live key shapes refuse: Stripe, Postgres, MySQL, Bearer; placeholders pass", () => {
  const planted = [
    ["Stripe key", `s${"k"}_live_${"a1B2".repeat(6)}`],
    ["database URL", `postgresql://admin:${"hunter2"}pw@db.test/x`],
    ["database URL", `postgres://admin:${"hunter2"}pw@db.test/x`],
    ["database URL", `mysql://root:${"hunter2"}pw@db.test/x`],
    ["bearer token", `Authorization: Bearer ${"a1B2c3D4".repeat(4)}`],
  ];
  planted.forEach(([kind, secret], i) => {
    const { repo, script } = fixtureRepo(`live-${i}`);
    write(join(skillDir(repo, "karpathy-guidelines"), "note.md"), `first\n${secret}\n`);
    const home = makeHome(`live-${i}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, new RegExp(`REFUSE.*note\\.md:2.*${kind}`), secret);
  });
  const { repo, script } = fixtureRepo("live-allow");
  write(join(skillDir(repo, "karpathy-guidelines"), "note.md"), "postgres://user:<password>@host/db\nmysql://root:${DB_PASSWORD}@host/db\nBearer <token>\nBearer $TOKEN\nthe sk_live_ prefix\n");
  const r = runOn(makeHome("live-allow-home"), { script });
  assert.equal(r.code, 0, r.out);
});

test("finding 3: the vendored eval prompt holds no key-shaped value, and SOURCE.md records the edit", () => {
  const evals = readFileSync(join(ROOT, ".claude", "skills", "video", "evals", "evals.json"), "utf8");
  assert.doesNotMatch(evals, /sk_live_/);
  assert.match(readFileSync(join(ROOT, ".claude", "skills", "video", "SOURCE.md"), "utf8"), /Local edit/);
});

test("finding 4: a junctioned skill is replaced by a real folder, stated in the output, and its target stays untouched", () => {
  const home = makeHome("junction");
  const target = join(SCRATCH, "junction-target", "humanizer");
  write(join(target, "SKILL.md"), "---\nname: humanizer\ndescription: my words\n---\nold\n");
  write(join(target, "README.md"), "kept\n");
  symlinkSync(target, join(home, ".claude", "skills", "humanizer"), "junction");
  const c = runOn(home, { args: ["--check"] });
  assert.match(c.out, /DRIFT\s+~\/\.claude\/skills\/humanizer \(a link: bootstrap replaces it with a real folder\)/, c.out);
  const before = readFileSync(join(target, "SKILL.md"), "utf8");
  const r = runOn(home);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /updated\s+~\/\.claude\/skills\/humanizer \(a link/, r.out);
  assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), before, "the install wrote through the junction");
  assert.ok(existsSync(join(target, "README.md")), "the junction target lost a file");
  assert.ok(!lstatSync(join(home, ".claude", "skills", "humanizer")).isSymbolicLink(), "the junction is still there");
  assert.equal(readFileSync(join(home, ".claude", "skills", "humanizer", "LICENSE"), "utf8"), readFileSync(join(ROOT, ".claude", "skills", "humanizer", "LICENSE"), "utf8"));
  assert.match(readFileSync(join(home, ".claude", "skills", "humanizer", "SKILL.md"), "utf8"), /^description: my words$/m);
  assert.equal(runOn(home, { args: ["--check"] }).code, 0);
});

test("finding 4: a link at the hooks or skills folder refuses: nothing is written through it", () => {
  for (const dir of ["hooks", "skills"]) {
    const home = makeHome(`link-${dir}`);
    const target = join(SCRATCH, `link-target-${dir}`);
    mkdirSync(target, { recursive: true });
    rmSync(join(home, ".claude", dir), { recursive: true, force: true });
    symlinkSync(target, join(home, ".claude", dir), "junction");
    const before = mtimes(home);
    assertRefused(runOn(home), home, before, new RegExp(`REFUSE.*~/\\.claude/${dir} is a link`));
    assert.deepEqual(readdirSync(target), [], "the install wrote through the link");
  }
});

test("Codex 4494924419: a link at a nested destination's parent (~/.claude/output-styles) refuses: nothing is written through it", () => {
  const home = makeHome("link-output-styles");
  const target = join(SCRATCH, "link-target-output-styles");
  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(home, ".claude", "output-styles"), "junction");
  const before = mtimes(home);
  assertRefused(runOn(home), home, before, /REFUSE.*~\/\.claude\/output-styles is a link/);
  assert.deepEqual(readdirSync(target), [], "the install wrote through the link");
});

test("finding 5: rules already outside the block are dropped from it; the standing-orders block and his text stay byte for byte", () => {
  const home = makeHome("dupes");
  const orders = "<!-- nourcity-standing-orders:begin -->\n## Standing orders\n\nkeep\n<!-- nourcity-standing-orders:end -->\n";
  const mine = `# my rules\n\n## Output style\n\nmy wording\n\n@RTK.md\n\n${orders}`;
  write(join(home, ".claude", "CLAUDE.md"), mine);
  const pathEnv = pathDir("dupes-rtk", true);
  const r = runOn(home, { pathEnv });
  assert.equal(r.code, 0, r.out);
  const md = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8");
  assert.ok(md.startsWith(mine), "text outside the markers changed");
  assert.equal(md.match(/^## Output style$/gm).length, 1, "the rules appear twice");
  assert.equal(md.match(/^@RTK\.md$/gm).length, 1, "the import appears twice");
  assert.match(md, /^## Process skills$/m, "a rule that is not outside must still install");
  assert.equal(runOn(home, { pathEnv, args: ["--check"] }).code, 0);
  const snap = mtimes(home);
  runOn(home, { pathEnv });
  assert.deepEqual(mtimes(home), snap, "a second run changed something");
});

test("finding 5: a home without those rules gets them in the block", () => {
  const home = makeHome("no-dupes");
  const pathEnv = pathDir("no-dupes-rtk", true);
  runOn(home, { pathEnv });
  const md = readFileSync(join(home, ".claude", "CLAUDE.md"), "utf8");
  assert.equal(md.match(/^## Output style$/gm).length, 1);
  assert.equal(md.match(/^@RTK\.md$/gm).length, 1);
});

test("finding 6: a BOM or blank lines before the frontmatter cannot hide a grant or a hook", () => {
  const bom = String.fromCharCode(0xfeff);
  for (const [label, prefix] of [["bom", bom], ["blank", "\n\n"], ["crlf", "\r\n"], ["space", "  \n"], ["bom-blank", `${bom}\n`]]) {
    frontTest(`lead-${label}`, "allowed-tools: Bash", { prefix });
    frontTest(`lead-hooks-${label}`, "hooks:\n  Stop: []", { prefix });
  }
});

test("finding 7: a malformed layer is a REFUSE on every path, never a crash or a silent off", () => {
  const cases = {
    "hooks object": (l) => ({ ...l, hooks: { a: 1 } }),
    "files string": (l) => ({ ...l, files: "x" }),
    "settings list": (l) => ({ ...l, settings: ["a"] }),
    "mcp string": (l) => ({ ...l, mcpServers: "x" }),
    "null hook": (l) => ({ ...l, hooks: [null] }),
    "null file": (l) => ({ ...l, files: [null] }),
    "null mcp": (l) => ({ ...l, mcpServers: { x: null } }),
    "the layer is a list": () => [],
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const { repo, script } = fixtureRepo(`shape-${label.replace(/\W/g, "")}`);
    const f = join(repo, "config", "agent-os", "user-layer.json");
    write(f, JSON.stringify(mutate(json(f))));
    const home = makeHome(`shape-${label.replace(/\W/g, "")}-home`);
    const before = mtimes(home);
    assertRefused(runOn(home, { script }), home, before, /REFUSE.*user-layer\.json/);
    const h = runOn(home, { script, args: ["--check", "--hook"] });
    assert.equal(h.code, 0, "the hook line always exits 0");
    assert.match(h.out, /\[health\] machine .*REFUSE/, `${label}: ${h.out}`);
    assert.doesNotMatch(h.out, /machine off/, label);
  }
  const { repo, script } = fixtureRepo("shape-json");
  write(join(repo, "config", "agent-os", "user-layer.json"), "{ broken");
  const home = makeHome("shape-json-home");
  const before = mtimes(home);
  assertRefused(runOn(home, { script }), home, before, /REFUSE.*user-layer\.json/);
});

test("--check prints the tool versions on one line (node, git, claude), so two clean PCs can still be told apart", () => {
  const home = makeHome("versions");
  const r = run(home, "--check");
  assert.match(r.out, /^\[bootstrap\] versions node v\d+\.\d+\.\d+ \| git \S+ \| claude \S+$/m);
});
