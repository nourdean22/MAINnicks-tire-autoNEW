#!/usr/bin/env node
/**
 * Stop hook: a SessionStart `[health] ... FIX FIRST:` line is the session's first task (job 2026-10-22-manager-skill-best).
 *
 * WHY. The manager session of 2026-10-21/22 started with `graphify DOWN | task NOURCITY-Local-MCP FAILED | FIX FIRST: (1)
 * ...local-mcp-servers.ps1 -Start (2) ...register-local-mcp-task.ps1` and ran neither fix for about a day; the rule
 * ("a [health] FAIL is the turn's first task", memory feedback-proactive-setup-fixes) existed as text only. Nour, 2026-10-22:
 * "if you catch yourself making mistakes, you need to catch it and fix it and fix it forever".
 *
 * Rule. At a Stop, read the transcript bytes not judged yet (state: the byte offset judged through). For every SessionStart
 * attachment whose text holds `[health] ... FIX FIRST:` the line is ACTED ON when, after it, a tool call's input names one
 * of its fixes (a script file name such as local-mcp-servers.ps1, or a task name after /tn) or a reply has a line starting
 * `Health:` (fixed, or why not), including the Stop payload's last_assistant_message. A line not acted on blocks the stop
 * (exit 2) ONCE: the offset is saved first, so the next stop goes through; a NEW FIX FIRST line (resume, compaction) is
 * judged again. `stop_hook_active` always passes.
 *
 * Cost: only bytes after the saved offset are read (at most 32 MB, newest); lines are parsed only when they can matter.
 * State: %LOCALAPPDATA%/nourcity/health-first/<session>.json (HEALTH_FIRST_DIR); HEALTH_FIRST_TIMING=1 prints the bytes read.
 * FAILURE POSTURE: fails OPEN (exit 0) on its own errors, and never blocks when it cannot save the offset.
 * Canaries: healthFirst.test.mjs (rules, controls, one-shot, speed, wiring) and hookCommand.test.mjs (the configured command).
 */
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_READ = 32 << 20;
const HEALTH_LINE = /^\[health\][^\n]*\bFIX FIRST:[^\n]*/m;
// "Health: fixed ..." or "Health: not fixed, because ..."; a bare "Health: ok" says nothing was done (skeptic 2026-10-22).
const HEALTH_REPLY = /^[\s>*_`-]*health[*_`]*\s*:[^\n]*\b(?:fixed|because)\b/im;
// Only a tool that runs or edits something can act on a fix; reading or grepping the script does not (skeptic 2026-10-22).
const ACTOR = /^(?:Bash|PowerShell|Monitor|Edit|Write|MultiEdit|NotebookEdit)$|__(?:run_in_terminal|start_process|interact_with_process|write_file|edit_block)$/;

const stateDir = (env) => env.HEALTH_FIRST_DIR || join(env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "health-first");
const parse = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

/** The fixes of one FIX FIRST line, and the lower-case names that identify each one in a tool call. */
export function fixesOf(line) {
  const tail = line.slice(line.indexOf("FIX FIRST:") + "FIX FIRST:".length);
  const fixes = tail.split(/\(\d+\)\s*/).map((f) => f.trim()).filter(Boolean);
  const tokens = new Set();
  for (const f of fixes) {
    // What the fix names: a script or config file, a scheduled task (/tn), a PowerShell cmdlet, and the Bypass flag when
    // the fix is to ADD it (a fix that is itself a "powershell -ExecutionPolicy Bypass -File x.ps1" launch must not let
    // every PowerShell call count).
    const pick = (re) => [...f.matchAll(re)].map((m) => (m[1] ?? m[0]).toLowerCase());
    const names = [
      ...pick(/[\w.-]+\.(?:ps1|psm1|mjs|cjs|js|cmd|bat|py|sh|json|toml)\b/gi),
      ...pick(/\/tn\s+"?([^"\s]+)/gi),
      ...pick(/\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/g),
      ...(/^powershell\b/i.test(f) ? [] : pick(/-ExecutionPolicy Bypass/gi)),
    ];
    for (const n of names) tokens.add(n);
  }
  // A fix that names nothing is acted on by any runner or editor call after the line (never a guessed phrase).
  return { fixes, tokens: [...tokens] };
}

/** Judge entries in file order; returns the FIX FIRST lines that nothing acted on. */
export function judge(entries, lastMessage = "") {
  const lines = [];
  for (const e of entries) {
    if (e.type === "attachment" && e.attachment?.hookEvent === "SessionStart") {
      const m = String(e.attachment.content || e.attachment.stdout || "").match(HEALTH_LINE);
      if (m) lines.push({ line: m[0], ...fixesOf(m[0]), acted: false });
      continue;
    }
    const open = lines.filter((l) => !l.acted);
    if (!open.length || e.type !== "assistant") continue;
    for (const p of e.message?.content ?? []) {
      if (p?.type === "tool_use") {
        if (!ACTOR.test(String(p.name ?? ""))) continue;
        const input = JSON.stringify(p.input ?? {}).toLowerCase();
        for (const l of open) if (!l.tokens.length || l.tokens.some((t) => input.includes(t))) l.acted = true;
      } else if (p?.type === "text" && HEALTH_REPLY.test(p.text ?? "")) {
        for (const l of open) l.acted = true;
      }
    }
  }
  if (HEALTH_REPLY.test(String(lastMessage ?? ""))) for (const l of lines) l.acted = true;
  return lines.filter((l) => !l.acted);
}

function readFrom(path, offset) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = offset > size ? 0 : Math.max(offset, size - MAX_READ); // a shorter file is a new transcript
    const buf = Buffer.alloc(size - start);
    for (let got = 0; got < buf.length; ) {
      const r = readSync(fd, buf, got, buf.length - got, start + got);
      if (!r) break;
      got += r;
    }
    return { size, text: buf.toString("utf8") };
  } finally {
    closeSync(fd);
  }
}

export function main(stdinText, env = process.env) {
  const t0 = performance.now();
  const payload = parse(stdinText || "{}") ?? {};
  if (payload.stop_hook_active) return 0;
  const session = String(payload.session_id ?? "").replace(/[^\w.-]/g, "");
  if (!session || !payload.transcript_path || !existsSync(payload.transcript_path)) return 0;
  const file = join(stateDir(env), `${session}.json`);
  let offset = 0;
  try {
    offset = Number(JSON.parse(readFileSync(file, "utf8")).offset) || 0;
  } catch {}
  const { size, text } = readFrom(payload.transcript_path, offset);
  // Substrings only pick which lines to parse (speed); every decision is made on the parsed entry.
  const entries = text.split("\n").filter((l) => l.includes("FIX FIRST") || l.includes('"tool_use"') || /ealth/.test(l)).map(parse).filter(Boolean);
  const open = judge(entries, payload.last_assistant_message);
  if (env.HEALTH_FIRST_TIMING) process.stderr.write(`[agent-os] health-first read ${Buffer.byteLength(text)} bytes in ${Math.round(performance.now() - t0)} ms\n`);
  try {
    mkdirSync(stateDir(env), { recursive: true });
    writeFileSync(file, JSON.stringify({ offset: size, at: new Date().toISOString() }));
  } catch {
    return 0; // a block it cannot remember could repeat: never block blind
  }
  if (!open.length) return 0;
  const newest = open.at(-1);
  const broken = newest.line.slice(0, newest.line.indexOf("| FIX FIRST")).replace(/^\[health\]\s*/, "").trim();
  process.stderr.write(
    `[health-first] This session started with broken tooling (${broken.slice(0, 220)}) and nothing ran its fix: ` +
      `${newest.fixes.map((f, i) => `(${i + 1}) ${f}`).join(" ")}. A [health] FAIL is the session's first task (memory feedback-proactive-setup-fixes): ` +
      'run the fix now and check it, or end your reply with a line "Health: not fixed, because <reason>" (a sibling already on it, needs Nour, ...). ' +
      "This blocks once per health line; the next stop goes through.\n",
  );
  return 2;
}

if (process.argv[1] && /health-first\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    process.exitCode = main(readFileSync(0, "utf8"));
  } catch (err) {
    process.stderr.write(`[agent-os] health-first error (allowing the stop): ${err?.message ?? err}\n`);
    process.exitCode = 0;
  }
}
