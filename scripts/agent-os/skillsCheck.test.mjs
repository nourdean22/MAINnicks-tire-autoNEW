/**
 * Canaries for the skills Stop hook (scripts/agent-os/skills-check.mjs, 2026-10-17).
 *
 * Drives the REAL script with Stop-hook stdin against fixture transcripts built here. Blocks (exit 2) are asserted
 * with the hook's own `[skills-check]` line, never a bare nonzero exit. Each block case has a control that differs in
 * one entry and must be allowed. Wiring (the configured command string) is proved in hookCommand.test.mjs.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "skills-check.mjs");

let seq = 0;
const ts = () => new Date(Date.UTC(2026, 9, 17, 10, 0, seq++)).toISOString();
const prompt = (text, extra = {}) => ({ type: "user", origin: { kind: "human" }, promptId: `p-${seq}`, uuid: `u-${seq}`, timestamp: ts(), message: { role: "user", content: text }, ...extra });
const use = (name, input = {}) => ({ type: "assistant", timestamp: ts(), message: { role: "assistant", content: [{ type: "tool_use", id: `t-${seq}`, name, input }] } });
const result = () => ({ type: "user", toolUseResult: { stdout: "ok" }, timestamp: ts(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } });
const say = (text) => ({ type: "assistant", timestamp: ts(), message: { role: "assistant", content: [{ type: "text", text }] } });
const recall = (...names) => ({ type: "attachment", timestamp: ts(), attachment: { type: "hook_success", hookEvent: "UserPromptSubmit", hookName: "UserPromptSubmit", content: names.map((n) => `[skill-recall] invoke: ${n} (why)`).join("\n"), stdout: "" } });
const compaction = () => [
  { type: "system", subtype: "compact_boundary", content: "Conversation compacted", timestamp: ts() },
  { type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: ts(), message: { role: "user", content: "This session is being continued from a previous conversation." } },
];
const jsonl = (list) => list.map((e) => JSON.stringify(e)).join("\n") + "\n";

function fixture(list) {
  const dir = mkdtempSync(join(tmpdir(), "skills-check-"));
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, jsonl(list));
  return { dir: join(dir, "state"), transcript, session: "sess-1" };
}

function stop(fx, extra = {}) {
  const { raw, timing, ...rest } = extra;
  const payload = { session_id: fx.session, transcript_path: fx.transcript, hook_event_name: "Stop", stop_hook_active: false, ...rest };
  const env = { ...process.env, SKILLS_CHECK_DIR: fx.dir, ...(timing ? { SKILLS_CHECK_TIMING: "1" } : {}) };
  const r = spawnSync(process.execPath, [SCRIPT], { input: raw ?? JSON.stringify(payload), env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const WORK = () => [prompt("fix the login bug"), recall("systematic-debugging", "positive-control-first"), use("Bash", { command: "pnpm test" }), result(), use("Edit", { file_path: "a.ts" }), result(), say("Fixed.")];

test("tools ran and no Skill call since the prompt: the stop is blocked once, naming the always-on set and this prompt's recall", () => {
  const r = stop(fixture(WORK()));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /\[skills-check\]/);
  assert.match(r.err, /no Skill call/);
  for (const name of ["using-superpowers", "karpathy-guidelines", "verification-before-completion", "systematic-debugging", "positive-control-first"]) assert.match(r.err, new RegExp(name));
  assert.equal(r.out, "", "a Stop hook's block reason belongs on stderr");
});

test("control: the same turn with a Skill call is allowed", () => {
  const list = WORK();
  list.splice(2, 0, use("Skill", { skill: "systematic-debugging" }), result());
  const r = stop(fixture(list));
  assert.equal(r.code, 0, r.err);
});

test("one-shot per prompt: the second stop attempt is allowed, and a NEW prompt can be blocked again", () => {
  const fx = fixture(WORK());
  assert.equal(stop(fx).code, 2);
  assert.equal(stop(fx).code, 0, "the second attempt for the same prompt must go through (no loops)");
  appendFileSync(fx.transcript, jsonl([prompt("now the signup bug"), use("Bash", { command: "pnpm test" }), result(), say("Done.")]));
  assert.equal(stop(fx).code, 2, "the one-shot is keyed on the prompt, not the whole session");
});

test("stop_hook_active (already continuing because of a Stop hook) is always allowed", () => {
  assert.equal(stop(fixture(WORK()), { stop_hook_active: true }).code, 0);
});

test("a conversation turn (no tool calls, or only the app's turn bookkeeping) is silent", () => {
  for (const list of [
    [prompt("what does this do?"), say("It parses dates.")],
    [prompt("thanks"), use("mcp__ccd_turn__wrap_up", { recap: "x" }), result(), say("Done.")],
    [prompt("load the skill"), use("Skill", { skill: "ponytail" }), result(), say("Loaded.")],
  ]) {
    const r = stop(fixture(list));
    assert.equal(r.code, 0, `${JSON.stringify(list[0].message.content)}: ${r.err}`);
    assert.equal(r.err, "");
  }
});

test("only THIS turn counts: tool calls before the latest prompt do not block a conversation turn", () => {
  const list = [...WORK(), prompt("ok, and why?"), say("Because of the cache.")];
  assert.equal(stop(fixture(list)).code, 0);
});

test("mention is not structure: a prompt that quotes skill-recall lines (a lane brief) is still the turn's start", () => {
  const covered = [prompt("first"), use("Skill", { skill: "ponytail" }), result(), use("Bash", { command: "a" }), result(), say("ok")];
  const brief = prompt("Your brief.\n[skill-recall] invoke: guard-red-team (hooks)\nDo X.");
  const r = stop(fixture([...covered, brief, use("Bash", { command: "b" }), result(), say("Done.")]));
  assert.equal(r.code, 2, "the Skill call of the PREVIOUS turn must not cover this one");
});

test("a skill loaded by a typed slash command (no Skill tool_use, only its body) covers the turn", () => {
  const slash = prompt("<command-message>ponytail</command-message>\n<command-name>/ponytail</command-name>\n<command-args>full</command-args>");
  const body = { type: "user", isMeta: true, timestamp: ts(), message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: C:\\Users\\nourd\\.claude\\skills\\ponytail\n\n# Ponytail" }] } };
  assert.equal(stop(fixture([slash, body, use("Bash", { command: "x" }), result(), say("Done.")])).code, 0);
  assert.equal(stop(fixture([slash, use("Bash", { command: "x" }), result(), say("Done.")])).code, 2, "control: the command alone, with no skill body, is not a skill load");
});

test("a task notification is not a new prompt: a Skill call before it still covers the turn", () => {
  const note = { type: "user", origin: { kind: "task-notification" }, timestamp: ts(), message: { role: "user", content: "<task-notification>\n<task-id>a1</task-id>\n</task-notification>" } };
  const covered = [prompt("run the suite"), use("Skill", { skill: "verification-before-completion" }), result(), use("Bash", { command: "x", run_in_background: true }), result(), note, use("Read", { file_path: "out" }), result(), say("Green.")];
  assert.equal(stop(fixture(covered)).code, 0);
  const uncovered = covered.filter((e) => !(e.message?.content?.[0]?.name === "Skill"));
  assert.equal(stop(fixture(uncovered)).code, 2, "control: without the Skill call the same turn is blocked");
});

test("after a compaction, a Skill call that is not one of the always-on set does not re-arm: blocked once", () => {
  const list = [prompt("keep going"), use("Skill", { skill: "positive-control-first" }), result(), use("Bash", { command: "a" }), result(), ...compaction(), use("Bash", { command: "b" }), result(), say("Done.")];
  const r = stop(fixture(list));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /compaction/);
  const rearmed = [...list.slice(0, -1), use("Skill", { skill: "using-superpowers" }), result(), say("Done.")];
  assert.equal(stop(fixture(rearmed)).code, 0, "control: an always-on Skill call after the compaction re-arms");
  const pluginName = [...list.slice(0, -1), use("Skill", { skill: "superpowers:karpathy-guidelines" }), result(), say("Done.")];
  assert.equal(stop(fixture(pluginName)).code, 0, "a namespaced always-on name counts too");
  const noCompaction = list.filter((e) => e.type !== "system" && !e.isCompactSummary);
  assert.equal(stop(fixture(noCompaction)).code, 0, "control: with no compaction any Skill call covers the turn");
});

test("fails OPEN: garbage stdin, no session, a missing or empty transcript all exit 0", () => {
  const fx = fixture(WORK());
  for (const extra of [{ raw: "{not json" }, { raw: JSON.stringify({ transcript_path: fx.transcript }) }, { transcript_path: join(fx.dir, "nope.jsonl") }]) {
    assert.equal(stop(fx, extra).code, 0, JSON.stringify(extra));
  }
  const empty = fixture([]);
  assert.equal(stop(empty).code, 0);
  const blocked = { ...fixture(WORK()), dir: fx.transcript }; // the state "dir" is a file: the one-shot cannot be written
  assert.equal(stop(blocked).code, 0, "if the one-shot cannot be recorded, never block (a block it cannot remember would loop)");
});

test("reads from the end: a turn after 20 MB of history is judged in under 300 ms of script time", () => {
  const filler = say("z".repeat(4000));
  const big = Array.from({ length: 5000 }, () => filler);
  const fx = fixture([...WORK(), ...big, ...WORK()]);
  const r = stop(fx, { timing: true });
  assert.equal(r.code, 2);
  const ms = Number(r.err.match(/skills-check (\d+) ms/)?.[1]);
  assert.ok(ms >= 0, `no timing line: ${r.err}`);
  assert.ok(ms < 300, `took ${ms} ms`);
});

test("history before the turn is never read: judge stops at the prompt, and the reader honours its byte cap", async () => {
  const { judge, linesFromEnd } = await import("./skills-check.mjs");
  const work = WORK();
  const fx = fixture([...Array.from({ length: 1000 }, () => say("old")), ...work]);
  let read = 0;
  const v = judge((function* () { for (const l of linesFromEnd(fx.transcript)) { read++; yield l; } })());
  assert.ok(v.prompt, "the prompt must be found");
  assert.equal(read, work.length, "only the turn's own lines are consumed");
  const tail = [...linesFromEnd(fx.transcript, 300)];
  const last = readFileSync(fx.transcript, "utf8").trimEnd().split("\n").at(-1);
  assert.equal(tail[0], last, "newest line first");
  assert.ok(tail.length >= 1 && tail.join("\n").length < 300, `the 300-byte cap read ${tail.length} lines`);
});

test("drift: the always-on set here is the one skill-recall filters out (same names, one source of truth by test)", async () => {
  const src = readFileSync(join(HERE, "skill-recall.mjs"), "utf8");
  const recallSet = new Set([...src.match(/const ALWAYS_ON = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const { ALWAYS_ON } = await import("./skills-check.mjs");
  assert.ok(ALWAYS_ON.length >= 5);
  for (const name of ALWAYS_ON) assert.ok(recallSet.has(name), `${name} is not in skill-recall's ALWAYS_ON`);
});
