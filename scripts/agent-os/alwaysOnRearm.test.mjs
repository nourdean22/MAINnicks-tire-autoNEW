// Canary for the repo-carried always-on re-arm (job 2026-10-26-always-on-hardening). The always-on skills used to be
// re-armed only by the machine-local ~/.claude/hooks/always-on-skills.mjs, so a fresh clone, a cloud session or another
// account got nothing. The repo now registers scripts/agent-os/always-on-skills.mjs --repo on SessionStart
// (startup|resume|clear|compact). It prints the re-arm when the machine hook is absent and stays silent when the
// machine hook is registered AND its file exists, so the text never prints twice. The machine hook IS this file
// (bootstrap-machine.mjs copies it), so the two texts cannot drift.
// Every control runs the CONFIGURED command verbatim through a shell against a fixture home; the mutation arms plant
// a copy with one line changed and prove the controls go red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "always-on-skills.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "always-on-test-"));
const SKILLS = ["using-superpowers", "ponytail", "karpathy-guidelines", "i-have-adhd", "verification-before-completion", "find-skills", "prompt-gallery", "steal-like-an-artist"];

const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** A fixture home. machine: "none" | "registered" (settings entry + file) | "dangling" (settings entry, no file). */
function makeHome(label, machine) {
  const home = join(SCRATCH, label);
  mkdirSync(join(home, ".claude"), { recursive: true });
  const hookFile = join(home, ".claude", "hooks", "always-on-skills.mjs").replaceAll("\\", "/");
  if (machine !== "none") {
    write(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup|resume|clear|compact",
      hooks: [{ type: "command", command: `node "${hookFile}"`, timeout: 10 }] }] } }));
  }
  if (machine === "registered") write(hookFile, readFileSync(SCRIPT, "utf8"));
  return home;
}

const configured = () => (SETTINGS.hooks?.SessionStart ?? []).filter((g) => (g.hooks ?? []).some((h) => h.command?.includes("always-on-skills.mjs")));

function runCommand(command, source, home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  Object.assign(env, { CLAUDE_PROJECT_DIR: ROOT, HOME: home, USERPROFILE: home });
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const input = JSON.stringify({ session_id: "t", cwd: ROOT, hook_event_name: "SessionStart", source });
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input, encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const runConfigured = (source, home) => runCommand(configured()[0].hooks.find((h) => h.command.includes("always-on-skills.mjs")).command, source, home);
const context = (out) => (out.trim() ? JSON.parse(out).hookSpecificOutput?.additionalContext ?? "" : "");

const NONE = makeHome("none", "none");
const REGISTERED = makeHome("registered", "registered");
const DANGLING = makeHome("dangling", "dangling");

// The controls as predicates, so the mutation arms can assert they go red.
const armsStartup = (out) => SKILLS.every((s) => context(out).includes(s)) && context(out).startsWith("[always-on skills]");
const silentWithMachine = (out) => out.trim() === "";

test("settings: one SessionStart group runs always-on-skills.mjs --repo and fires on startup, resume, clear and compact", () => {
  const groups = configured();
  assert.equal(groups.length, 1, "exactly one repo group may run the re-arm, or it prints twice");
  const re = new RegExp(`^(?:${groups[0].matcher})$`);
  for (const s of ["startup", "resume", "clear", "compact"]) assert.ok(re.test(s), `matcher ${groups[0].matcher} misses ${s}`);
  assert.match(groups[0].hooks[0].command, /always-on-skills\.mjs" --repo$/);
});

test("no machine hook: startup prints the re-arm naming every always-on skill", () => {
  const r = runConfigured("startup", NONE);
  assert.equal(r.code, 0, r.err);
  assert.ok(armsStartup(r.out), r.out);
  assert.match(context(r.out), /antislop/);
  assert.match(context(r.out), /monorepo-manager/);
});

test("no machine hook: compact says the context was compacted and re-arms", () => {
  const ctx = context(runConfigured("compact", NONE).out);
  assert.match(ctx, /Context was just compacted/);
  for (const s of SKILLS) assert.ok(ctx.includes(s), s);
});

test("machine hook registered and present: the repo hook prints nothing, so the text never shows twice", () => {
  for (const source of ["startup", "compact"]) {
    const r = runConfigured(source, REGISTERED);
    assert.equal(r.code, 0);
    assert.ok(silentWithMachine(r.out), `printed with the machine hook present:\n${r.out}`);
  }
});

test("machine hook registered but its file is gone: the repo hook still re-arms", () => {
  assert.ok(armsStartup(runConfigured("startup", DANGLING).out));
});

test("the machine copy (no --repo) always prints: bootstrap installs this same file", () => {
  const r = runCommand(`node "${SCRIPT}"`, "startup", REGISTERED);
  assert.ok(armsStartup(r.out), r.out);
});

test("bad or empty stdin is treated as a fresh session, exit 0", () => {
  const env = { ...process.env, HOME: NONE, USERPROFILE: NONE };
  const r = spawnSync(process.execPath, [SCRIPT, "--repo"], { input: "not json", encoding: "utf8", env });
  assert.equal(r.status, 0);
  assert.ok(armsStartup(r.stdout), r.stdout);
});

/** Plant a mutant: one exact line replaced, asserted to occur once first (positive-control-first, mutation on live text). */
function mutant(label, from, to) {
  const src = readFileSync(SCRIPT, "utf8");
  assert.equal(src.split(from).length - 1, 1, `mutation anchor must occur exactly once: ${from}`);
  const file = join(SCRATCH, `${label}.mjs`);
  writeFileSync(file, src.replace(from, to));
  return file;
}

test("MUTANT the silence check removed: the never-twice control goes red", () => {
  const file = mutant("no-silence", "if (repoMode && machineHookPresent(home())) return;", "");
  assert.ok(!silentWithMachine(runCommand(`node "${file}" --repo`, "startup", REGISTERED).out));
});

test("MUTANT one skill dropped from the list: the startup control goes red (and the mutant still runs)", () => {
  const file = mutant("drop-skill", `const SKILLS = ["using-superpowers", `, "const SKILLS = [");
  const r = runCommand(`node "${file}" --repo`, "startup", NONE);
  assert.equal(r.code, 0, r.err);
  assert.match(context(r.out), /^\[always-on skills\]/, "the mutant must still print: a crash is a red for the wrong reason");
  assert.ok(!armsStartup(r.out), r.out);
});
