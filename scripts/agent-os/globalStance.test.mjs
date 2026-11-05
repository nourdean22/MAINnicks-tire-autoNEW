// Canary for scripts/agent-os/global-stance.mjs: --check fails on a home without the stance and on an edited copy,
// install reaches every program, keeps the user's own text and changes nothing on a second run. Every run is the REAL
// script as a child process against a fixture home.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { targets } from "./global-stance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "global-stance.mjs");
const ORDERS = readFileSync(resolve(HERE, "..", "..", ".agents", "core", "STANDING-ORDERS.md"), "utf8").replaceAll("\r\n", "\n").trim();
const bare = () => mkdtempSync(join(tmpdir(), "stance-test-"));
const home = () => {
  const dir = bare();
  for (const [, file] of targets(dir)) mkdirSync(dirname(file), { recursive: true });
  return dir;
};
const { CLAUDE_CONFIG_DIR: _config, CODEX_HOME: _codex, COPILOT_HOME: _copilot, ...cleanEnv } = process.env;
const run = (dir, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--home", dir, ...args], { encoding: "utf8", env: cleanEnv });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const claudeFile = (dir) => join(dir, ".claude", "CLAUDE.md");
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

test("check fails on a home with no stance, and names every program", () => {
  const r = run(home(), "--check");
  assert.equal(r.code, 1);
  for (const name of ["Claude", "Codex", "Gemini", "Copilot CLI", "VS Code Copilot", "Codex size limit"]) assert.match(r.out, new RegExp(`${name}: MISSING`));
});

test("install reaches every program, and check then passes", () => {
  const dir = home();
  assert.equal(run(dir).code, 0);
  for (const [, file] of targets(dir)) assert.ok(readFileSync(file, "utf8").includes(ORDERS), file);
  const vscode = targets(dir).at(-1)[1];
  assert.match(readFileSync(vscode, "utf8"), /^---\napplyTo: "\*\*"\n---\n/);
  assert.equal(run(dir, "--check").code, 0);
});

test("a second install changes nothing and makes no backup", () => {
  const dir = home();
  put(claudeFile(dir), "# mine\n");
  run(dir);
  const before = readFileSync(claudeFile(dir), "utf8");
  const backups = readdirSync(join(dir, ".claude", "bootstrap-backup")).length;
  run(dir);
  assert.equal(readFileSync(claudeFile(dir), "utf8"), before);
  assert.equal(readdirSync(join(dir, ".claude", "bootstrap-backup")).length, backups);
});

test("the user's own text survives on both sides of the block, CRLF included", () => {
  const dir = home();
  put(claudeFile(dir), "# mine\r\nkeep this\r\n");
  run(dir);
  const edited = readFileSync(claudeFile(dir), "utf8").replace("## Act", "## Stale") + "\nafter the block\n";
  writeFileSync(claudeFile(dir), edited);
  assert.equal(run(dir, "--check").code, 1, "an edited copy must fail the check");
  run(dir);
  const text = readFileSync(claudeFile(dir), "utf8");
  assert.ok(text.includes("keep this") && text.includes("after the block") && text.includes(ORDERS));
  assert.ok(!text.includes("\r"), "line endings normalised");
});

test("an edited copy reads DRIFT and check leaves the file alone", () => {
  const dir = home();
  run(dir);
  const edited = readFileSync(claudeFile(dir), "utf8").replace("Get his go, per action", "Ask about everything");
  writeFileSync(claudeFile(dir), edited);
  const r = run(dir, "--check");
  assert.equal(r.code, 1);
  assert.match(r.out, /Claude: DRIFT/);
  assert.equal(readFileSync(claudeFile(dir), "utf8"), edited);
});

test("a file with one marker is never rewritten, and the run fails", () => {
  const dir = home();
  const broken = "<!-- nourcity-standing-orders:begin (x) -->\nhalf a block\n";
  put(claudeFile(dir), broken);
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Claude: DRIFT, cannot be set safely/);
  assert.equal(readFileSync(claudeFile(dir), "utf8"), broken);
});

const BEGIN = "<!-- nourcity-standing-orders:begin (x) -->";
const END = "<!-- nourcity-standing-orders:end -->";
for (const [label, broken] of [
  ["two begins with his text between", `${BEGIN}\nold\n${BEGIN}\nUSERTEXT\n${END}\n`],
  ["a stale second block", `${BEGIN}\na\n${END}\n${BEGIN}\nb\n${END}\n`],
  ["markers named in prose", `a note on ${BEGIN} and ${END} kept here\n`],
]) {
  test(`${label}: never rewritten, and check fails`, () => {
    const dir = home();
    put(claudeFile(dir), broken);
    assert.equal(run(dir).code, 1);
    assert.equal(run(dir, "--check").code, 1);
    assert.equal(readFileSync(claudeFile(dir), "utf8"), broken);
  });
}

for (const [label, bytes] of [
  ["UTF-16", Buffer.from("\ufeff# mine\r\n", "utf16le")],
  ["cp1252", Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])],
]) {
  test(`a ${label} file is refused byte for byte`, () => {
    const dir = home();
    put(claudeFile(dir), bytes);
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /Claude: DRIFT, not UTF-8/);
    assert.deepEqual(readFileSync(claudeFile(dir)), bytes);
  });
}

test("the VS Code file gets its applyTo header back, and check notices it missing", () => {
  const dir = home();
  run(dir);
  const file = targets(dir).at(-1)[1];
  writeFileSync(file, readFileSync(file, "utf8").replace(/^---[\s\S]*?---\n\n/, ""));
  assert.equal(run(dir, "--check").code, 1);
  run(dir);
  assert.match(readFileSync(file, "utf8"), /^---\napplyTo: "\*\*"\n---\n/);
});

test("the Claude target follows CLAUDE_CONFIG_DIR, as bootstrap does", () => {
  const dir = home();
  const other = join(dir, "profile-two");
  mkdirSync(other);
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...cleanEnv, HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: other } });
  assert.equal(r.status, 0, r.stdout);
  assert.ok(readFileSync(join(other, "CLAUDE.md"), "utf8").includes(ORDERS));
});

test("--home ignores CLAUDE_CONFIG_DIR, so a test can never write a real CLAUDE.md", () => {
  const dir = home();
  const real = bare();
  const file = join(real, "CLAUDE.md");
  put(file, "# real\n");
  const r = spawnSync(process.execPath, [SCRIPT, "--home", dir], { encoding: "utf8", env: { ...cleanEnv, CLAUDE_CONFIG_DIR: real } });
  assert.equal(r.status, 0, r.stdout);
  assert.equal(readFileSync(file, "utf8"), "# real\n");
  assert.ok(readFileSync(claudeFile(dir), "utf8").includes(ORDERS));
});

test("a program that is not on this PC is skipped, not created, and check stays clean", () => {
  const dir = bare();
  mkdirSync(join(dir, ".claude"));
  assert.equal(run(dir).code, 0);
  const r = run(dir, "--check");
  assert.equal(r.code, 0, r.out);
  for (const name of ["Codex", "Gemini", "Copilot CLI", "VS Code Copilot", "Codex size limit"]) assert.match(r.out, new RegExp(`${name}: skip`));
  assert.match(r.out, /Claude: ok/);
  for (const absent of [".codex", ".gemini", ".copilot"]) assert.equal(existsSync(join(dir, absent)), false, absent);
  assert.equal(existsSync(targets(dir).at(-1)[1]), false);
});

test("VS Code counts as present when its user folder exists, with no prompts folder yet", () => {
  const dir = bare();
  mkdirSync(dirname(dirname(targets(dir).at(-1)[1])), { recursive: true });
  run(dir);
  assert.ok(readFileSync(targets(dir).at(-1)[1], "utf8").includes(ORDERS));
});

test("a BOM on the VS Code file is dropped, so the header stays first", () => {
  const dir = home();
  const file = targets(dir).at(-1)[1];
  put(file, "\ufeff# mine\n");
  run(dir);
  const text = readFileSync(file, "utf8");
  assert.ok(text.startsWith('---\napplyTo: "**"\n---\n'));
  assert.ok(text.includes("# mine") && !text.includes("\ufeff"));
});

test("a narrowed applyTo is put back to the whole workspace, and check notices it", () => {
  const dir = home();
  run(dir);
  const file = targets(dir).at(-1)[1];
  writeFileSync(file, readFileSync(file, "utf8").replace('applyTo: "**"', 'applyTo: "**/*.js"'));
  assert.equal(run(dir, "--check").code, 1);
  run(dir);
  const text = readFileSync(file, "utf8");
  assert.match(text, /^---\napplyTo: "\*\*"\n---\n/);
  assert.ok(!text.includes("*.js"));
  assert.equal(run(dir, "--check").code, 0);
});

test("Gemini's configured context file gets the orders, GEMINI.md does not", () => {
  const dir = home();
  put(join(dir, ".gemini", "settings.json"), JSON.stringify({ context: { fileName: ["AGENTS.md", "CONTEXT.md"] } }));
  run(dir);
  assert.ok(readFileSync(join(dir, ".gemini", "AGENTS.md"), "utf8").includes(ORDERS));
  assert.equal(existsSync(join(dir, ".gemini", "GEMINI.md")), false);
});

test("macOS VS Code uses Application Support, Linux uses .config", () => {
  assert.match(targets("/h", {}, "darwin").at(-1)[1].replaceAll("\\", "/"), /\/h\/Library\/Application Support\/Code\/User\/prompts\//);
  assert.match(targets("/h", {}, "linux").at(-1)[1].replaceAll("\\", "/"), /\/h\/\.config\/Code\/User\/prompts\//);
});

test("a non-empty Codex override gets the orders, because it is the file Codex reads", () => {
  const dir = home();
  const override = join(dir, ".codex", "AGENTS.override.md");
  put(override, "# for today\n");
  run(dir);
  assert.ok(readFileSync(override, "utf8").includes(ORDERS));
  assert.equal(existsSync(join(dir, ".codex", "AGENTS.md")), false);
});

test("an empty Codex override is ignored", () => {
  const dir = home();
  put(join(dir, ".codex", "AGENTS.override.md"), "");
  run(dir);
  assert.ok(readFileSync(join(dir, ".codex", "AGENTS.md"), "utf8").includes(ORDERS));
});

test("the Codex size limit lands first in config.toml and keeps his settings", () => {
  const dir = home();
  const config = join(dir, ".codex", "config.toml");
  put(config, 'model = "x"\n\n[tui]\ntheme = "dark"\n');
  assert.equal(run(dir, "--check").code, 1);
  run(dir);
  assert.equal(readFileSync(config, "utf8"), 'project_doc_max_bytes = 65536\nmodel = "x"\n\n[tui]\ntheme = "dark"\n');
  assert.equal(run(dir, "--check").code, 0);
});

test("a lower Codex limit is reported and left for him to change", () => {
  const dir = home();
  const config = join(dir, ".codex", "config.toml");
  put(config, "project_doc_max_bytes = 1024\n");
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Codex size limit: DRIFT/);
  assert.equal(readFileSync(config, "utf8"), "project_doc_max_bytes = 1024\n");
});
