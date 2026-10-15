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
 * Bricking every tool call in the operator's session because of a JSON edge case is a
 * worse outcome than missing one check. Claude Code also fails open on hook crash and
 * timeout, so pretending otherwise would be theatre. This is a guard-rail against an
 * agent doing something destructive by accident — not a security boundary against a
 * determined attacker, and it is Claude-only (Codex/Cursor/Copilot never see it).
 *
 * Exit 2 is used rather than JSON stdout because Claude Code ignores JSON when a hook
 * exits 2 — mixing the two silently drops the denial.
 *
 * OPERATOR OVERRIDE — ONE rule only (2026-10-15, job infra-deny-by-name): a rule that names `overrideEnv` in
 * policy.json (today only infra-mutation-tool, AGENT_OS_INFRA_OVERRIDE) is turned from a denial into a stderr
 * warning that repeats the reason, exit 0, when the OPERATOR has set that env var to a non-empty value. The
 * judgment is made per rule: the same call is judged again with that rule skipped, so any OTHER rule that
 * matches still denies. No other rule has an override.
 */
import { readFileSync } from "node:fs";
import { adaptToolCall, evaluate, formatDenial, loadPolicy, overrideReason } from "./policy.mjs";

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
  const calls = adapted ?? [
    {
      toolName,
      command: typeof input.command === "string" ? input.command : "",
      filePath: typeof rawPath === "string" ? rawPath : "",
      cwd,
    },
  ];

  for (const call of calls) {
    // A denial by a rule with a live operator override is warned and the call is judged again WITHOUT that rule: another rule may still deny it.
    // Each pass adds one distinct rule id to the skip list, so the loop ends.
    let skipRules = call.skipRules;
    for (;;) {
      const { denied, rule } = evaluate({ ...call, skipRules }, policy);
      if (!denied) break;
      const reason = overrideReason(rule);
      if (reason) {
        process.stderr.write(
          `[agent-os] WARNING: ${rule.overrideEnv} is set (${JSON.stringify(reason)}): allowing a call that rule ${rule.id} denies.\n` +
            `Why the rule exists: ${rule.why}\n`,
        );
        if (call.via) process.stderr.write(`Judged through MCP adapter ${call.via} on tool ${toolName}.\n`);
        skipRules = [...(Array.isArray(skipRules) ? skipRules : []), rule.id];
        continue;
      }
      process.stderr.write(formatDenial(rule) + "\n");
      if (call.via) process.stderr.write(`Judged through MCP adapter ${call.via} on tool ${toolName}.\n`);
      return BLOCK;
    }
  }
  return ALLOW;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Fail OPEN, but loudly — a silent broken guard is the worst of both worlds.
    process.stderr.write(`[agent-os] pretool hook error (allowing call): ${err?.message ?? err}\n`);
    process.exit(ALLOW);
  });
