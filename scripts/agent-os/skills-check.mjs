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
 * reply's own claims are compared with the tool calls made since the reply's START: the newest prompt OR task
 * notification (a notification-driven overnight run is one prompt and many replies; skeptic pass 2026-10-22). Each start
 * gets its own one-shot, and the checks run even on a turn with no tools:
 *   1. every `Skills:` line (also `Skill:`, `Skills used:`, or one after a sentence end): each real skill name on it (a
 *      directory under the project's or the user's .claude/skills, or any ns:name, case ignored) needs a Skill call or a
 *      slash-loaded body since the start. Not claims: text after "used earlier" / "skipped" / "Tools:" or after the
 *      first sentence, and a clause (split on , ; | and parentheses) that holds a negation (not, no, never, without).
 *      Replayed over 155 real manager turns from 2026-10-21T20Z: 22 of 128 such lines named a skill with no call.
 *   2. a clause (split on . , ; | and newlines) calling CI, checks or a PR green, passing or mergeable, with no hedge
 *      (not, once, until, still, will, local, preflight, ...), needs a CI read since the start: a command running
 *      `gh pr checks|view|status`, `gh run list|view|watch`, `gh api` on check runs, or `node ... merge-gate.mjs <pr>`;
 *      mcp__ccd_pr__get_status; or a start that is the app's <ci-monitor-event> (answer-first: a CI state is the tally
 *      read THIS turn; the manager wrote "All 4 remaining PRs are green" from an earlier read on 2026-10-21).
 *   3. a clause calling something live ("is live", "it's live", "went live", "deployed") with no hedge needs a production
 *      read since the start: a command (Bash, PowerShell, a terminal runner) that fetches /api/health, a heartbeat or
 *      either production domain or reads Railway status/logs/deployments, a WebFetch of either domain, or a
 *      deployment/log MCP tool. Reading a FILE is not a read of CI or production. Merge is not deploy.
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
  // Turn truth is judged since the reply's START (the newest prompt or task notification), not since the prompt.
  let start = null;
  const invoked = new Set(); // bare skill names invoked (Skill call or slash-loaded body) since the start
  let finalText = null; // the newest assistant text of the turn
  let ciRead = false;
  let liveRead = false;
  for (const line of lines) {
    // Substrings only pick which lines to parse (speed); every decision below is made on the parsed entry.
    const candidate =
      line.includes('"compact_boundary"') || line.includes('"isCompactSummary":true') || line.includes('"type":"tool_use"') ||
      (!start && finalText === null && line.includes('"type":"assistant"') && line.includes('"type":"text"')) ||
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
      if (!start && finalText === null) finalText = [...parts].reverse().find((p) => p?.type === "text" && p.text?.trim())?.text ?? null;
      for (const p of parts) {
        if (p?.type !== "tool_use") continue;
        if (p.name === "Skill") {
          const name = String(p.input?.skill ?? "").replace(/^.*:/, "").toLowerCase();
          if (ALWAYS_ON.includes(name)) alwaysOnSeen = true;
          if (!prompt) skill = true;
          if (!start) invoked.add(name);
        } else if (!prompt && !BOOKKEEPING.test(p.name)) {
          tools.push(p.name);
          if (!start && isCiRead(p)) ciRead = true;
          if (!start && isLiveRead(p)) liveRead = true;
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
      if (!start) invoked.add(loaded.toLowerCase());
      if (ALWAYS_ON.includes(loaded)) alwaysOnSeen = true;
      continue;
    }
    if (!start && (isPrompt(e) || isNotification(e))) {
      start = e;
      if (/<ci-monitor-event>/.test(textOf(e.message?.content))) ciRead = true; // the app's CI report is the read
    }
    if (!isPrompt(e)) continue;
    prompt = e;
    // Past the prompt only a compaction search remains, needed only when this turn's Skill calls might not re-arm.
    if (!tools.length || !skill || alwaysOnSeen || compactWithoutAlwaysOn !== null) break;
  }
  return { prompt, start, tools, skill, compactWithoutAlwaysOn, recall, invoked, finalText, ciRead, liveRead };
}

/** A background task's notification: not a new prompt for the no-Skill rule, but the start of a new reply. */
function isNotification(e) {
  if (e?.type !== "user" || e.isMeta || e.isCompactSummary || e.isSidechain || e.toolUseResult !== undefined) return false;
  return /task.notification/.test(`${e.origin?.kind ?? ""} ${e.turnOrigin ?? ""}`) || /^<task-notification>/.test(textOf(e.message?.content));
}

// -- Turn truth ------------------------------------------------------------------------------------------------------
// Only a tool that RUNS something can read CI or production; reading or grepping a file that names it is not a read.
const RUNNER = /^(?:Bash|PowerShell|Monitor)$|__(?:run_in_terminal|start_process|interact_with_process)$/;
const CI_READ_CMD = /\bgh\s+(?:pr\s+(?:checks|view|status)|run\s+(?:list|view|watch)|api\s[^\n]*(?:check-runs|check-suites|statuses|actions\/runs))\b|\bnode\s+\S*merge-gate\.mjs\s+#?\d/;
function isCiRead(p) {
  if (p.name === "mcp__ccd_pr__get_status") return true;
  return RUNNER.test(p.name) && typeof p.input?.command === "string" && CI_READ_CMD.test(p.input.command);
}

// A clause that negates or dates its names ("not needed", "already ran this hour") claims nothing for THIS turn.
const NEGATION = /\b(?:not|no|never|without|nothing|already|earlier|previously)\b|n't\b/i;
/** Bare, lower-case skill names the reply's `Skills:` lines claim: known skill names and any ns:name, nothing else. */
export function claimedSkills(text, known) {
  const out = new Set();
  for (const l of String(text ?? "").split(/\r?\n/)) {
    const m = /(?:^|[.!?]\s+)[\s>*_`-]*skills?(?:\s+(?:used|invoked|called|this turn))?[*_`]*\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    // The list ends at its sentence, at "Tools:", and at the names that were NOT used.
    let line = m[1].split(/\btools\s*:/i)[0].split(/\.(?:\s|$)/)[0];
    line = line.split(/\b(?:used earlier|skipped|skipping|not invoked|not used)\b/i)[0];
    const clauses = line.split(/[,;|()]/);
    if (/^[\s*_`]*none(?:\s+new|\s+this turn)?[\s*_`]*$/i.test(clauses[0])) continue; // "Skills: none new; ..." claims nothing
    for (const clause of clauses) {
      if (NEGATION.test(clause)) continue; // "guard-red-team was not needed", "no prod-db-guard because ..."
      for (const raw of clause.split(/\s+/)) {
        const tok = raw.replace(/^[^\w]+|[^\w]+$/g, "").toLowerCase();
        const name = tok.replace(/^.*:/, "");
        if (name && (/^[\w-]+:[\w-]+$/.test(tok) || known.has(name))) out.add(name);
      }
    }
  }
  return [...out];
}

// A claim, not a plan or a negation: the clause before the match (and the match) carries no hedge word. The nouns cover
// the manager's real wording on 2026-10-21/22 ("All 4 remaining PRs are green", "CI 4 passed, 0 failed").
// "green" said of a thing ("a green button") is not a state: attributive uses after an article are skipped.
const GREEN = String.raw`(?<!\b(?:a|an|the)\s)green\b`;
const CI_NOUN = String.raw`\b(?:CI|checks?|PRs?|PR\s*#?\d{3,5}|#\d{3,5})\b`;
const CI_CLAIM = new RegExp(`${CI_NOUN}[^.\\n|,;]{0,40}?(?:\\b${GREEN}|\\b(?:passed|passing|pass(?:es)?|succeed(?:s|ed)?|mergeable)\\b)|\\b${GREEN}[^.\\n|,;]{0,30}${CI_NOUN}|\\bpassing\\s+CI\\b`, "gi");
const LIVE_CLAIM = /\b(?:is|are|now|went)\s+live\b|['\u2019]s\s+live\b|\bdeployed\b/gi;
const HEDGE = /\b(?:not|no|nothing|none|neither|never|yet|until|once|when|whenever|if|after|before|as soon as|still|pending|running|waiting|red|cancelled|will|should)\b|n't\b/i;
const CI_LOCAL = /\b(?:local|locally|preflight|pre-commit|pre-push)\b/i; // local runs are claims about tests, not CI
const HEDGE_AFTER = /^[\s*_`]*(?:yet|soon|later|tomorrow|once|when|after|until)\b/i; // "is live yet", "green once ..."
function claims(text, re, extraHedge) {
  const s = String(text ?? "");
  for (const m of s.matchAll(re)) {
    const clauseStart = Math.max(...[".", "\n", ";", "|", ","].map((c) => s.lastIndexOf(c, m.index))) + 1;
    const end = m.index + m[0].length;
    const clause = s.slice(clauseStart, end);
    if (!HEDGE.test(clause) && !extraHedge?.test(clause) && !HEDGE_AFTER.test(s.slice(end, end + 20))) return true;
  }
  return false;
}
export const claimsCiGreen = (text) => claims(text, CI_CLAIM, CI_LOCAL);
export const claimsLive = (text) => claims(text, LIVE_CLAIM);
// A live read: a command that fetches either production site, /api/health or a heartbeat, or reads Railway's status,
// logs or deployments; a WebFetch of either domain; or a deployment or log MCP tool.
const LIVE_READ_CMD = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b[^\n]*(?:\/api\/health|heartbeat|nickstire\.org|bdnick\.info)|\brailway\s+(?:status|logs|deployment)/i;
const LIVE_SITE = /nickstire\.org|bdnick\.info/i;
function isLiveRead(p) {
  if (/^mcp__.+__(?:list-deployments|get-logs|environment-status|list_deployments|get_deployment|get_runtime_logs)$/i.test(p.name)) return true;
  if (p.name === "WebFetch") return LIVE_SITE.test(String(p.input?.url ?? ""));
  return RUNNER.test(p.name) && typeof p.input?.command === "string" && LIVE_READ_CMD.test(p.input.command);
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
  // One-shot keys: the no-Skill rule once per prompt (as since 2026-10-17); turn truth once per reply start.
  const id = (e) => String(e?.promptId ?? e?.uuid ?? e?.timestamp ?? "");
  const promptKey = `p:${id(v.prompt)}`;
  const startKey = `s:${id(v.start ?? v.prompt)}`;
  const problems = [];
  const add = (key, text) => problems.push({ key, text });
  const afterCompaction = v.skill && v.compactWithoutAlwaysOn === true;
  if (v.tools.length && (!v.skill || afterCompaction)) {
    const names = [...new Set([...ALWAYS_ON, ...v.recall])];
    const counts = Object.entries(v.tools.reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}))
      .map(([t, n]) => (n > 1 ? `${t} x${n}` : t))
      .join(", ");
    add(
      promptKey,
      `This turn ran tools (${counts}) and ${afterCompaction ? "no always-on skill was invoked since the last compaction" : "no Skill call since the prompt"}. ` +
        `Before ending the turn, invoke with the Skill tool: ${names.join(", ")}; check what you just did against them, fix what they catch, then finish.`,
    );
  }
  const reply = typeof payload.last_assistant_message === "string" && payload.last_assistant_message.trim() ? payload.last_assistant_message : v.finalText;
  const missing = claimedSkills(reply, new Set([...knownSkills(env, payload.cwd), ...v.invoked])).filter((n) => !v.invoked.has(n));
  if (missing.length) {
    const it = missing.length > 1 ? "them" : "it";
    add(
      startKey,
      `Your Skills: line names ${missing.join(", ")} with no Skill call this turn (naming is not invoking). ` +
        `Invoke ${it} now and check the work against ${it}, or move ${it} behind "used earlier:" in that line.`,
    );
  }
  if (!v.ciRead && claimsCiGreen(reply)) {
    add(
      startKey,
      "Your reply calls CI or checks green or passing, and nothing read CI this turn. Read it now (gh pr checks <n>, or merge-gate.mjs <n> --sha <head> " +
        'without --merge) and report the tally, or write "CI: not read this turn".',
    );
  }
  if (!v.liveRead && claimsLive(reply)) {
    add(
      startKey,
      "Your reply calls a change live, and nothing read production this turn. Read it now (nickstire /api/health .deploy.commit, the statenour " +
        'heartbeat, or the Railway deployment list) and name the commit, or write "live: not checked this turn".',
    );
  }
  if (!problems.length) return 0;

  const file = join(stateDir(env), `${session}.json`);
  let seen = [];
  try {
    const st = JSON.parse(readFileSync(file, "utf8"));
    seen = Array.isArray(st.keys) ? st.keys : st.key ? [`p:${st.key}`, `s:${st.key}`] : []; // pre-2026-10-22 state: one prompt key
  } catch {}
  const fresh = problems.filter((p) => !seen.includes(p.key));
  if (!fresh.length) return 0; // each problem already sent back once for its prompt or reply
  try {
    mkdirSync(stateDir(env), { recursive: true });
    writeFileSync(file, JSON.stringify({ keys: [...new Set([...seen, ...fresh.map((p) => p.key)])].slice(-50), at: new Date().toISOString() }));
  } catch {
    return 0; // a block it cannot remember could repeat: never block blind
  }
  process.stderr.write(`[skills-check] ${fresh.map((p) => p.text).join(" ")} This blocks once per prompt and once per reply; the next stop goes through.\n`);
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
