/**
 * Quality benchmark runner · v10.0.345 · Phase 4 of glitch taxonomy
 * hardening (Category 7 · quality regressions).
 *
 * CLI shell only since 2026-08-05 — the runner itself lives in
 * `lib/ai/evals/quality-bench-core.ts`, shared with the weekly Inngest
 * schedule (`quality-bench-weekly`). For two years of file history this header
 * said "weekly cron … is the intended cadence" while nothing scheduled it;
 * the Inngest function is that cadence, and this script remains the manual
 * lane for after-model-swap checks.
 *
 * Run modes:
 *   · `pnpm tsx scripts/run-quality-bench.ts` · full bench · live model
 *     calls · prints pass/fail summary · exits non-zero on failures
 *   · `--dry` · skips live model calls · just verifies the prompt
 *     registry shape (cheap CI pre-check)
 *   · `--ids id1,id2` · run only specific prompts (faster iteration)
 *   · `--json` · machine-readable output
 *
 * Cost · roughly $0.05-0.20 per full run depending on prompts (8 prompts
 * × ~$0.01-0.03 each via Venice/Anthropic).
 */

import { QUALITY_PROMPTS } from "../tests/fixtures/quality-prompts.gold";
import { runPrompt, type PromptRunResult } from "../lib/ai/evals/quality-bench-core";

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const json = args.includes("--json");
  const idsArg = args.find((a) => a.startsWith("--ids="));
  const filterIds = idsArg
    ? idsArg.replace("--ids=", "").split(",").map((s) => s.trim())
    : null;

  if (!json) {
    console.log(
      `\n🎯 quality benchmark · ${QUALITY_PROMPTS.length} prompts ${dry ? "(dry-run)" : "(live)"}\n`,
    );
  }

  const prompts = filterIds
    ? QUALITY_PROMPTS.filter((p) => filterIds.includes(p.id))
    : QUALITY_PROMPTS;

  if (prompts.length === 0) {
    console.error("No prompts matched filter ·", filterIds);
    process.exit(2);
  }

  const results: PromptRunResult[] = [];
  for (const prompt of prompts) {
    const r = await runPrompt(prompt, dry);
    results.push(r);
    if (!json) {
      const icon = r.pass ? "✅" : "❌";
      console.log(`  ${icon} ${r.id}`);
      if (!r.pass) {
        console.log(`     ${r.description}`);
        for (const c of r.checks) {
          if (!c.pass) {
            console.log(`     · ${c.check}: ${c.detail}`);
          }
        }
        if (r.error) console.log(`     · error: ${r.error}`);
      }
      if (r.durationMs) {
        console.log(`     (${r.durationMs}ms${r.outputLength ? ` · ${r.outputLength} chars` : ""})`);
      }
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  if (json) {
    console.log(
      JSON.stringify(
        {
          summary: { total: results.length, passed, failed },
          mode: dry ? "dry" : "live",
          generatedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `\n📊 ${passed}/${results.length} pass · ${failed} fail${dry ? " (dry)" : ""}\n`,
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[quality-bench] fatal:", err);
  process.exit(2);
});
