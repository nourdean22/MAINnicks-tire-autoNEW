#!/usr/bin/env node
/**
 * Stop hook: a working turn must invoke a skill (job 2026-10-17-sticky-operator-asks, deliverable 5).
 *
 * WHY. Nour, 2026-10-17: "the harness needs to be done so it worked forever and i dont have to ask why u arent using
 * skills". The always-on skills were advice only (SessionStart and UserPromptSubmit print reminders) and sessions still
 * skipped the Skill calls. This makes it mechanical at the one moment it can be checked: the end of the turn.
 *
 * Rule. Read the transcript from the END back to the turn's prompt (the last user entry that is not a tool result, meta,
 * a compaction summary, a sidechain or a task notification). If the turn ran any tool other than Skill (the app's
 * mcp__ccd_turn__* bookkeeping does not count) and EITHER no Skill call happened since that prompt OR, after a compaction,
 * none of the always-on set was invoked since the compaction: block the stop (exit 2) with a stderr line naming the
 * always-on set plus the skills skill-recall printed for this prompt (read back from its UserPromptSubmit attachment).
 * ONCE per prompt: the block is recorded under session + prompt id, so the second stop goes through; a Stop already
 * continuing because of a Stop hook (`stop_hook_active`) always goes through. Conversation turns stay silent.
 *
 * Cost: lines are read newest-first in 1 MB chunks and only lines that can matter are parsed; the turn alone is read
 * unless a compaction must be looked for. State: %LOCALAPPDATA%/nourcity/skills-check/<session>.json (SKILLS_CHECK_DIR).
 * FAILURE POSTURE: fails OPEN (exit 0) on its own errors, and never blocks when it cannot record the one-shot.
 * Canaries: skillsCheck.test.mjs (rules, controls, speed, drift) and hookCommand.test.mjs (the configured command).
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The core always-on set (CLAUDE-OPERATING-PROFILE.md); skillsCheck.test.mjs keeps it inside skill-recall's ALWAYS_ON.
export const ALWAYS_ON = ["using-superpowers", "ponytail", "karpathy-guidelines", "i-have-adhd", "verification-before-completion"];
const CHUNK = 1 << 20;
// shortcut: a turn or a compaction search longer than this is not judged (allowed); raise it if long turns slip through.
const MAX_SCAN = 24 << 20;
const BOOKKEEPING = /^mcp__ccd_turn__/;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

const stateDir = (env) => env.SKILLS_CHECK_DIR || join(env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "skills-check");
const parse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/** Transcript lines, newest first, reading at most `maxBytes` back from the end. */
export function* linesFromEnd(path, maxBytes = MAX_SCAN) {
  const fd = openSync(path, "r");
  try {
    let pos = fstatSync(fd).size;
    const stop = Math.max(0, pos - maxBytes);
    let carry = Buffer.alloc(0);
    while (pos > stop) {
      const n = Math.min(CHUNK, pos - stop);
      pos -= n;
      const buf = Buffer.alloc(n);
      for (let got = 0; got < n; ) {
        const r = readSync(fd, buf, got, n - got, pos + got);
        if (!r) break;
        got += r;
      }
      const data = Buffer.concat([buf, carry]);
      const first = pos > 0 ? data.indexOf(10) : -1; // bytes before the first newline may continue an earlier line
      if (pos > 0 && first < 0) {
        carry = data;
        continue;
      }
      carry = first >= 0 ? data.subarray(0, first) : Buffer.alloc(0);
      const lines = data.subarray(first + 1).toString("utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) if (lines[i]) yield lines[i];
    }
  } finally {
    closeSync(fd);
  }
}

const textOf = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p?.text ?? "").join("") : "").replace(REMINDER, "").trim();

function isPrompt(e) {
  if (e?.type !== "user" || e.isMeta || e.isCompactSummary || e.isSidechain || e.toolUseResult !== undefined) return false;
  if (/task.notification/.test(`${e.origin?.kind ?? ""} ${e.turnOrigin ?? ""}`)) return false;
  const c = e.message?.content;
  if (Array.isArray(c) && c.some((p) => p?.type === "tool_result")) return false;
  const text = textOf(c);
  return Boolean(text) && !text.startsWith("[Request interrupted");
}

/** Judge the newest turn from lines given newest first. */
export function judge(lines) {
  const tools = [];
  let prompt = null;
  let skill = false;
  let alwaysOnSeen = false;
  let compactWithoutAlwaysOn = null; // null: no compaction found; true/false: was an always-on skill invoked after it
  let recall = [];
  for (const line of lines) {
    // Substrings only pick which lines to parse (speed); every decision below is made on the parsed entry.
    const candidate =
      line.includes('"compact_boundary"') || line.includes('"isCompactSummary":true') || line.includes('"type":"tool_use"') ||
      (!prompt && (line.includes("[skill-recall] invoke:") || (line.includes('"type":"user"') && !line.includes('"toolUseResult":'))));
    const e = candidate ? parse(line) : null;
    if (!e) continue;
    if (e.subtype === "compact_boundary" || e.isCompactSummary) {
      compactWithoutAlwaysOn ??= !alwaysOnSeen;
      if (prompt) break;
      continue;
    }
    if (e.type === "assistant") {
      for (const p of e.message?.content ?? []) {
        if (p?.type !== "tool_use") continue;
        if (p.name === "Skill") {
          if (ALWAYS_ON.includes(String(p.input?.skill ?? "").replace(/^.*:/, ""))) alwaysOnSeen = true;
          if (!prompt) skill = true;
        } else if (!prompt && !BOOKKEEPING.test(p.name)) tools.push(p.name);
      }
      if (prompt && alwaysOnSeen) break; // an always-on call newer than any compaction: re-armed
      continue;
    }
    if (prompt) continue;
    if (e.type === "attachment") {
      const text = String(e.attachment?.content || e.attachment?.stdout || "");
      // The newest-first scan overwrites, so the attachment nearest the prompt (its own recall) is the one kept.
      if (text.includes("[skill-recall] invoke:")) recall = [...text.matchAll(/\[skill-recall\] invoke: ([\w:.-]+)/g)].map((m) => m[1]);
      continue;
    }
    // A skill loaded by a typed /command has no Skill tool_use, only its body as a meta entry.
    const loaded = e.isMeta && textOf(e.message?.content).match(/^Base directory for this skill: .*[\\/]([^\\/\s]+)\s*$/m)?.[1];
    if (loaded) {
      skill = true;
      if (ALWAYS_ON.includes(loaded)) alwaysOnSeen = true;
      continue;
    }
    if (!isPrompt(e)) continue;
    prompt = e;
    // Past the prompt only a compaction search remains, needed only when this turn's Skill calls might not re-arm.
    if (!tools.length || !skill || alwaysOnSeen || compactWithoutAlwaysOn !== null) break;
  }
  return { prompt, tools, skill, compactWithoutAlwaysOn, recall };
}

export function main(stdinText, env = process.env) {
  const t0 = performance.now();
  const payload = parse(stdinText || "{}") ?? {};
  if (payload.stop_hook_active) return 0;
  const session = String(payload.session_id ?? "").replace(/[^\w.-]/g, "");
  if (!session || !payload.transcript_path || !existsSync(payload.transcript_path)) return 0;
  const v = judge(linesFromEnd(payload.transcript_path));
  if (env.SKILLS_CHECK_TIMING) process.stderr.write(`[agent-os] skills-check ${Math.round(performance.now() - t0)} ms\n`);
  if (!v.prompt || !v.tools.length) return 0;
  const afterCompaction = v.skill && v.compactWithoutAlwaysOn === true;
  if (v.skill && !afterCompaction) return 0;

  const key = String(v.prompt.promptId ?? v.prompt.uuid ?? v.prompt.timestamp ?? "");
  const file = join(stateDir(env), `${session}.json`);
  try {
    if (JSON.parse(readFileSync(file, "utf8")).key === key) return 0; // already blocked once for this prompt
  } catch {}
  try {
    mkdirSync(stateDir(env), { recursive: true });
    writeFileSync(file, JSON.stringify({ key, at: new Date().toISOString() }));
  } catch {
    return 0; // a block it cannot remember could repeat: never block blind
  }
  const names = [...new Set([...ALWAYS_ON, ...v.recall])];
  const counts = Object.entries(v.tools.reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}))
    .map(([t, n]) => (n > 1 ? `${t} x${n}` : t))
    .join(", ");
  process.stderr.write(
    `[skills-check] This turn ran tools (${counts}) and ${afterCompaction ? "no always-on skill was invoked since the last compaction" : "no Skill call since the prompt"}. ` +
      `Before ending the turn, invoke with the Skill tool: ${names.join(", ")}; check what you just did against them, fix what they catch, then finish. ` +
      "This blocks once per prompt; the next stop goes through.\n",
  );
  return 2;
}

if (process.argv[1] && /skills-check\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    process.exitCode = main(readFileSync(0, "utf8"));
  } catch (err) {
    process.stderr.write(`[agent-os] skills-check error (allowing the stop): ${err?.message ?? err}\n`);
    process.exitCode = 0;
  }
}
