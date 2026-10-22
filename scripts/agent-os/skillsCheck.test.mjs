/**
 * Canaries for the skills Stop hook (scripts/agent-os/skills-check.mjs, 2026-10-17).
 *
 * Drives the REAL script with Stop-hook stdin against fixture transcripts built here. Blocks (exit 2) are asserted
 * with the hook's own `[skills-check]` line, never a bare nonzero exit. Each block case has a control that differs in
 * one entry and must be allowed. Wiring (the configured command string) is proved in hookCommand.test.mjs.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  const env = { ...process.env, SKILLS_CHECK_DIR: fx.dir, ...(timing ? { SKILLS_CHECK_TIMING: "1" } : {}), ...(fx.skillDirs ? { SKILLS_CHECK_SKILL_DIRS: fx.skillDirs } : {}) };
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

// -- Turn truth (2026-10-22, job manager-skill-best) -----------------------------------------------------------------
// The manager's replies ended "Skills: <names>" naming skills it had not invoked in that turn (33 of 86 such lines on
// 2026-10-22), and called CI green with no CI read in the turn. Both are claims the turn's own tool calls can refute.
// Known skill names come from SKILLS_CHECK_SKILL_DIRS here (the hook defaults to the project's and the user's skills).
const skillDirs = (() => {
  const root = mkdtempSync(join(tmpdir(), "skills-known-"));
  for (const n of ["using-superpowers", "ponytail", "positive-control-first", "systematic-debugging", "stranded-branch-rescue", "answer-first", "brainstorming", "docx"]) {
    mkdirSync(join(root, n));
  }
  return root;
})();
const truth = (list, extra = {}) => stop({ ...fixture(list), skillDirs }, extra);
const SKILLED = (finalText, more = []) => [
  prompt("merge the docs PR"),
  use("Skill", { skill: "using-superpowers" }),
  result(),
  ...more,
  use("Bash", { command: "git status" }),
  result(),
  say(finalText),
];

test("turn truth: a Skills line naming a skill with no Skill call this turn is blocked once, naming it", () => {
  const r = truth(SKILLED("Done.\nSkills: using-superpowers, stranded-branch-rescue"));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /\[skills-check\]/);
  assert.match(r.err, /Skills: line names stranded-branch-rescue/);
  assert.doesNotMatch(r.err, /names[^.]*using-superpowers/, "an invoked skill is not reported");
});

test("turn truth control: the same line with the Skill call is allowed", () => {
  const r = truth(SKILLED("Done.\nSkills: using-superpowers, stranded-branch-rescue", [use("Skill", { skill: "stranded-branch-rescue" }), result()]));
  assert.equal(r.code, 0, r.err);
});

test("turn truth: 'used earlier', parentheses, a Tools: tail and prose words on the line are not claims", () => {
  for (const line of [
    "Skills: using-superpowers (used earlier: stranded-branch-rescue)",
    "Skills: using-superpowers; used earlier: stranded-branch-rescue, answer-first",
    "Skills: using-superpowers, ponytail (full) | Tools: stranded-branch-rescue",
    "**Skills:** using-superpowers, read-only office-lane work",
    "Skills: none, because this was a status read",
    // The manager's real shape (2026-10-22T10:53Z, 12:44Z): the claim list ends at the sentence; skipped names follow it.
    "Skills: using-superpowers, ponytail. I skipped stranded-branch-rescue and answer-first because no branch work happened.",
    "Skills: using-superpowers, ponytail; skipped stranded-branch-rescue (no branch work)",
    // Each cut pinned on its own (mutation sweep: one layer hid the other).
    "Skills: using-superpowers. Next turn runs stranded-branch-rescue on the old branch.",
    "Skills: using-superpowers (its stranded-branch-rescue table was not needed)",
  ]) {
    const r = truth(SKILLED(`Done.\n${line}`, [use("Skill", { skill: "ponytail", args: "full" }), result()]));
    assert.equal(r.code, 0, `${line}: ${r.err}`);
  }
});

test("turn truth: a namespaced name counts by its bare name; an uninvoked plugin skill is caught", () => {
  assert.equal(truth(SKILLED("Skills: superpowers:using-superpowers")).code, 0);
  const r = truth(SKILLED("Skills: using-superpowers, anthropic-skills:docx"));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /docx/);
});

test("turn truth: last_assistant_message is read when the transcript lacks the final text, and wins over it", () => {
  const list = SKILLED("Done.").slice(0, -1); // the transcript ends before the final message (allowed on some versions)
  const r = truth(list, { last_assistant_message: "Done.\nSkills: using-superpowers, systematic-debugging" });
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /systematic-debugging/);
  assert.equal(truth(SKILLED("Skills: using-superpowers, systematic-debugging"), { last_assistant_message: "Done.\nSkills: using-superpowers" }).code, 0);
});

test("turn truth: a conversation turn (no tools) that names an uninvoked skill is still a false claim", () => {
  const r = truth([prompt("what did you use?"), say("I checked it.\nSkills: positive-control-first")]);
  assert.equal(r.code, 2, r.err);
  assert.equal(truth([prompt("what did you use?"), say("Nothing new this turn.")]).code, 0, "control: no Skills line, no claim");
});

test("turn truth: a skill loaded by a typed slash command counts as invoked", () => {
  const slash = prompt("<command-name>/brainstorming</command-name>");
  const body = { type: "user", isMeta: true, timestamp: ts(), message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: C:/Users/x/.claude/skills/brainstorming\n\n# Brainstorming" }] } };
  assert.equal(truth([slash, body, use("Bash", { command: "x" }), result(), say("Skills: brainstorming")]).code, 0);
});

test("turn truth, CI: calling CI green with no CI read this turn is blocked; a read, a condition or a negation is not", () => {
  const r = truth(SKILLED("PR 3226: CI is green, merging next.\nSkills: using-superpowers"));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /CI/);
  assert.match(r.err, /gh pr checks/);
  for (const [text, more] of [
    ["PR 3226: CI is green.\nSkills: using-superpowers", [use("Bash", { command: "gh pr checks 3226" }), result()]],
    ["All checks passed.\nSkills: using-superpowers", [use("PowerShell", { command: "node scripts/agent-os/merge-gate.mjs 3226 --sha abc" }), result()]],
    ["CI green.\nSkills: using-superpowers", [use("mcp__ccd_pr__get_status", {}), result()]],
    ["I will merge once CI is green.\nSkills: using-superpowers", []],
    ["CI is not green yet: node still running.\nSkills: using-superpowers", []],
    ["CI: not read this turn.\nSkills: using-superpowers", []],
    ["Both PRs are green once the node job finishes.\nSkills: using-superpowers", []], // a hedge AFTER the claim words
  ]) {
    const v = truth(SKILLED(text, more));
    assert.equal(v.code, 0, `${text.split("\n")[0]}: ${v.err}`);
  }
  // The manager's real 2026-10-21/22 wording (transcript 0900c49a): a PR-noun claim and a stale tally.
  for (const text of ["**All 4 remaining PRs are green and mergeable:**", "| #3212 | CI 4 passed, 0 failed | merges next |"]) {
    const v = truth(SKILLED(`${text}\nSkills: using-superpowers`));
    assert.equal(v.code, 2, `${text}: ${v.err}`);
  }
  const event = prompt("<ci-monitor-event>PR #3226 checks: 13 pass</ci-monitor-event>");
  assert.equal(truth([event, use("Skill", { skill: "using-superpowers" }), result(), say("CI is green on 3226.\nSkills: using-superpowers")]).code, 0, "the app's CI event is the read");
});

test("turn truth, live: calling a change live with no live read this turn is blocked; a health read or a negation is not", () => {
  const r = truth(SKILLED("#3215 is live now.\nSkills: using-superpowers"));
  assert.equal(r.code, 2, r.err);
  assert.match(r.err, /live/);
  for (const [text, more] of [
    ["#3215 is live now.\nSkills: using-superpowers", [use("Bash", { command: "curl -s --max-time 15 https://nickstire.org/api/health" }), result()]],
    ["Both apps are live.\nSkills: using-superpowers", [use("mcp__16f59cb5__list-deployments", { service: "web" }), result()]],
    ["It isn't live yet; Railway builds are paused.\nSkills: using-superpowers", []],
    ["Merged; not live until the next deploy.\nSkills: using-superpowers", []],
    // False alarms the replay over the real transcript found (2026-10-21T23:45Z, 2026-10-22T12:48Z):
    ["**Nothing from today is live yet** (Railway builds paused).\nSkills: using-superpowers", []],
    ["It gets tested, goes live, and I'll check the next real call.\nSkills: using-superpowers", []],
    ["The shop-ears session reports it live (its /api/health read at 05:22Z).\nSkills: using-superpowers", []],
  ]) {
    const v = truth(SKILLED(text, more));
    assert.equal(v.code, 0, `${text.split("\n")[0]}: ${v.err}`);
  }
});

test("turn truth is one-shot per prompt, shared with the no-Skill rule", () => {
  const fx = { ...fixture(SKILLED("Skills: using-superpowers, answer-first")), skillDirs };
  assert.equal(stop(fx).code, 2);
  assert.equal(stop(fx).code, 0, "the second stop for the same prompt goes through");
});
