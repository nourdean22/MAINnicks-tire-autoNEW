/**
 * Quality benchmark core · extracted 2026-08-05 from
 * scripts/run-quality-bench.ts so the SAME runner serves both the CLI script
 * and the weekly Inngest schedule (quality-bench-weekly). The script had
 * carried "weekly cron + manual after model swaps is the intended cadence" in
 * its header since Phase 4 while nothing ever scheduled it.
 *
 * Fires each gold prompt against the current model + sanitizer + critic stack
 * and reports pass/fail per check — the production path, deliberately: model
 * selection, env override, sanitizer all included, so a failure means the
 * model OR the system prompt OR the sanitizer pipeline regressed.
 */
import type { QualityCheck, QualityPrompt } from "@/tests/fixtures/quality-prompts.gold";

export interface CheckResult {
  check: keyof QualityCheck;
  pass: boolean;
  detail?: string;
}

export interface PromptRunResult {
  id: string;
  description: string;
  output?: string;
  outputLength?: number;
  checks: CheckResult[];
  pass: boolean;
  error?: string;
  durationMs?: number;
}

export interface BenchSummary {
  results: PromptRunResult[];
  total: number;
  passed: number;
  failed: number;
  failedIds: string[];
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

  // No task argument = the provider stack's default lane. The script this was
  // extracted from passed the string "default", which is not a TaskType — it
  // only typechecked because scripts/ is excluded from tsc.
  const model = getModel();

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

export async function runPrompt(prompt: QualityPrompt, dry: boolean): Promise<PromptRunResult> {
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
        // The extracted script passed prompt.intent here, but the intent
        // vocabulary (creative/factual/actionable/summary) was never a valid
        // OutputShape — the invalid string fell through to no-shape-branch
        // behavior. The declared default ("prose") is that handling, named.
        const critic = critiqueOutput(output);
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

/** Run the full bench sequentially (live model calls unless `dry`). */
export async function runQualityBench(
  prompts: readonly QualityPrompt[],
  options: { dry?: boolean } = {},
): Promise<BenchSummary> {
  const results: PromptRunResult[] = [];
  for (const prompt of prompts) {
    results.push(await runPrompt(prompt, options.dry ?? false));
  }
  const failedIds = results.filter((r) => !r.pass).map((r) => r.id);
  return {
    results,
    total: results.length,
    passed: results.length - failedIds.length,
    failed: failedIds.length,
    failedIds,
  };
}
