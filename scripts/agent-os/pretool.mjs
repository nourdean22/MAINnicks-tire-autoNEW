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
 */
import { readFileSync } from "node:fs";
import { evaluate, formatDenial, loadPolicy } from "./policy.mjs";

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

  // NotebookEdit calls its path field notebook_path, not file_path (wiring review 2026-08-04).
  const rawPath = input.file_path ?? input.notebook_path;
  const { denied, rule } = evaluate(
    {
      toolName,
      command: typeof input.command === "string" ? input.command : "",
      filePath: typeof rawPath === "string" ? rawPath : "",
      cwd: payload.cwd ?? process.cwd(),
    },
    loadPolicy(),
  );

  if (denied) {
    process.stderr.write(formatDenial(rule) + "\n");
    return BLOCK;
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
