#!/usr/bin/env tsx
/**
 * scripts/prompt-judge-comparator.ts · RETIRED 2026-08-06
 * (was v10.0.464 · v2-cutover Phase 0b · Criterion 4 evaluator)
 *
 * WHAT IT USED TO DO · sampled N recent user queries from ChatMessage,
 * built the "v1" and "v2" system prompts, generated a reply with each,
 * scored both on the 5-axis judge rubric, and gated the Prompt V2
 * cutover on "no axis regresses by more than 0.3" (Criterion 4).
 *
 * WHY IT NO LONGER RUNS · the 2026-06-29 Prompt V2 Prime Cutover deleted
 * V1 compilation. `buildSystemPrompt()` delegates straight to
 * `buildSystemPromptV2()` (lib/ai/system-prompt.ts) and
 * `isPromptV2Enabled()` returns `true` unconditionally with no reader —
 * so the `NICK_PRIME_PROMPT=off` / `=1` toggling this script did around
 * its two builds gated NOTHING. Both arms built the same builder. The
 * script spent N x 4 LLM calls (~80 at the default N=20) to compare V2
 * against itself, then reported the ~0 residual as "Criterion 4 PASS":
 * a manufactured green on a cutover gate, at real cost.
 *
 * Rather than fail expensively, it now refuses cheaply — no DB read, no
 * LLM call, no provider chain. Several surfaces still point here
 * (docs/CALIBRATION_TODO.md, scripts/prompt-shadow-summary.ts), so the
 * refusal explains itself rather than 404-ing on them.
 *
 * Do NOT "repair" this by re-pointing one arm at a different builder —
 * there is no second builder. Restoring a real comparison means first
 * having two prompt builders to compare, which is a design decision, not
 * a script fix.
 *
 * Exit codes:
 *   2 = cannot produce a verdict (unchanged meaning · was "no sample data")
 */

const RETIRED_AT = "2026-08-06";

const REASON =
  "There is exactly one system-prompt builder. buildSystemPrompt() delegates " +
  "to buildSystemPromptV2(), so a v1-vs-v2 judge comparison has no second arm. " +
  "This script would have spent ~4 LLM calls per sample comparing V2 against " +
  "itself and reported the residual as Criterion 4 PASS.";

const ALTERNATIVES = [
  "Judge two replies you actually have: system.judgeEvalRun ({ prompt, v1Reply, " +
    "v2Reply }) on /system/judge-eval — it judges operator-supplied text, so both " +
    "arms are real.",
  "Inspect what the served prompt currently contains: system.promptDiagnostics " +
    "(/system/prompt) — sections, size, cache state, providers.",
];

function main(): never {
  const json = process.argv.slice(2).includes("--json");

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "retired",
          retiredAt: RETIRED_AT,
          reason: REASON,
          alternatives: ALTERNATIVES,
          llmCallsSpent: 0,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    console.error(`✗ RETIRED ${RETIRED_AT} · prompt-judge-comparator did not run.`);
    console.error("");
    console.error(REASON);
    console.error("");
    console.error("Instead:");
    for (const a of ALTERNATIVES) console.error(`  · ${a}`);
    console.error("");
    console.error("No LLM calls were made. Exit 2 (cannot produce a verdict).");
  }

  process.exit(2);
}

main();
