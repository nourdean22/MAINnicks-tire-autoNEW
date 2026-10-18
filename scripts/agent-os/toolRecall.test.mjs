// Canary for tool-recall.mjs, the UserPromptSubmit hook that names the MCP servers, plugins, lane agents and CLIs a
// prompt should use. Every control runs the REAL script as a child process (guard-red-team rule 5), and the wiring test
// runs the CONFIGURED command string verbatim. Mutants are planted by copying the script to the OS temp dir with one
// rule changed and its skill-recall import pointed back at the real file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "tool-recall.mjs");
const REGISTRY = join(ROOT, "config", "agent-os", "tool-recall.json");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "tool-recall-test-"));

function run(args, { stdin, env = {}, script = SCRIPT } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    input: stdin, encoding: "utf8", cwd: ROOT, timeout: 20000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, ...env },
  });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const lines = (out) => out.split(/\r?\n/).filter(Boolean);
const LINE = /^\[tool-recall\] use: (\S+) \((mcp|plugin|agent|cli); [^)]+\) .+$/;

// prompt -> the entry that must print. Scores are in the tool-recall.mjs header.
const POSITIVE = [
  ["find every caller of enqueueReelJob and rename it", "serena"],
  ["deep research the best local video models", "perplexity-in-chrome"],
  ["what is the prisma 6 migrate dev syntax", "context7"],
];

for (const [prompt, name] of POSITIVE) {
  test(`--text "${prompt}" prints ${name}`, () => {
    const r = run(["--text", prompt]);
    assert.equal(r.code, 0, r.err);
    const got = lines(r.out);
    assert.ok(got.length >= 1 && got.length <= 4, `expected 1-4 lines, got:\n${r.out}`);
    for (const l of got) assert.match(l, LINE);
    assert.ok(got.some((l) => l.startsWith(`[tool-recall] use: ${name} (`)), `${name} missing from:\n${r.out}`);
  });
}

test("nonsense prints NOTHING (zero bytes) and exits 0", () => {
  const r = run(["--text", "asdf qwerty"]);
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

// Near miss: two words from one entry's `use` body and nothing from any name or trigger. It scores above zero and
// under the floor, so it is the control that dies when the floor is removed (nonsense scores nothing either way).
const NEAR_MISS = "the root cause";

test("near miss: body-only hits under the floor print nothing", () => {
  const r = run(["--text", NEAR_MISS]);
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("hook mode: stdin JSON with a prompt field prints the same match", () => {
  const r = run([], { stdin: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: POSITIVE[0][0] }) });
  assert.equal(r.code, 0);
  assert.match(r.out, /^\[tool-recall\] use: serena \(mcp; /m);
});

test("an entry with `native` names the repo skill that already does the job", () => {
  const r = run(["--text", "before you build, check for prior art and existing implementations"]);
  assert.match(r.out, /^\[tool-recall\] use: before-you-build \(plugin; [^)]+\) .+ \[native: prior-art-grep\]$/m);
});

test("at most 4 lines even when many entries match", () => {
  const r = run(["--text", "railway deploy logs, gh pr checks, sentry crash stack trace, gmail email calendar, postgres schema sql migration, serena rename callers"]);
  assert.equal(r.code, 0);
  const got = lines(r.out);
  assert.equal(got.length, 4, r.out);
});

test("a registry with broken JSON prints exactly one off line and exits 0", () => {
  const bad = join(SCRATCH, "broken.json");
  writeFileSync(bad, "[{ not json");
  const r = run(["--text", POSITIVE[0][0]], { env: { TOOL_RECALL_REGISTRY: bad } });
  assert.equal(r.code, 0);
  const got = lines(r.out);
  assert.equal(got.length, 1, r.out);
  assert.match(got[0], /^\[tool-recall\] off: .+/);
});

test("a registry entry with a bad kind is refused with one off line, exit 0", () => {
  const bad = join(SCRATCH, "badkind.json");
  writeFileSync(bad, JSON.stringify([{ name: "x", kind: "skill", use: "u", triggers: "rename callers" }]));
  const r = run(["--text", POSITIVE[0][0]], { env: { TOOL_RECALL_REGISTRY: bad } });
  assert.equal(r.code, 0);
  assert.match(r.out, /^\[tool-recall\] off: .*kind/);
});

test("garbage stdin fails open: one off line, exit 0 (exit 2 would veto the prompt)", () => {
  const r = run([], { stdin: "not json" });
  assert.equal(r.code, 0);
  assert.match(r.out, /^\[tool-recall\] off: /);
});

test("the real registry parses and every entry has the required fields", () => {
  const reg = JSON.parse(readFileSync(REGISTRY, "utf8"));
  assert.ok(Array.isArray(reg) && reg.length >= 10);
  for (const e of reg) {
    assert.ok(e.name && e.use && e.triggers, JSON.stringify(e));
    assert.ok(["mcp", "plugin", "agent", "cli"].includes(e.kind), JSON.stringify(e));
    assert.doesNotMatch(e.use, /\n/);
    assert.doesNotMatch(JSON.stringify(e), /[^\x00-\x7f]/, "ASCII only");
  }
});

function configured() {
  const hooks = (SETTINGS.hooks?.UserPromptSubmit ?? []).flatMap((g) => g.hooks ?? []);
  return { hooks, at: hooks.findIndex((h) => h.command?.includes("tool-recall.mjs")), recall: hooks.findIndex((h) => h.command?.includes("skill-recall.mjs")) };
}

test("settings: UserPromptSubmit runs tool-recall right after skill-recall, forward slashes", () => {
  const { hooks, at, recall } = configured();
  assert.ok(at >= 0, "tool-recall.mjs is not registered on UserPromptSubmit");
  assert.equal(at, recall + 1, "tool-recall must run right after skill-recall");
  assert.doesNotMatch(hooks[at].command, /\\/);
  assert.match(hooks[at].command, /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/tool-recall\.mjs"$/);
});

test("the CONFIGURED command runs verbatim through a shell and names serena", () => {
  const { hooks, at } = configured();
  assert.ok(at >= 0, "tool-recall.mjs is not registered on UserPromptSubmit");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  const cmd = process.platform === "win32" ? hooks[at].command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : hooks[at].command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ prompt: POSITIVE[0][0] }), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\[tool-recall\] use: serena \(mcp; /m);
});

/** A mutant copy in the temp dir; its skill-recall import is pointed at the real file, its registry passed by env. */
function mutant(label, from, to) {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes(from), `mutation anchor not found: ${from}`);
  const file = join(SCRATCH, `${label}.mjs`);
  writeFileSync(file, src.replace(from, to).replace('"./skill-recall.mjs"', JSON.stringify(pathToFileURL(join(HERE, "skill-recall.mjs")).href)));
  return (args) => run(args, { script: file, env: { TOOL_RECALL_REGISTRY: REGISTRY } });
}

test("MUTANT no-floor: dropping the FLOOR check makes the near miss print (the control is not silent)", () => {
  const m = mutant("no-floor", "r.score >= FLOOR", "r.score > 0");
  assert.equal(m(["--text", POSITIVE[0][0]]).code, 0, "mutant must still run");
  assert.notEqual(m(["--text", NEAR_MISS]).out, "", "the near-miss control did not kill the no-floor mutant");
});
