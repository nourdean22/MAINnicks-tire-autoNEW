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
 * Turn truth (2026-10-22, job manager-skill-best; Nour: "if you catch yourself making mistakes ... fix it forever"). The
 * reply's own claims are compared with the turn's tool calls, in the same one-shot block, even on a turn with no tools:
 *   1. its LAST `Skills:` line: every name on it that is a real skill (a directory under the project's or the user's
 *      .claude/skills, or any ns:name) needs a Skill call or a slash-loaded body since the prompt. Text in parentheses,
 *      after "used earlier", after "Tools:", and a line starting "none" claim nothing (the manager named uninvoked
 *      skills on 33 of 86 such lines on 2026-10-22).
 *   2. a clause calling CI, checks or a PR green, passing or mergeable, with no hedge (not, once, until, still, will, ...),
 *      needs a CI read this turn: `gh pr checks|view|status`, `gh run list|view|watch`, merge-gate.mjs,
 *      mcp__ccd_pr__get_status, or a prompt that is the app's <ci-monitor-event> (answer-first: a CI state is the tally
 *      read THIS turn; the manager wrote "All 4 remaining PRs are green" from an earlier read on 2026-10-21).
 *   3. a clause calling something live ("is live", "went live") with no hedge needs a production read this turn: a tool
 *      call naming /api/health, a heartbeat, a Railway status/logs/deployment read or either production domain, or a
 *      deployment/log MCP tool. Merge is not deploy (monorepo-manager step on reporting).
 * The reply text is the Stop payload's last_assistant_message (the docs: the transcript may not hold the final message
 * yet), else the newest assistant text in the turn. Known names: SKILLS_CHECK_SKILL_DIRS (path list) for tests.
 *
 * Cost: lines are read newest-first in 1 MB chunks and only lines that can matter are parsed; the turn alone is read
 * unless a compaction must be looked for. State: %LOCALAPPDATA%/nourcity/skills-check/<session>.json (SKILLS_CHECK_DIR).
 * FAILURE POSTURE: fails OPEN (exit 0) on its own errors, and never blocks when it cannot record the one-shot.
 * Canaries: skillsCheck.test.mjs (rules, controls, speed, drift) and hookCommand.test.mjs (the configured command).
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

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
  const invoked = new Set(); // bare skill names invoked (Skill call or slash-loaded body) since the prompt
  let finalText = null; // the newest assistant text of the turn
  let ciRead = false;
  let liveRead = false;
  for (const line of lines) {
    // Substrings only pick which lines to parse (speed); every decision below is made on the parsed entry.
    const candidate =
      line.includes('"compact_boundary"') || line.includes('"isCompactSummary":true') || line.includes('"type":"tool_use"') ||
      (!prompt && finalText === null && line.includes('"type":"assistant"') && line.includes('"type":"text"')) ||
      (!prompt && (line.includes("[skill-recall] invoke:") || (line.includes('"type":"user"') && !line.includes('"toolUseResult":'))));
    const e = candidate ? parse(line) : null;
    if (!e) continue;
    if (e.subtype === "compact_boundary" || e.isCompactSummary) {
      compactWithoutAlwaysOn ??= !alwaysOnSeen;
      if (prompt) break;
      continue;
    }
    if (e.type === "assistant") {
      const parts = e.message?.content ?? [];
      if (!prompt && finalText === null) finalText = [...parts].reverse().find((p) => p?.type === "text" && p.text?.trim())?.text ?? null;
      for (const p of parts) {
        if (p?.type !== "tool_use") continue;
        if (p.name === "Skill") {
          const name = String(p.input?.skill ?? "").replace(/^.*:/, "");
          if (ALWAYS_ON.includes(name)) alwaysOnSeen = true;
          if (!prompt) {
            skill = true;
            invoked.add(name);
          }
        } else if (!prompt && !BOOKKEEPING.test(p.name)) {
          tools.push(p.name);
          if (isCiRead(p)) ciRead = true;
          if (isLiveRead(p)) liveRead = true;
        }
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
      invoked.add(loaded);
      if (ALWAYS_ON.includes(loaded)) alwaysOnSeen = true;
      continue;
    }
    if (!isPrompt(e)) continue;
    prompt = e;
    if (/<ci-monitor-event>/.test(textOf(e.message?.content))) ciRead = true; // the app's CI report is the read
    // Past the prompt only a compaction search remains, needed only when this turn's Skill calls might not re-arm.
    if (!tools.length || !skill || alwaysOnSeen || compactWithoutAlwaysOn !== null) break;
  }
  return { prompt, tools, skill, compactWithoutAlwaysOn, recall, invoked, finalText, ciRead, liveRead };
}

// -- Turn truth ------------------------------------------------------------------------------------------------------
const CI_READ_CMD = /\bgh\s+(?:pr\s+(?:checks|view|status)|run\s+(?:list|view|watch))\b|merge-gate\.mjs/;
function isCiRead(p) {
  if (p.name === "mcp__ccd_pr__get_status") return true;
  const cmd = p.input?.command;
  return typeof cmd === "string" && CI_READ_CMD.test(cmd);
}

/** Bare skill names the reply's last `Skills:` line claims: known skill names and any ns:name, nothing else. */
export function claimedSkills(text, known) {
  let line = null;
  for (const l of String(text ?? "").split(/\r?\n/)) {
    const m = /^[\s>*_`-]*skills[*_`]*\s*:\s*(.*)$/i.exec(l);
    if (m) line = m[1];
  }
  if (line === null) return [];
  // The claim list ends at its sentence; names after "skipped" / "not invoked" are the opposite of a claim.
  line = line.split(/\btools\s*:/i)[0].replace(/\([^)]*\)/g, " ").split(/\.(?:\s|$)/)[0];
  line = line.split(/\b(?:used earlier|skipped|skipping|not invoked|not used|did not|didn't)\b/i)[0];
  if (/^[\s*_`]*none\b/i.test(line)) return [];
  const out = new Set();
  for (const raw of line.split(/[\s,;|]+/)) {
    const tok = raw.replace(/^[^\w]+|[^\w]+$/g, "");
    const name = tok.replace(/^.*:/, "");
    if (name && (/^[\w-]+:[\w-]+$/.test(tok) || known.has(name))) out.add(name);
  }
  return [...out];
}

// A claim, not a plan or a negation: the clause before the match (and the match) carries no hedge word. The nouns cover
// the manager's real wording on 2026-10-21/22 ("All 4 remaining PRs are green", "CI 4 passed, 0 failed").
const CI_CLAIM = /\b(?:CI|checks?|PRs?|PR\s*#?\d{3,5}|#\d{3,5})\b[^.\n|]{0,40}?\b(?:green|passed|passing|succeeded|mergeable)\b|\b(?:green|passing)\s+CI\b/gi;
const LIVE_CLAIM = /\b(?:is|are|now|went)\s+live\b/gi;
const HEDGE = /\b(?:not|no|nothing|none|neither|never|yet|until|once|when|if|after|before|still|pending|running|waiting|red|cancelled|will|should)\b|n't\b/i;
const HEDGE_AFTER = /^[\s*_`]*(?:yet|soon|later|tomorrow|once|when|after|until)\b/i; // "is live yet", "green once ..."
function claims(text, re) {
  const s = String(text ?? "");
  for (const m of s.matchAll(re)) {
    const clauseStart = Math.max(...[".", "\n", ";", "|"].map((c) => s.lastIndexOf(c, m.index))) + 1;
    const end = m.index + m[0].length;
    if (!HEDGE.test(s.slice(clauseStart, end)) && !HEDGE_AFTER.test(s.slice(end, end + 20))) return true;
  }
  return false;
}
export const claimsCiGreen = (text) => claims(text, CI_CLAIM);
export const claimsLive = (text) => claims(text, LIVE_CLAIM);
// A live read: the app's health or heartbeat, a deploy listing or log read, or a fetch of either production site.
const LIVE_READ_CMD = /\/api\/health|heartbeat|railway\s+(?:status|logs|deployment)|nickstire\.org|bdnick\.info/i;
function isLiveRead(p) {
  if (/deployment|get-logs|environment-status/i.test(p.name)) return true;
  return LIVE_READ_CMD.test(JSON.stringify(p.input ?? {}));
}

function knownSkills(env, cwd) {
  const dirs = env.SKILLS_CHECK_SKILL_DIRS
    ? env.SKILLS_CHECK_SKILL_DIRS.split(delimiter)
    : [join(env.CLAUDE_PROJECT_DIR || cwd || process.cwd(), ".claude", "skills"), join(env.USERPROFILE || env.HOME || homedir(), ".claude", "skills")];
  const names = new Set();
  for (const d of dirs) {
    try {
      for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() || e.isSymbolicLink()) names.add(e.name);
    } catch {
      /* a missing skills dir adds no names */
    }
  }
  return names;
}

export function main(stdinText, env = process.env) {
  const t0 = performance.now();
  const payload = parse(stdinText || "{}") ?? {};
  if (payload.stop_hook_active) return 0;
  const session = String(payload.session_id ?? "").replace(/[^\w.-]/g, "");
  if (!session || !payload.transcript_path || !existsSync(payload.transcript_path)) return 0;
  const v = judge(linesFromEnd(payload.transcript_path));
  if (env.SKILLS_CHECK_TIMING) process.stderr.write(`[agent-os] skills-check ${Math.round(performance.now() - t0)} ms\n`);
  if (!v.prompt) return 0;
  const problems = [];
  const afterCompaction = v.skill && v.compactWithoutAlwaysOn === true;
  if (v.tools.length && (!v.skill || afterCompaction)) {
    const names = [...new Set([...ALWAYS_ON, ...v.recall])];
    const counts = Object.entries(v.tools.reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}))
      .map(([t, n]) => (n > 1 ? `${t} x${n}` : t))
      .join(", ");
    problems.push(
      `This turn ran tools (${counts}) and ${afterCompaction ? "no always-on skill was invoked since the last compaction" : "no Skill call since the prompt"}. ` +
        `Before ending the turn, invoke with the Skill tool: ${names.join(", ")}; check what you just did against them, fix what they catch, then finish.`,
    );
  }
  const reply = typeof payload.last_assistant_message === "string" && payload.last_assistant_message.trim() ? payload.last_assistant_message : v.finalText;
  const missing = claimedSkills(reply, new Set([...knownSkills(env, payload.cwd), ...v.invoked])).filter((n) => !v.invoked.has(n));
  if (missing.length) {
    const it = missing.length > 1 ? "them" : "it";
    problems.push(
      `Your Skills: line names ${missing.join(", ")} with no Skill call this turn (naming is not invoking). ` +
        `Invoke ${it} now and check the work against ${it}, or move ${it} behind "used earlier:" in that line.`,
    );
  }
  if (!v.ciRead && claimsCiGreen(reply)) {
    problems.push(
      "Your reply calls CI or checks green or passing, and nothing read CI this turn. Read it now (gh pr checks <n>, or merge-gate.mjs <n> --sha <head> " +
        'without --merge) and report the tally, or write "CI: not read this turn".',
    );
  }
  if (!v.liveRead && claimsLive(reply)) {
    problems.push(
      "Your reply calls a change live, and nothing read production this turn. Read it now (nickstire /api/health .deploy.commit, the statenour " +
        'heartbeat, or the Railway deployment list) and name the commit, or write "live: not checked this turn".',
    );
  }
  if (!problems.length) return 0;

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
  process.stderr.write(`[skills-check] ${problems.join(" ")} This blocks once per prompt; the next stop goes through.
`);
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
