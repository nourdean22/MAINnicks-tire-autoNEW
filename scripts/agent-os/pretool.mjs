#!/usr/bin/env node
/**
 * PreToolUse hook — Agent OS v1 (2026-08-04).
 *
 * Reads the hook payload on stdin, evaluates config/agent-os/policy.json, and blocks
 * a forbidden call with exit 2 (stderr becomes the reason shown to the model).
 *
 * FAILURE POSTURE — deliberate and asymmetric:
 *   · a MATCHED rule    -> fail CLOSED (exit 2, blocked)
 *   · a bug in THIS file -> fail OPEN  (exit 0, allowed, warning on stderr)
 *   · the per-action infra approval (infra-approve.mjs) -> fail CLOSED: any error there keeps the infra denial
 * Bricking every tool call in the operator's session because of a JSON edge case is a
 * worse outcome than missing one check. Claude Code also fails open on hook crash and
 * timeout, so pretending otherwise would be theatre. This is a guard-rail against an
 * agent doing something destructive by accident — not a security boundary against a
 * determined attacker, and it is Claude-only (Codex/Cursor/Copilot never see it).
 *
 * Exit 2 is used rather than JSON stdout because Claude Code ignores JSON when a hook
 * exits 2 — mixing the two silently drops the denial.
 */
import { readFileSync } from "node:fs";
import { adaptToolCall, agentDispatchCall, evaluate, formatDenial, loadPolicy } from "./policy.mjs";

const ALLOW = 0;
const BLOCK = 2;

async function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return ALLOW; // no stdin (manual run) — nothing to judge
  }
  if (!raw.trim()) return ALLOW;

  const payload = JSON.parse(raw);
  const toolName = payload.tool_name ?? "";
  const input = payload.tool_input ?? {};

  const policy = loadPolicy();
  const cwd = payload.cwd ?? process.cwd();

  // MCP and native runners and file writers (Terminal MCP, Desktop Commander, Monitor, filesystem
  // MCP) are mapped onto Bash or Write so the existing rules judge them (config/agent-os/policy.json
  // > mcpAdapters). null means "not an adapted tool": judge the call as itself, exactly as before.
  // That is always the case for the native tools, which adaptToolCall never touches.
  const adapted = adaptToolCall(toolName, input, cwd, policy, (line) => process.stderr.write(`${line}\n`));
  // NotebookEdit calls its path field notebook_path, not file_path (wiring review 2026-08-04).
  const rawPath = input.file_path ?? input.notebook_path;
  // Agent / Task (lane dispatches) are judged as one summary line (policy.mjs > agentDispatchCall).
  const dispatch = agentDispatchCall(toolName, input, cwd);
  const calls = adapted ?? (dispatch ? [dispatch] : null) ?? [
    {
      toolName,
      command: typeof input.command === "string" ? input.command : "",
      filePath: typeof rawPath === "string" ? rawPath : "",
      cwd,
    },
  ];

  // An infra-mutation-tool denial of an MCP call may be lifted by ONE per-action approval Nour typed (infra-approve.mjs). It is
  // decided after every other judgment of the call: an approval never lifts another rule, and a call another rule denies spends nothing.
  let infra = null;
  for (const call of calls) {
    const { denied, rule } = evaluate(call, policy);
    if (!denied) continue;
    // Only the judgment of the call's OWN tool name (row infra-name): a runner whose command text merely is a tool name is not approvable.
    if (rule.id === "infra-mutation-tool" && adapted && call.command === String(toolName)) {
      infra ??= { rule, call };
      continue;
    }
    return deny(rule, call, toolName);
  }
  if (!infra) return ALLOW;
  let verdict;
  try {
    const { consumeApproval } = await import("./infra-approve.mjs");
    verdict = consumeApproval({ toolName, input, sessionId: payload.session_id, transcriptPath: payload.transcript_path, policy });
  } catch (err) {
    verdict = { ok: false, why: `the approval reader failed (${err?.message ?? err})` }; // fail CLOSED on this branch
  }
  if (verdict?.ok === true) {
    const a = verdict.approval;
    const note = `[infra-approve] used Nour's approval: one ${a.tool} call naming ${a.target} (approved ${a.at}); it is spent.`;
    process.stdout.write(JSON.stringify({ systemMessage: note }) + "\n");
    process.stderr.write(note + "\n");
    return ALLOW;
  }
  const leaf = String(toolName).split("__").pop();
  return deny(
    infra.rule,
    infra.call,
    toolName,
    verdict?.never
      ? `${leaf} is never approvable: Nour runs it himself.`
      : `To allow it once: Nour types APPROVE ${leaf} <target> in chat (one call whose id fields all name that target, within 30 minutes). Not applied: ${verdict?.why ?? "unknown"}.`,
  );
}

function deny(rule, call, toolName, note = "") {
  process.stderr.write(formatDenial(rule) + "\n");
  if (note) process.stderr.write(`${note}\n`);
  if (call.via) process.stderr.write(`Judged through MCP adapter ${call.via} on tool ${toolName}.\n`);
  return BLOCK;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Fail OPEN, but loudly — a silent broken guard is the worst of both worlds.
    process.stderr.write(`[agent-os] pretool hook error (allowing call): ${err?.message ?? err}\n`);
    process.exit(ALLOW);
  });
