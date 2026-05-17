/**
 * Pre-push gate · v10.0.180
 *
 * The disable_thinking bug class hit production THREE TIMES in one
 * day (Apr 14 / 17 / today's v10.0.178-180):
 *
 *   1. Quick-mode chat — fast task, heretic model, empty output
 *   2. Reason task — high reasoning_effort, empty output
 *   3. Suggestions endpoint — direct fetch, max_tokens=180, empty
 *      content for unknown days
 *   4. Conversation-compress — direct fetch, no max_tokens, 5s
 *      timeout silently expiring
 *   5. Creative task — heretic model via env, no override set
 *
 * Each was the same shape: a Venice chat-completions call where
 * disable_thinking was undefined or false, on a model that
 * produces internal <think> tokens, with output stripped post-hoc.
 * The model burned the budget thinking, returned empty visible
 * content, and the operator saw a flake.
 *
 * KAIZEN — make the bug structurally impossible to ship again.
 *
 * This script greps every *.ts file for direct calls to Venice's
 * chat completions endpoint. For each call it asserts that the
 * SAME file declares `disable_thinking` (true or false — the gate
 * just wants the field to exist, so the author is FORCED to think
 * about it).
 *
 * The provider.ts task-override path is exempt (it's the central
 * place where disable_thinking is set per task). Endpoints that
 * hit /v1/models or /v1/audio/transcriptions are also exempt —
 * those don't trigger the <think>-burn class.
 *
 * Usage:
 *   pnpm exec tsx scripts/check-venice-disable-thinking.ts
 *
 * Exit codes:
 *   0 — every direct chat-completions call has disable_thinking
 *   1 — at least one call is missing disable_thinking
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

// Files allowed to call /v1/chat/completions WITHOUT disable_thinking
// in their own venice_parameters block. provider.ts handles this via
// the per-task override map already. The other entries are documented
// reasons why the gate doesn't apply.
const ALLOWLIST = new Set<string>([
  "lib/ai/provider.ts", // central per-task disable_thinking via VENICE_TASK_OVERRIDES
]);

// Endpoints that don't trigger the <think>-burn bug class.
const SAFE_ENDPOINT_REGEX = /api\.venice\.ai\/api\/v1\/(?:models|audio\/[a-z]+)/;

// The dangerous endpoint — chat completions.
const CHAT_COMPLETIONS_REGEX = /api\.venice\.ai\/api\/v1\/chat\/completions/;

function listVeniceFiles(): string[] {
  // Use git grep to scope to tracked files only — keeps the gate fast
  // and avoids node_modules / .next noise.
  const out = execSync(
    `git grep -l "api\\.venice\\.ai" -- "*.ts" "*.tsx" "*.mjs"`,
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Violation {
  file: string;
  reason: string;
}

function check(file: string): Violation | null {
  if (ALLOWLIST.has(file)) return null;
  const src = readFileSync(file, "utf8");
  if (!CHAT_COMPLETIONS_REGEX.test(src)) {
    // No chat-completions call — the gate doesn't apply.
    return null;
  }
  // File DOES call chat completions. Verify it also mentions
  // disable_thinking somewhere. We don't enforce true/false — just
  // that the author considered it.
  if (!/disable_thinking\s*:/.test(src)) {
    return {
      file,
      reason:
        "calls /v1/chat/completions but does not set disable_thinking in venice_parameters. " +
        "The heretic / reasoning-capable models will silently burn the output budget on " +
        "internal <think> tokens and return empty content. Add `disable_thinking: true` " +
        "to the venice_parameters object (or `false` if you genuinely need internal reasoning " +
        "and have the token budget for it).",
    };
  }
  return null;
}

const files = listVeniceFiles();
if (files.length === 0) {
  console.log("✓ no Venice consumers found");
  process.exit(0);
}

const violations: Violation[] = [];
for (const f of files) {
  // Tolerate already-removed files (rename/delete in flight).
  try {
    const v = check(f);
    if (v) violations.push(v);
  } catch {
    /* file vanished mid-check */
  }
}

// Skip safe-endpoint-only files in the report.
const realViolations = violations.filter((v) => {
  const src = readFileSync(v.file, "utf8");
  // If the only Venice URL in the file is /models or /audio/, the
  // chat-completions regex would still match a comment or ref. Re-
  // check by stripping safe URLs and re-running the regex.
  const stripped = src.replace(SAFE_ENDPOINT_REGEX, "");
  return CHAT_COMPLETIONS_REGEX.test(stripped);
});

if (realViolations.length === 0) {
  console.log(
    `✓ all ${files.length} Venice consumer${files.length === 1 ? "" : "s"} have disable_thinking handling`,
  );
  process.exit(0);
}

console.error("");
console.error(`✗ ${realViolations.length} Venice chat-completions call(s) missing disable_thinking:`);
console.error("");
for (const v of realViolations) {
  console.error(`  ${v.file}`);
  console.error(`    ${v.reason}`);
  console.error("");
}
console.error("Background: this gate exists because the same bug class shipped to prod");
console.error("3 times in one day (v10.0.178-180). See script header for details.");
process.exit(1);
