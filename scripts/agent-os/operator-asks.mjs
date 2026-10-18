#!/usr/bin/env node
/**
 * Operator asks survive compaction (job 2026-10-17-sticky-operator-asks).
 *
 * WHY. A compaction summary is written from the model's memory of the session, and it drops the operator's own words,
 * above all the messages typed while a turn was running: those are stored as `queued_command` attachments, not as user
 * messages (81 such messages across sessions since 2026-10-14, several of them real instructions). After compaction
 * nothing showed the operator's words again. This script keeps them, verbatim, outside the context window.
 *
 *   node operator-asks.mjs --refresh   UserPromptSubmit, PreCompact: append new operator messages to the asks file. Silent.
 *   node operator-asks.mjs --recall    SessionStart (compact|resume): refresh, then print the recent asks.
 *
 * What counts as the operator speaking (everything else in the transcript is skipped):
 *   - a `type: "user"` entry that is not meta, a compaction summary, a sidechain (a lane brief) or a tool result, whose
 *     origin (else turnOrigin) is absent or `human`, and whose text, once `<system-reminder>` blocks are removed, does not open with a
 *     machine tag (task-notification, cross-session-message, ci-monitor-event, local-command-*); a typed slash command
 *     is kept as "/name args";
 *   - a `queued_command` attachment whose `origin.kind` is `human`: a message typed while a turn was running.
 *
 * The file: %LOCALAPPDATA%/nourcity/asks/<session_id>.md (OPERATOR_ASKS_DIR overrides), one line per message,
 * `- <timestamp> <typed|mid-turn> "<text as a JSON string>"`, deduped on the text, append-only. A sidecar
 * <session_id>.state.json holds the transcript byte offset already read, so a refresh reads only new bytes.
 * PRIVACY: the operator's words stay machine-local. Nothing here writes inside the repo or calls the network.
 * Text he wraps in <private>...</private> is stored and recalled as `[private: redacted]` (redactPrivate, AGENTS.md).
 * FAILURE POSTURE: like every agent-os hook, a bug here fails OPEN: exit 0, a note on stderr, nothing blocks.
 * Canaries: operatorAsks.test.mjs (extraction, refresh, recall, caps, speed) and hookCommand.test.mjs (wiring).
 */
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const RECALL_BYTES = 6 * 1024;
export const LINE_CHARS = 240;
const WINDOW_MS = 24 * 3600 * 1000;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
// shortcut: a typed message that itself opens with an HTML-like tag is skipped as machine text; widen only if one is lost.
const MACHINE = /^(?:<(?!command-)[a-z][\w-]*[\s>]|Another Claude session sent a message:|\[Request interrupted)/;

export const asksDir = (env = process.env) =>
  env.OPERATOR_ASKS_DIR || join(env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "asks");

const textOf = (content) =>
  (typeof content === "string" ? content : Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => p.text).join("\n") : "")
    .replace(REMINDER, "")
    .trim();

// A single-line backtick span is a mention and is kept whole, so a quoted `<private>` never opens a redaction.
// shortcut: a secret the operator wraps in backticks AND the tag is kept; drop the code-span arm if that ever happens.
const PRIVATE_TOKEN = /(`[^`\n]*`)|(<private(?:\s[^>]*)?>)|<\/private\s*>/gi;
const REDACTED = "[private: redacted]";

/**
 * `<private>...</private>` -> `[private: redacted]`, so it is never stored. Any case, attributes allowed, nested tags
 * end at the outer close, an unclosed tag runs to the end, and a stray close redacts back to the previous redaction
 * (or the start): every malformed shape errs toward hiding more.
 */
export function redactPrivate(text) {
  let out = "";
  let depth = 0;
  let at = 0;
  let mark = -1; // out.length just after the last REDACTED, -1 before the first
  for (const m of text.matchAll(PRIVATE_TOKEN)) {
    const before = text.slice(at, m.index);
    at = m.index + m[0].length;
    if (depth > 0) {
      if (m[2]) depth++;
      else if (!m[1] && --depth === 0) mark = (out += REDACTED).length;
      continue; // a code span inside a redaction is redacted with it
    }
    out += before;
    if (m[1]) out += m[0];
    else if (m[2]) depth = 1;
    else mark = (out = mark < 0 ? REDACTED : out.slice(0, mark)).length; // stray close
  }
  return depth > 0 ? out + REDACTED : out + text.slice(at);
}

function spoken(text) {
  if (!text || MACHINE.test(text)) return null;
  const name = text.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim();
  if (!name) return text;
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
  return `${name.startsWith("/") ? name : `/${name}`} ${args}`.trim();
}

/** One transcript entry -> { ts, kind, text } when it is the operator speaking, else null. */
export function operatorAsk(e) {
  if (e?.type === "attachment") {
    const a = e.attachment;
    if (a?.type !== "queued_command" || a.origin?.kind !== "human") return null;
    const text = spoken(textOf(a.prompt));
    return text && { ts: a.timestamp ?? e.timestamp ?? "", kind: "mid-turn", text: redactPrivate(text) };
  }
  if (e?.type !== "user" || e.isMeta || e.isCompactSummary || e.isSidechain || e.toolUseResult !== undefined) return null;
  // An entry with no `origin` may still carry `turnOrigin`: "sdk" opens a session another session started (its brief is
  // model-written), "scheduled" is a /loop re-fire. Both seen live 2026-10-15/16.
  const who = e.origin?.kind ?? e.turnOrigin;
  if (who !== undefined && who !== "human") return null;
  const text = spoken(textOf(e.message?.content));
  return text && { ts: e.timestamp ?? "", kind: "typed", text: redactPrivate(text) };
}

/** Bytes from `offset` to the last complete line. A half-written last line is left for the next read. */
function readNewLines(path, offset) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size < offset) offset = 0; // the transcript was rewritten: rescan, the dedupe absorbs repeats
    const buf = Buffer.alloc(size - offset);
    for (let got = 0; got < buf.length; ) {
      const n = readSync(fd, buf, got, buf.length - got, offset + got);
      if (!n) break;
      got += n;
    }
    const end = buf.lastIndexOf(10);
    if (end < 0) return { lines: [], offset };
    return { lines: buf.subarray(0, end).toString("utf8").split("\n"), offset: offset + end + 1 };
  } finally {
    closeSync(fd);
  }
}

/** The asks already recorded, oldest first: [{ ts, kind, text }]. */
export function readAsks(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^- (\S+) (typed|mid-turn) (".*")$/);
    if (m) out.push({ ts: m[1], kind: m[2], text: JSON.parse(m[3]) });
  }
  return out;
}

export function refresh({ session, transcript, dir }) {
  const file = join(dir, `${session}.md`);
  const stateFile = join(dir, `${session}.state.json`);
  let state = {};
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {}
  const from = state.transcript === transcript ? Number(state.offset) || 0 : 0;
  const { lines, offset } = readNewLines(transcript, from);
  const seen = new Set(readAsks(file).map((a) => a.text));
  const added = [];
  for (const line of lines) {
    // Cheap skip before JSON.parse: only user entries and queued commands can hold an ask. `"toolUseResult":` can only
    // appear unescaped as a key (inside a string its quotes are escaped), so it marks a tool result, never a prompt.
    if (!(line.includes('"type":"user"') || line.includes('"queued_command"')) || line.includes('"toolUseResult":')) continue;
    let ask = null;
    try {
      ask = operatorAsk(JSON.parse(line));
    } catch {}
    // shortcut: dedupe is on the exact text, so a repeated "yes" is kept once; key on the entry uuid if repeats matter.
    if (!ask || seen.has(ask.text)) continue;
    seen.add(ask.text);
    added.push(`- ${ask.ts || "unknown-time"} ${ask.kind} ${JSON.stringify(ask.text)}\n`);
  }
  mkdirSync(dir, { recursive: true });
  if (added.length) {
    if (!existsSync(file)) writeFileSync(file, `# Operator asks, session ${session} (machine-local, scripts/agent-os/operator-asks.mjs)\n\n`);
    appendFileSync(file, added.join(""));
  }
  writeFileSync(stateFile, JSON.stringify({ transcript, offset }));
  return { file, added: added.length };
}

/** The SessionStart block: every ask within 24 h of the newest one, oldest first, each cut at 240 chars, under 6 KB. */
export function recallBlock(file, cap = RECALL_BYTES) {
  const asks = readAsks(file);
  if (!asks.length) return "";
  const newest = Math.max(...asks.map((a) => Date.parse(a.ts) || 0));
  const line = (a) => {
    const flat = a.text.replace(/\s*\r?\n\s*/g, " / ");
    return `- ${a.ts} ${a.kind}: ${flat.length > LINE_CHARS ? `${flat.slice(0, LINE_CHARS)}...` : flat}`;
  };
  // Anchored on the newest ask, not the clock, so a session resumed days later still shows its last day of asks.
  let shown = asks.filter((a) => newest - (Date.parse(a.ts) || 0) <= WINDOW_MS).map(line);
  const head = `Operator asks this session (verbatim, oldest first; ${asks.length} total; full list: ${file})`;
  const build = () => {
    const hidden = asks.length - shown.length;
    const note = hidden ? [`${hidden} older message${hidden === 1 ? "" : "s"} not shown (older than 24 h or over the 6 KB cap): read the full list.`] : [];
    return [head, ...note, ...shown].join("\n") + "\n";
  };
  while (shown.length && Buffer.byteLength(build()) > cap) shown = shown.slice(1); // drop the oldest first
  return build();
}

export function main(argv = process.argv.slice(2), stdinText = readFileSync(0, "utf8"), env = process.env) {
  const t0 = performance.now();
  let payload = {};
  try {
    payload = JSON.parse(stdinText || "{}") || {};
  } catch {
    return 0;
  }
  const session = String(payload.session_id ?? "").replace(/[^\w.-]/g, "");
  if (!session) return 0;
  const recall = argv.includes("--recall");
  if (recall && !["compact", "resume"].includes(payload.source)) return 0;
  const dir = asksDir(env);
  if (payload.transcript_path && existsSync(payload.transcript_path)) {
    try {
      refresh({ session, transcript: payload.transcript_path, dir });
    } catch (err) {
      process.stderr.write(`[agent-os] operator-asks refresh failed (no effect on the session): ${err?.message ?? err}\n`);
    }
  }
  if (env.OPERATOR_ASKS_TIMING) process.stderr.write(`[agent-os] operator-asks refresh ${Math.round(performance.now() - t0)} ms\n`);
  if (recall) process.stdout.write(recallBlock(join(dir, `${session}.md`)));
  return 0;
}

if (process.argv[1] && /operator-asks\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`[agent-os] operator-asks error (allowing): ${err?.message ?? err}\n`);
    process.exitCode = 0;
  }
}
