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
  for (const f of ["bootstrap-machine.mjs", "always-on-skills.mjs", "plugin-index.mjs", "find-skills-turn.mjs"]) write(join(repo, "scripts", "agent-os", f), readFileSync(join(HERE, f)));
  for (const f of ["global-claude-md-block.md", "local-services.json"]) write(join(repo, "config", "agent-os", f), readFileSync(join(ROOT, "config", "agent-os", f)));
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
  const unexpected = files(home).filter((f) => !/^\.claude\/(settings\.json|CLAUDE\.md|hooks\/|skills\/|bootstrap-backup\/)|^\.claude\.json$/.test(f));
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
