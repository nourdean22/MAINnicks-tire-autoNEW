/**
 * Quality benchmark runner · v10.0.345 · Phase 4 of glitch taxonomy
 * hardening (Category 7 · quality regressions).
 *
 * Loads `tests/fixtures/quality-prompts.gold.ts`, fires each prompt
 * against the current model + sanitizer + critic stack, then reports
 * pass/fail per check. Drift detection · failures mean the model OR
 * the system prompt OR the sanitizer pipeline regressed since the
 * last clean run.
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
 * × ~$0.01-0.03 each via Venice/Anthropic). Don't run on every PR ·
 * weekly cron + manual after model swaps is the intended cadence.
 *
 * Per docs/glitch-taxonomy.md · Category 7 · "quality benchmark per
 * use case" prevention mechanism.
 */

import {
  QUALITY_PROMPTS,
  type QualityCheck,
  type QualityPrompt,
} from "../tests/fixtures/quality-prompts.gold";

interface CheckResult {
  check: keyof QualityCheck;
  pass: boolean;
  detail?: string;
}

interface PromptRunResult {
  id: string;
  description: string;
  output?: string;
  outputLength?: number;
  checks: CheckResult[];
  pass: boolean;
  error?: string;
  durationMs?: number;
}

// ── Check helpers ────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function specDensity(text: string): number {
  // Density score · proper nouns + numbers per 100 words. Loose proxy
  // for "specificity" — a fluffy reply scores low, an operator-grade
  // reply with proper names + numbers + dollar figures scores high.
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let specCount = 0;
  for (const w of words) {
    // Capitalized non-sentence-start, or contains digit, or $ sign
    if (/[A-Z]/.test(w[0] ?? "") && words.indexOf(w) > 0) specCount++;
    else if (/\d/.test(w)) specCount++;
    else if (w.includes("$")) specCount++;
  }
  return Math.round((specCount / words.length) * 100);
}

function checkMustMention(
  output: string,
  patterns: Array<string | RegExp>,
): CheckResult {
  const missing: string[] = [];
  for (const p of patterns) {
    const re = typeof p === "string" ? new RegExp(p, "i") : p;
    if (!re.test(output)) missing.push(re.source);
  }
  return {
    check: "mustMention",
    pass: missing.length === 0,
    detail: missing.length === 0
      ? `all ${patterns.length} required patterns matched`
      : `missing: ${missing.join(", ")}`,
  };
}

function checkMustNotContain(
  output: string,
  patterns: Array<string | RegExp>,
): CheckResult {
  const found: string[] = [];
  for (const p of patterns) {
    const re = typeof p === "string" ? new RegExp(p, "i") : p;
    if (re.test(output)) found.push(re.source);
  }
  return {
    check: "mustNotContain",
    pass: found.length === 0,
    detail: found.length === 0
      ? `none of ${patterns.length} forbidden patterns found`
      : `found: ${found.join(", ")}`,
  };
}

function checkWordCount(
  output: string,
  min?: number,
  max?: number,
): CheckResult[] {
  const results: CheckResult[] = [];
  const wc = countWords(output);
  if (typeof min === "number") {
    results.push({
      check: "minWords",
      pass: wc >= min,
      detail: `${wc} words (floor: ${min})`,
    });
  }
  if (typeof max === "number") {
    results.push({
      check: "maxWords",
      pass: wc <= max,
      detail: `${wc} words (ceiling: ${max})`,
    });
  }
  return results;
}

function checkSpecDensity(output: string, min: number): CheckResult {
  const sd = specDensity(output);
  return {
    check: "minSpecDensity",
    pass: sd >= min,
    detail: `spec-density ${sd} (floor: ${min})`,
  };
}

// ── Model invocation ─────────────────────────────────────────────────

async function callModel(prompt: QualityPrompt): Promise<string> {
  // Use the in-codebase provider stack so the bench tests the SAME
  // path that production uses. This includes the model selection, the
  // env override, the brand context, etc.
  const { generateText } = await import("ai");
  const { getModel } = await import("@/lib/ai/provider");

  const model = getModel("default");

  // Build messages · simulates a chat turn with optional prior context
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (prompt.priorAssistant) {
    messages.push({ role: "assistant", content: prompt.priorAssistant });
  }
  messages.push({ role: "user", content: prompt.user });

  const { text } = await generateText({
    model,
    messages: messages as never,
    maxOutputTokens: 600,
    temperature: 0.5,
    abortSignal: AbortSignal.timeout(30000),
  });

  // Run through the sanitizer · matches production path
  const { sanitizeResponse } = await import("@/lib/ai/output-sanitizer");
  return sanitizeResponse(text).cleaned;
}

// ── Per-prompt runner ────────────────────────────────────────────────

async function runPrompt(prompt: QualityPrompt, dry: boolean): Promise<PromptRunResult> {
  const result: PromptRunResult = {
    id: prompt.id,
    description: prompt.description,
    checks: [],
    pass: true,
  };

  if (dry) {
    // Dry mode · just verify the prompt registry shape is sane
    if (!prompt.user || prompt.user.trim().length === 0) {
      result.pass = false;
      result.error = "empty user prompt";
    }
    if (Object.keys(prompt.checks).length === 0) {
      result.pass = false;
      result.error = "no checks defined";
    }
    return result;
  }

  const startedAt = Date.now();
  try {
    const output = await callModel(prompt);
    result.output = output;
    result.outputLength = output.length;
    result.durationMs = Date.now() - startedAt;

    // Run each check
    if (prompt.checks.mustMention) {
      result.checks.push(checkMustMention(output, prompt.checks.mustMention));
    }
    if (prompt.checks.mustNotContain) {
      result.checks.push(
        checkMustNotContain(output, prompt.checks.mustNotContain),
      );
    }
    result.checks.push(
      ...checkWordCount(output, prompt.checks.minWords, prompt.checks.maxWords),
    );
    if (typeof prompt.checks.minSpecDensity === "number") {
      result.checks.push(
        checkSpecDensity(output, prompt.checks.minSpecDensity),
      );
    }
    // Critic-overall floor · uses output-critic.ts
    if (typeof prompt.checks.minCriticOverall === "number") {
      try {
        const { critiqueOutput } = await import("@/lib/ai/output-critic");
        const critic = critiqueOutput(output, prompt.intent ?? "factual");
        result.checks.push({
          check: "minCriticOverall",
          pass: (critic.overall ?? 0) >= prompt.checks.minCriticOverall,
          detail: `critic.overall ${critic.overall ?? "n/a"} (floor: ${prompt.checks.minCriticOverall})`,
        });
      } catch (e) {
        result.checks.push({
          check: "minCriticOverall",
          pass: false,
          detail: `critic load failed: ${(e as Error).message}`,
        });
      }
    }

    result.pass = result.checks.every((c) => c.pass);
  } catch (e) {
    result.error = (e as Error).message;
    result.pass = false;
    result.durationMs = Date.now() - startedAt;
  }

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────

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
