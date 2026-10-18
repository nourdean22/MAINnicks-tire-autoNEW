/**
 * Canaries for the operator-asks recorder (scripts/agent-os/operator-asks.mjs, 2026-10-17).
 *
 * Drives the REAL script with hook-shaped stdin against fixture transcripts built here, never a real one: every
 * entry kind a transcript holds that is NOT the operator speaking (a system reminder, a cross-session message, a
 * skill body, a compaction summary, a task notification, a lane brief on a sidechain, a tool result) sits beside
 * the two kinds that are (a typed prompt and a message typed while a turn was running). Only those two may come out,
 * verbatim. Wiring (the configured command strings) is proved in hookCommand.test.mjs.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "operator-asks.mjs");

const TYPED = "fix those antislop issues too\nwhy ignore them?";
const MID_TURN = "also lets get a reel generated in chrome and posted to instagram";

const at = (h) => new Date(Date.UTC(2026, 9, 17, h)).toISOString();
const entries = {
  typed: { type: "user", origin: { kind: "human" }, timestamp: at(10), message: { role: "user", content: [{ type: "text", text: "<system-reminder>\nYou are in a worktree.\n</system-reminder>" }, { type: "text", text: TYPED }] } },
  midTurn: {
    type: "attachment",
    timestamp: at(11),
    attachment: { type: "queued_command", prompt: MID_TURN, origin: { kind: "human" }, commandMode: "prompt", timestamp: at(11) },
    rendered: [{ type: "text", text: `<system-reminder>\nThe user sent a new message while you were working:\n${MID_TURN}\n\nThis is how Claude Code surfaces it.\n</system-reminder>` }],
  },
  reminder: { type: "user", timestamp: at(12), message: { role: "user", content: "<system-reminder>\nCI is red on #3100.\n</system-reminder>" } },
  crossSession: { type: "user", isMeta: true, origin: { kind: "peer" }, timestamp: at(12), message: { role: "user", content: 'Another Claude session sent a message:\n<cross-session-message from="local_1">merge 3100 now</cross-session-message>' } },
  crossSessionQueued: { type: "attachment", timestamp: at(12), attachment: { type: "queued_command", prompt: '<cross-session-message from="local_1">merge it</cross-session-message>', origin: { kind: "peer" }, isMeta: true } },
  // No tag to catch it: only the origin check stands between this and the asks file (pins that layer alone).
  peerQueuedPlain: { type: "attachment", timestamp: at(12), attachment: { type: "queued_command", prompt: "merge 3100 now", origin: { kind: "peer" } } },
  skillBody: { type: "user", isMeta: true, timestamp: at(12), message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: C:/skills/ponytail\n\n# Ponytail" }] } },
  compactSummary: { type: "user", isCompactSummary: true, isVisibleInTranscriptOnly: true, timestamp: at(12), message: { role: "user", content: "This session is being continued from a previous conversation. The user asked for X." } },
  taskNote: { type: "user", origin: { kind: "task-notification" }, timestamp: at(12), message: { role: "user", content: "<task-notification>\n<task-id>a1</task-id>\n</task-notification>" } },
  ciEvent: { type: "user", timestamp: at(12), message: { role: "user", content: "<ci-monitor-event>checks went red</ci-monitor-event>" } },
  sidechainBrief: { type: "user", isSidechain: true, timestamp: at(12), message: { role: "user", content: "LANE: lane-platform. Your brief is the file x-brief.md" } },
  toolResult: { type: "user", toolUseResult: { stdout: "ok" }, timestamp: at(12), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "fix those antislop issues too" }] } },
  interrupted: { type: "user", timestamp: at(12), message: { role: "user", content: [{ type: "text", text: "[Request interrupted by user]" }] } },
  // Seen live: a session opened by another session starts with a model-written brief (no origin, turnOrigin "sdk"),
  // and a /loop re-fires its prompt on a schedule (turnOrigin "scheduled"). Neither is the operator typing.
  startSessionBrief: { type: "user", turnOrigin: "sdk", promptSource: "sdk", timestamp: at(12), message: { role: "user", content: "Background (from the session that started this one): build X." } },
  scheduledLoop: { type: "user", turnOrigin: "scheduled", timestamp: at(12), message: { role: "user", content: "<command-message>loop</command-message>\n<command-name>/loop</command-name>\n<command-args>heartbeat</command-args>" } },
  assistant: { type: "assistant", timestamp: at(12), message: { role: "assistant", content: [{ type: "text", text: "On it." }] } },
};
const jsonl = (list) => list.map((e) => JSON.stringify(e)).join("\n") + "\n";

function fixture(list = Object.values(entries)) {
  const dir = mkdtempSync(join(tmpdir(), "asks-"));
  const transcript = join(dir, "session.jsonl");
  writeFileSync(transcript, jsonl(list));
  return { dir: join(dir, "asks"), transcript, session: "sess-1" };
}

function run(fx, mode, { raw, timing, ...extra } = {}) {
  const payload = { session_id: fx.session, transcript_path: fx.transcript, cwd: tmpdir(), ...extra };
  const env = { ...process.env, OPERATOR_ASKS_DIR: fx.dir, ...(timing ? { OPERATOR_ASKS_TIMING: "1" } : {}) };
  const r = spawnSync(process.execPath, [SCRIPT, mode], { input: raw ?? JSON.stringify(payload), env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** The recorded asks, read back from the machine-local file: [{ ts, kind, text }]. */
function recorded(fx) {
  const file = join(fx.dir, `${fx.session}.md`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.match(/^- (\S+) (typed|mid-turn) (".*")$/))
    .filter(Boolean)
    .map(([, ts, kind, json]) => ({ ts, kind, text: JSON.parse(json) }));
}

test("only the operator's own words come out, verbatim: a typed prompt and a mid-turn message", () => {
  const fx = fixture();
  const r = run(fx, "--refresh");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(recorded(fx), [
    { ts: at(10), kind: "typed", text: TYPED },
    { ts: at(11), kind: "mid-turn", text: MID_TURN },
  ]);
});

test("--refresh prints nothing to stdout (UserPromptSubmit stdout is added to the model's context)", () => {
  const fx = fixture();
  const r = run(fx, "--refresh");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
  assert.equal(recorded(fx).length, 2, "silent, not idle: the refresh must still record");
});

test("a typed slash command records as the command and its arguments", () => {
  const cmd = { type: "user", origin: { kind: "human" }, timestamp: at(9), message: { role: "user", content: "<command-message>loop</command-message>\n<command-name>/loop</command-name>\n<command-args>5m check the deploy</command-args>" } };
  const fx = fixture([cmd]);
  run(fx, "--refresh");
  assert.deepEqual(recorded(fx).map((a) => a.text), ["/loop 5m check the deploy"]);
});

test("incremental and append-only: a rerun adds nothing, new lines append, a duplicate is dropped, a half-written line waits", () => {
  const fx = fixture();
  run(fx, "--refresh");
  const file = join(fx.dir, `${fx.session}.md`);
  const before = readFileSync(file, "utf8");
  run(fx, "--refresh");
  assert.equal(readFileSync(file, "utf8"), before, "a rerun with no new transcript lines must change nothing");
  const next = { ...entries.typed, timestamp: at(12), message: { role: "user", content: "and merge it after green" } };
  appendFileSync(fx.transcript, jsonl([entries.typed, next]) + JSON.stringify({ ...next, message: { role: "user", content: "half" } }).slice(0, 40));
  run(fx, "--refresh");
  const after = readFileSync(file, "utf8");
  assert.ok(after.startsWith(before), "existing lines must never be rewritten");
  assert.deepEqual(recorded(fx).map((a) => a.text), [TYPED, MID_TURN, "and merge it after green"]);
  // The dedupe would hide a refresh that rereads from byte 0, so pin the offset itself: it stops at the last newline.
  const raw = readFileSync(fx.transcript);
  const offset = () => JSON.parse(readFileSync(join(fx.dir, `${fx.session}.state.json`), "utf8")).offset;
  assert.equal(offset(), raw.lastIndexOf(10) + 1, "the offset must stop before the half-written line");
  appendFileSync(fx.transcript, JSON.stringify({ ...next, message: { role: "user", content: "half" } }).slice(40) + "\n");
  run(fx, "--refresh");
  assert.deepEqual(recorded(fx).map((a) => a.text).at(-1), "half", "the completed line must be read once it ends");
  assert.equal(offset(), readFileSync(fx.transcript).length);
});

test("a refresh reads only bytes past the stored offset (bytes already read are never parsed again)", () => {
  const first = { ...entries.typed, message: { role: "user", content: "aaaa" } };
  const fx = fixture([first]);
  run(fx, "--refresh");
  // Same size, different old bytes: a reader that starts over at 0 would now record "bbbb".
  writeFileSync(fx.transcript, jsonl([{ ...first, message: { role: "user", content: "bbbb" } }]));
  run(fx, "--refresh");
  assert.deepEqual(recorded(fx).map((a) => a.text), ["aaaa"]);
});

test("mention is not structure: an operator message quoting the pre-filter's keys is still recorded", () => {
  const quoting = { ...entries.typed, message: { role: "user", content: 'why does {"toolUseResult": 1, "type":"user", "isMeta":true} show up?' } };
  const fx = fixture([quoting]);
  run(fx, "--refresh");
  assert.deepEqual(recorded(fx).map((a) => a.text), [quoting.message.content]);
});

test("<private>...</private> never reaches the asks file or the recall block; a backtick-quoted mention is kept", () => {
  const typed = (h, content) => ({ ...entries.typed, timestamp: at(h), message: { role: "user", content } });
  const queued = (h, prompt) => ({ ...entries.midTurn, timestamp: at(h), attachment: { ...entries.midTurn.attachment, prompt, timestamp: at(h) } });
  const fx = fixture([
    typed(1, "pay with <private>card ending 4421</private> today"),
    queued(2, "same <private >card ending 4421</private > for the tires"), // a stray space inside the tag still counts
    typed(3, "call me at <private>216 555 0100 after 5\nor email me"), // unclosed: redacted to the end of the message
    queued(4, "price is <PRIVATE>$640</PRIVATE> cash"),
    typed(5, "does the `<private>` tag work in asks?"), // a mention, not a tag
    typed(6, "quote `<private>` then hide <private>gate code 1987</private> ok"), // a mention does not switch the rule off
    typed(7, "stray ` here\n<private>pin 7788</private>\nand ` there"), // backticks on two lines are not a quote
    // (inputs below do not open with the tag: a message that starts with an HTML-like tag is skipped as machine text)
    typed(8, "see <private>acct <private>pin 3141</private> ssn 2718</private> tail"), // nested: the outer close ends it
    typed(9, 'sent <private reason="x">code 5150</private> ok, <privateX> stays'), // attributes count; another tag name does not
    queued(10, "pin is 4455</private> thanks"), // a stray close redacts back to the start of the message
    typed(11, "a <private>pin 6061</private> b 9911</private> c"), // ...or back to the previous redaction
    typed(12, "x <private>card <private>pin 8080</private> exp 1229"), // nested, outer never closed: runs to the end
  ]);
  assert.equal(run(fx, "--refresh").code, 0);
  assert.deepEqual(recorded(fx).map((a) => a.text), [
    "pay with [private: redacted] today",
    "same [private: redacted] for the tires",
    "call me at [private: redacted]",
    "price is [private: redacted] cash",
    "does the `<private>` tag work in asks?",
    "quote `<private>` then hide [private: redacted] ok",
    "stray ` here\n[private: redacted]\nand ` there",
    "see [private: redacted] tail",
    "sent [private: redacted] ok, <privateX> stays",
    "[private: redacted] thanks",
    "a [private: redacted] c",
    "x [private: redacted]",
  ]);
  const file = readFileSync(join(fx.dir, `${fx.session}.md`), "utf8");
  const recall = run(fx, "--recall", { source: "compact" }).out;
  assert.match(recall, /pay with \[private: redacted\] today/, "the recall block reads the redacted line");
  assert.match(recall, /does the `<private>` tag work in asks\?/);
  for (const secret of ["4421", "216 555 0100", "or email me", "$640", "1987", "7788", "2718", "5150", "4455", "6061", "9911", "1229", "</private>"]) {
    assert.ok(!file.includes(secret), `asks file holds "${secret}"`);
    assert.ok(!recall.includes(secret), `recall block holds "${secret}"`);
  }
});

test("--recall on compact and resume prints the block; startup and clear print nothing", () => {
  const fx = fixture();
  for (const source of ["compact", "resume"]) {
    const r = run(fx, "--recall", { source });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`Operator asks this session \\(verbatim, oldest first; 2 total; full list: .*${fx.session}\\.md\\)`));
    assert.ok(r.out.indexOf("fix those antislop issues too") < r.out.indexOf("also lets get a reel"), "oldest first");
    assert.match(r.out, /why ignore them\?/, "the whole message, its second line included");
  }
  for (const source of ["startup", "clear"]) assert.equal(run(fx, "--recall", { source }).out, "", source);
});

test("--recall refreshes first: a message typed after the last refresh still shows", () => {
  const fx = fixture([entries.typed]);
  run(fx, "--refresh");
  appendFileSync(fx.transcript, jsonl([entries.midTurn]));
  assert.match(run(fx, "--recall", { source: "compact" }).out, /also lets get a reel/);
});

test("--recall shows the last 24 h, each line cut at 240 chars, older ones counted, and stays under 6 KB", () => {
  const old = { ...entries.typed, timestamp: "2026-10-15T08:00:00.000Z", message: { role: "user", content: "an instruction from two days ago" } };
  const long = { ...entries.typed, timestamp: at(12), message: { role: "user", content: `start ${"x".repeat(400)} TAIL` } };
  const fx = fixture([old, entries.typed, long]);
  const out = run(fx, "--recall", { source: "compact" }).out;
  assert.match(out, /3 total/);
  assert.doesNotMatch(out, /two days ago/, "a message older than 24 h is counted, not shown");
  assert.match(out, /1 older message not shown/);
  assert.doesNotMatch(out, /TAIL/, "a long message is cut at 240 chars");
  const many = Array.from({ length: 80 }, (_, i) => ({ ...entries.typed, timestamp: at(12), message: { role: "user", content: `ask ${i} ${"y".repeat(300)}` } }));
  const big = fixture(many);
  const block = run(big, "--recall", { source: "compact" }).out;
  assert.ok(Buffer.byteLength(block) <= 6 * 1024, `block is ${Buffer.byteLength(block)} bytes`);
  assert.match(block, /ask 79 /, "the newest asks survive the cap");
  assert.match(block, /older message[s]? not shown|over the 6 KB cap/);
});

test("fails OPEN: garbage stdin, no session, a missing transcript all exit 0 with nothing on stdout", () => {
  const fx = fixture();
  for (const mode of ["--refresh", "--recall"]) {
    for (const extra of [{ raw: "{not json" }, { raw: JSON.stringify({ transcript_path: fx.transcript, source: "compact" }) }, { transcript_path: join(fx.dir, "nope.jsonl"), source: "startup" }]) {
      const r = run(fx, mode, extra);
      assert.equal(r.code, 0, `${mode} ${JSON.stringify(extra)}: ${r.err}`);
      assert.equal(r.out, "", `${mode} ${JSON.stringify(extra)}`);
    }
  }
  const r = run(fx, "--refresh", { transcript_path: join(fx.dir, "nope.jsonl") });
  assert.equal(r.code, 0);
  const blocked = { ...fixture(), dir: fx.transcript }; // the asks "dir" is a file: every write throws
  for (const [mode, extra] of [["--refresh", {}], ["--recall", { source: "compact" }]]) {
    const b = run(blocked, mode, extra);
    assert.equal(b.code, 0, `${mode} must fail open on an unwritable asks dir`);
    assert.equal(b.out, "", mode);
    assert.match(b.err, /operator-asks refresh failed/, `${mode}: the failure must stay visible on stderr`);
  }
});

test("never writes inside the repo: the file lands in the configured machine-local dir", () => {
  const fx = fixture();
  run(fx, "--refresh");
  assert.ok(existsSync(join(fx.dir, `${fx.session}.md`)));
});

test("speed: an incremental refresh after a large transcript reads only the new bytes (under 300 ms of script time)", () => {
  const filler = { type: "assistant", timestamp: at(12), message: { role: "assistant", content: [{ type: "text", text: "z".repeat(4000) }] } };
  const toolRes = { ...entries.toolResult, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "q".repeat(4000) }] } };
  const fx = fixture([entries.typed, ...Array.from({ length: 2500 }, (_, i) => (i % 2 ? filler : toolRes))]); // about 20 MB
  run(fx, "--refresh");
  appendFileSync(fx.transcript, jsonl([entries.midTurn]));
  const r = run(fx, "--refresh", { timing: true });
  const ms = Number(r.err.match(/operator-asks refresh (\d+) ms/)?.[1]);
  assert.ok(ms >= 0, `no timing line on stderr: ${r.err}`);
  assert.ok(ms < 300, `incremental refresh took ${ms} ms`);
  assert.equal(recorded(fx).length, 2);
});
