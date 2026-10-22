#!/usr/bin/env node
/**
 * SubagentStop hook: a lane agent's final report must carry evidence (job 2026-10-22-manager-skill-best).
 *
 * WHY. Lane claims arrive "in the same confident register as facts" (monorepo-manager replay 2026-10-15, row j), and the
 * manager relayed unchecked claims on 2026-10-22 (replay 2026-10-22). The manager session asked for this gate from its
 * setup benchmark: the hooks docs list SubagentStop as able to block, and exit 2 keeps the SUBAGENT running with stderr as
 * its next instruction (read 2026-10-22, https://code.claude.com/docs/en/hooks, SubagentStop).
 *
 * Rule. For agent_type lane-* only: if last_assistant_message has no receipt line (a command and its exit code on one
 * line), no commit SHA (7-40 hex characters with a digit and a letter) and no diff (a `diff --git` / `@@` hunk, or a
 * diffstat "N files changed"), block ONCE per agent_id with a stderr line saying what to add. `stop_hook_active` passes.
 * It checks that evidence is PRESENT, not that it is true: the manager still re-runs one receipt (step 7).
 *
 * State: %LOCALAPPDATA%/nourcity/receipt-check/<agent_id> (RECEIPT_CHECK_DIR). FAILURE POSTURE: fails OPEN (exit 0) on
 * its own errors, and never blocks when it cannot record the one-shot. Canaries: subagentReceipt.test.mjs and
 * hookCommand.test.mjs (the configured command).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateDir = (env) => env.RECEIPT_CHECK_DIR || join(env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "receipt-check");
const EXIT_CODE = /\bexit(?:\s+(?:code|status))?\s*[:=]?\s*-?\d+\b/i;
const COMMAND = /`[^`\n]+`|\b(?:node|pnpm|npm|npx|git|gh|vitest|tsc|python3?|pytest|uv|uvx|bash|sh|powershell|pwsh|curl|railway|turbo)\b/i;
const SHA = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const DIFF = /^diff --git |^@@ [-+]\d|\b\d+ files? changed\b/m;
// The read-only research lane runs few commands; its receipts are citations: a path:line or a URL.
const CITATION = /\b[\w./-]+\.\w+:\d+\b|\bhttps?:\/\/\S+/;

/** True when the report holds a receipt line, a commit SHA or a diff (or, for the research lane, a citation). */
export function hasEvidence(text, agentType = "") {
  const s = String(text ?? "");
  if (s.split(/\r?\n/).some((l) => EXIT_CODE.test(l) && COMMAND.test(l))) return true;
  if (agentType === "lane-research" && CITATION.test(s)) return true;
  return SHA.test(s) || DIFF.test(s);
}

export function main(stdinText, env = process.env) {
  let payload;
  try {
    payload = JSON.parse(stdinText || "{}");
  } catch {
    return 0;
  }
  if (payload.stop_hook_active) return 0;
  if (!/^lane-/.test(String(payload.agent_type ?? ""))) return 0; // defence in depth: the matcher already says lane-*
  const agent = String(payload.agent_id ?? "").replace(/[^\w.-]/g, "");
  const report = payload.last_assistant_message;
  if (!agent || typeof report !== "string" || !report.trim() || hasEvidence(report, payload.agent_type)) return 0;
  const file = join(stateDir(env), agent);
  if (existsSync(file)) return 0; // already sent back once
  try {
    mkdirSync(stateDir(env), { recursive: true });
    writeFileSync(file, new Date().toISOString());
  } catch {
    return 0; // a block it cannot remember could repeat: never block blind
  }
  process.stderr.write(
    "[receipt-check] Your report has no receipt line (a command with its exit code, e.g. `node --test x.test.mjs` -> 12 passed, exit 0), " +
      "no commit SHA and no diff. Add the receipt for each check you ran, labelled FACT, INFERRED or NOT CHECKED as your brief's RETURN asks, " +
      "and the SHA of what you committed; for a check you did not run, write NOT CHECKED and why. This is asked once.\n",
  );
  return 2;
}

if (process.argv[1] && /subagent-receipt-check\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  try {
    process.exitCode = main(readFileSync(0, "utf8"));
  } catch (err) {
    process.stderr.write(`[agent-os] receipt-check error (allowing the stop): ${err?.message ?? err}\n`);
    process.exitCode = 0;
  }
}
