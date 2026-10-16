/**
 * Canary for scripts/agent-os/precompact-handoff.mjs and its wiring in
 * .claude/settings.json (PreCompact writer, SessionStart[compact] recall).
 *
 * Each arm pins one way the mechanism can rot silently: the writer stops recording
 * a fact (branch, HEAD, dirty paths), recall prints on every session start instead
 * of only after a compaction, the note lands inside the repo (dirtying the tree
 * stop-check.mjs judges), the cap stops truncating, or the configured command
 * string no longer launches. Everything runs against a scratch git repo with
 * GIT_* stripped (guard-red-team rule 6) and a scratch handoff dir via
 * AGENT_OS_HANDOFF_DIR, so nothing touches the real home dir or this checkout.
 *
 * Run:  node --test scripts/agent-os/precompactHandoff.test.mjs   (or: pnpm agent:verify)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";
import { KEEP, RECALL_CAP, buildNote, handoffDir, newestNote, recallText, writeNote } from "./precompact-handoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "precompact-handoff.mjs");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

function sh(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: stripGitLocalEnv() });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}
/** A scratch repo on branch test/handoff with one commit and one dirty file. */
function scratchRepo() {
  const cwd = mkdtempSync(join(tmpdir(), "precompact-repo-"));
  sh(["init", "-q", "-b", "test/handoff"], cwd);
  sh(["config", "user.email", "t@example.invalid"], cwd);
  sh(["config", "user.name", "t"], cwd);
  writeFileSync(join(cwd, "a.txt"), "a\n");
  sh(["add", "a.txt"], cwd);
  sh(["commit", "-q", "-m", "first commit of the scratch repo"], cwd);
  writeFileSync(join(cwd, "dirty.txt"), "unsaved\n");
  const sha = sh(["rev-parse", "--short", "HEAD"], cwd);
  return { cwd, sha };
}
const scratchEnv = () => ({ ...stripGitLocalEnv(), AGENT_OS_HANDOFF_DIR: mkdtempSync(join(tmpdir(), "precompact-notes-")) });
function runScript(args, stdin, cwd, env) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, input: stdin, encoding: "utf8", env, timeout: 20000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("writer: records branch, HEAD, the dirty path and the trigger, outside the repo, exit 0 (end to end)", () => {
  const { cwd, sha } = scratchRepo();
  const env = scratchEnv();
  const r = runScript([], JSON.stringify({ session_id: "abcdef1234", trigger: "auto", cwd }), cwd, env);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /handoff written before compaction: /);
  const note = newestNote(cwd, env);
  assert.ok(note, "no note written");
  assert.ok(note.file.startsWith(env.AGENT_OS_HANDOFF_DIR), `note must live under AGENT_OS_HANDOFF_DIR, got ${note.file}`);
  assert.ok(!note.file.startsWith(cwd), "the note must never land inside the checkout (stop-check judges that tree)");
  assert.equal(sh(["status", "--porcelain"], cwd).split("\n").filter(Boolean).length, 1, "the writer must not add files to the repo");
  for (const needle of ["branch: test/handoff", `HEAD: ${sha} first commit`, "uncommitted: 1 path(s):", "?? dirty.txt", "trigger auto", "session abcdef12", "last 5 commits:"]) {
    assert.ok(note.text.includes(needle), `note lacks "${needle}":\n${note.text}`);
  }
});

test("recall: prints the newest note only when source is compact; silent on startup/resume/clear; exit 0 either way", () => {
  const { cwd } = scratchRepo();
  const env = scratchEnv();
  writeNote({ cwd, sessionId: "s1", trigger: "manual", env });
  const compact = runScript(["--recall"], JSON.stringify({ source: "compact", cwd }), cwd, env);
  assert.equal(compact.code, 0, compact.out);
  assert.match(compact.out, /handoff written before the last compaction/);
  assert.match(compact.out, /branch: test\/handoff/);
  for (const source of ["startup", "resume", "clear"]) {
    const r = runScript(["--recall"], JSON.stringify({ source, cwd }), cwd, env);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", `recall must print nothing for source=${source}, got: ${r.out}`);
  }
});

test("recall: with no note it says so in one line (never a crash, never silence after a compaction)", () => {
  const { cwd } = scratchRepo();
  const env = scratchEnv();
  const r = runScript(["--recall"], JSON.stringify({ source: "compact", cwd }), cwd, env);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no pre-compaction handoff/);
});

test("writer: outside a git checkout it still writes a note and exits 0 (a hook here informs, never blocks)", () => {
  const cwd = mkdtempSync(join(tmpdir(), "precompact-nogit-"));
  const env = scratchEnv();
  const r = runScript([], "{}", cwd, env);
  assert.equal(r.code, 0, r.out);
  const note = newestNote(cwd, env);
  assert.ok(note && note.text.includes("not a git checkout"), note?.text);
});

test("writer: malformed stdin is tolerated (exit 0) and the note still carries the branch", () => {
  const { cwd } = scratchRepo();
  const env = scratchEnv();
  const r = runScript([], "{not json", cwd, env);
  assert.equal(r.code, 0, r.out);
  assert.match(newestNote(cwd, env).text, /branch: test\/handoff/);
});

test(`prune: only the newest ${KEEP} notes per checkout survive`, () => {
  const { cwd } = scratchRepo();
  const env = scratchEnv();
  for (let i = 0; i < KEEP + 2; i += 1) writeNote({ cwd, sessionId: `s${i}`, trigger: "auto", env, now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
  assert.equal(readdirSync(handoffDir(cwd, env)).length, KEEP);
  assert.match(newestNote(cwd, env).file, new RegExp(`-s${KEEP + 1}\\.md$`), "the newest note must be the one kept last");
});

test(`recall: a note longer than ${RECALL_CAP} chars is truncated with a marker that names the full file`, () => {
  const { cwd } = scratchRepo();
  const env = scratchEnv();
  const file = writeNote({ cwd, sessionId: "big", trigger: "auto", env });
  writeFileSync(file, "x".repeat(RECALL_CAP + 500));
  const text = recallText(cwd, env);
  assert.ok(text.length < RECALL_CAP + 400, `recall output not capped: ${text.length} chars`);
  assert.match(text, /truncated at 4000 chars; full note at /);
});

test("buildNote: the branch line is derived from git, not a constant (a detached HEAD says HEAD)", () => {
  const { cwd, sha } = scratchRepo();
  sh(["checkout", "-q", "--detach"], cwd);
  const text = buildNote({ cwd, sessionId: "d", trigger: "auto" });
  assert.match(text, /branch: HEAD/);
  assert.ok(text.includes(`HEAD: ${sha}`));
});

test("wiring: PreCompact writer and SessionStart[compact] recall are configured with ${CLAUDE_PROJECT_DIR} and forward slashes, and both LAUNCH verbatim", () => {
  const groups = (event) => settings.hooks?.[event] ?? [];
  const pre = groups("PreCompact").flatMap((g) => g.hooks ?? []).find((h) => h.type === "command" && h.command.includes("precompact-handoff.mjs"));
  assert.ok(pre, "no PreCompact precompact-handoff.mjs hook in .claude/settings.json");
  assert.ok(!pre.command.includes("--recall"), "the PreCompact entry must be the writer, not --recall");
  const start = groups("SessionStart").find((g) => (g.hooks ?? []).some((h) => h.command?.includes("precompact-handoff.mjs")));
  assert.ok(start, "no SessionStart precompact-handoff.mjs --recall hook in .claude/settings.json");
  assert.equal(start.matcher, "compact", "recall must be scoped to the compact source by matcher, not run on every session start");
  const recall = start.hooks.find((h) => h.command.includes("precompact-handoff.mjs"));
  assert.match(recall.command, /--recall/);
  for (const h of [pre, recall]) {
    assert.match(h.command, /\$\{CLAUDE_PROJECT_DIR\}/, "hook must use ${CLAUDE_PROJECT_DIR}, not an absolute path");
    assert.ok(!h.command.includes("\\"), "backslash paths do not resolve on Linux");
    const env = { ...stripGitLocalEnv(), CLAUDE_PROJECT_DIR: ROOT, AGENT_OS_HANDOFF_DIR: mkdtempSync(join(tmpdir(), "precompact-wiring-")) };
    const cmd = process.platform === "win32" ? h.command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : h.command;
    const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ source: "compact", trigger: "auto", session_id: "wire" }), encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
    assert.equal(r.status, 0, `${h.command} exited ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(`${r.stdout}${r.stderr}`, /Cannot find module|MODULE_NOT_FOUND/);
    assert.match(r.stdout, /\[agent-os\]/, `${h.command} printed no [agent-os] line:\n${r.stdout}${r.stderr}`);
    assert.ok(!existsSync(join(ROOT, ".claude", "agent-os")), "the writer must not create files inside the repo");
  }
});
