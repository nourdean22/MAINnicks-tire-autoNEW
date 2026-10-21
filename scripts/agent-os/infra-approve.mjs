#!/usr/bin/env node
/**
 * Per-action infra approval (job 2026-10-20-infra-approve-per-action).
 *
 * WHY. Rule infra-mutation-tool denies the Railway, Neon, Vercel and Prisma mutation tools by name, so Nour had to click every redeploy in a
 * dashboard. AGENTS.md > Protected operations asks for his explicit instruction for the specific action, every time; this moves that
 * instruction from his dashboard to his chat. He types a line `APPROVE <tool> <target>`; exactly one call of that tool whose identifying
 * fields (ids other than project/environment/org/workspace/team scope ids; never free text) ALL name that target passes, within 30 minutes.
 *
 *   node infra-approve.mjs   UserPromptSubmit hook (WRITER): records each APPROVE line of the prompt in the session's store, prints what it recorded.
 *   consumeApproval()        imported by pretool.mjs (READER): only when infra-mutation-tool alone denies an MCP call.
 *
 * The store: %LOCALAPPDATA%/nourcity/approvals/<session>.json, a JSON list of {id, tool, target, at, session_id, used:false}, written only by this
 * hook. A call spends a record by the EXCLUSIVE create of <session>.<id>.used (claim-before-act: when two calls race, one create wins).
 * The reader also requires the same APPROVE line in a genuine operator message of the transcript (operator-asks.mjs > operatorAsk), so a record
 * alone (a forged store, a message sent by another session, a /loop re-fire, a tool result) is not an approval.
 * LOCALAPPDATA only LOCATES the store; no environment variable lifts the rule, and with no store nothing is approved.
 * FAILURE POSTURE: the reader fails CLOSED (any error: no approval, the call stays denied). The writer fails quietly (nothing recorded).
 * Canaries: infraApprove.test.mjs. Docs: docs/agent-os/README.md > Infra tools: approve one call.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadPolicy } from "./policy.mjs";
import { operatorAsk, redactPrivate } from "./operator-asks.mjs";

export const APPROVAL_WINDOW_MS = 30 * 60 * 1000;
const APPROVE_LINE = /^\s*APPROVE\s+(\S+)\s+(\S+)\s*$/i;
const RULE = "infra-mutation-tool";
const ID = /^[\w-]{8,64}$/;

export const approvalsDir = (env) => join(env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "approvals");
const sessionKey = (id) => String(id ?? "").replace(/[^\w.-]/g, "");
const leafOf = (toolName) => String(toolName).split("__").pop().toLowerCase();

/** Every own-line `APPROVE <tool> <target>` of a text, as lowercase {tool, target}. */
export function approveLines(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.match(APPROVE_LINE))
    .filter(Boolean)
    .map((m) => ({ tool: m[1].toLowerCase(), target: m[2].toLowerCase() }));
}

/** The approval settings in policy.json. A malformed neverApprovable list means EVERY tool is never approvable; a malformed alias map adds nothing. */
function settingsOf(policy) {
  const c = policy?.infraApprovals;
  const list = c?.neverApprovable;
  const never = Array.isArray(list) && list.length > 0 && list.every((s) => typeof s === "string" && s) ? new Set(list.map((s) => s.toLowerCase())) : null;
  const aliases = new Map();
  const a = c?.aliases;
  const ok = (v) => (typeof v === "string" && v) || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x));
  if (a && typeof a === "object" && !Array.isArray(a) && Object.values(a).every(ok)) {
    for (const [k, v] of Object.entries(a)) aliases.set(k.toLowerCase(), [v].flat().map((x) => x.toLowerCase()));
  }
  return { never, aliases };
}

const approvable = (tool, policy, never) => {
  const rule = policy.rules.find((r) => r.id === RULE);
  return Boolean(rule && new RegExp(rule.pattern).test(`mcp__approve__${tool}`)) && never !== null && !never.has(tool);
};

// The fields that NAME what a call acts on: a key, at any depth, that is `id` or ends in `_id`, `-id`, `Id` or `ID` (branch_id, serviceId,
// deploymentId, endpoint_id). Scope keys say where, not what, and never count. Free text (name, message, description) never counts: a manager
// probe 2026-10-20 showed an approval for one branch passing update_branch on the PRODUCTION branch because `name` echoed the approved id.
const IDENTIFYING = /^id$|[_-]id$|[a-z0-9]Id$|ID$/;
const SCOPE = new Set(["projectid", "environmentid", "orgid", "workspaceid", "teamid"]);
const identifying = (key) => IDENTIFYING.test(key) && !SCOPE.has(key.toLowerCase().replace(/[_-]/g, ""));

/** Every identifying field's value as a lowercase string, or null when it is not a string (never matches). Bounded. */
function identifyingValues(v, out = [], depth = 0) {
  if (out.length > 10000 || depth > 32 || !v || typeof v !== "object") return out;
  for (const [k, x] of Array.isArray(v) ? v.map((e) => ["", e]) : Object.entries(v)) {
    if (k && identifying(k)) {
      for (const e of Array.isArray(x) ? x : [x]) out.push(typeof e === "string" ? e.toLowerCase() : null);
    } else identifyingValues(x, out, depth + 1);
  }
  return out;
}

const fresh = (ts, now) => {
  const age = now - Date.parse(ts);
  return age >= 0 && age <= APPROVAL_WINDOW_MS;
};

/** True when a genuine operator message of the transcript, 0-30 min old, has the line APPROVE <tool> <target>. */
function typedByNour(transcriptPath, tool, target, now) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return false;
  for (const line of readFileSync(transcriptPath, "utf8").split("\n")) {
    if (!/approve/i.test(line) || line.includes('"toolUseResult":')) continue;
    let ask = null;
    try {
      ask = operatorAsk(JSON.parse(line));
    } catch {}
    if (ask && fresh(ask.ts, now) && approveLines(ask.text).some((a) => a.tool === tool && a.target === target)) return true;
  }
  return false;
}

/**
 * The READER. @returns {{ok: boolean, why: string, never?: boolean, approval?: object}}. Never throws: any error is { ok: false }.
 */
export function consumeApproval({ toolName, input, sessionId, transcriptPath, policy, env = process.env, now = Date.now() }) {
  try {
    const session = sessionKey(sessionId);
    const tool = leafOf(toolName);
    const { never, aliases } = settingsOf(policy);
    if (never === null || never.has(tool)) return { ok: false, never: true, why: `${tool} is never approvable` };
    if (!session) return { ok: false, why: "no session id" };
    const ids = identifyingValues(input);
    if (!ids.length) return { ok: false, why: `${tool} needs an id-bearing target: its input has no identifying field (only scope ids or free text), so no approval can name it` };
    const dir = approvalsDir(env);
    const list = JSON.parse(readFileSync(join(dir, `${session}.json`), "utf8"));
    if (!Array.isArray(list)) return { ok: false, why: "the approvals store is malformed" };
    for (const a of list) {
      if (!a || typeof a.tool !== "string" || typeof a.target !== "string" || typeof a.at !== "string" || !ID.test(String(a.id))) continue;
      if (a.used !== false || a.session_id !== session || a.tool.toLowerCase() !== tool || !fresh(a.at, now)) continue;
      const target = a.target.toLowerCase();
      const names = new Set([target, ...(aliases.get(target) ?? [])]);
      if (!ids.every((v) => v !== null && names.has(v))) continue; // EVERY identifying field names the approved target
      if (!typedByNour(transcriptPath, tool, target, now)) continue;
      try {
        closeSync(openSync(join(dir, `${session}.${a.id}.used`), "wx")); // the one-shot claim: exactly one create succeeds
      } catch {
        continue; // spent already (or not creatable): never a pass
      }
      return { ok: true, why: "approved", approval: a };
    }
    return { ok: false, why: "no unused approval for this tool and target from the last 30 minutes" };
  } catch (err) {
    return { ok: false, why: `no approval could be read (${err?.code ?? err?.message ?? err})` };
  }
}

/** The WRITER: append each approvable APPROVE line of the prompt to the session's store. @returns {{recorded, refused}} */
export function recordApprovals({ sessionId, prompt, policy, env = {}, now = Date.now() }) {
  const session = sessionKey(sessionId);
  const lines = approveLines(redactPrivate(String(prompt ?? ""))); // <private> text is never stored (AGENTS.md > Memory)
  if (!session || !lines.length) return { recorded: [], refused: [] };
  const { never } = settingsOf(policy);
  const infra = (tool) => approvable(tool, policy, new Set());
  const recorded = [];
  const refused = [];
  const seen = new Set();
  for (const l of lines) {
    if (!infra(l.tool)) continue; // not an infra tool name ("APPROVE the plan"): not an approval
    if (!approvable(l.tool, policy, never)) refused.push(l);
    else if (!seen.has(`${l.tool} ${l.target}`)) {
      seen.add(`${l.tool} ${l.target}`);
      recorded.push({ id: randomUUID(), ...l, at: new Date(now).toISOString(), session_id: session, used: false });
    }
  }
  if (recorded.length) {
    const dir = approvalsDir(env);
    const file = join(dir, `${session}.json`);
    let list = [];
    try {
      list = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
    } catch {}
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify([...(Array.isArray(list) ? list : []), ...recorded], null, 1));
  }
  return { recorded, refused };
}

export function main(stdinText, env) {
  let payload = {};
  try {
    payload = JSON.parse(stdinText || "{}") || {};
  } catch {
    return 0;
  }
  if (typeof payload.prompt !== "string") return 0;
  const { recorded, refused } = recordApprovals({ sessionId: payload.session_id, prompt: payload.prompt, policy: loadPolicy(), env });
  for (const a of recorded) process.stdout.write(`[infra-approve] recorded: one ${a.tool} call naming ${a.target}, valid 30 minutes.\n`);
  for (const a of refused) process.stdout.write(`[infra-approve] ${a.tool} is never approvable: Nour runs it himself (nothing recorded).\n`);
  return 0;
}

if (process.argv[1] && /infra-approve\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    process.exitCode = main(readFileSync(0, "utf8"), process.env);
  } catch (err) {
    process.stderr.write(`[agent-os] infra-approve error (nothing recorded): ${err?.message ?? err}\n`);
    process.exitCode = 0;
  }
}
