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
import { createHash } from "node:crypto";
import { langfuseTelemetry } from "@/lib/observability/langfuse";
import { specificityDensity } from "@/lib/ai/nour-voice-profile";
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
  /** No model output to judge (provider threw, or returned nothing). An
   *  outage, not a quality failure: excluded from failed and pass_rate. */
  errored?: boolean;
  /** Model id the prompt ran against. */
  model?: string;
  /** Length of the production system prompt the prompt ran under. */
  systemPromptLength?: number;
  durationMs?: number;
}

export interface BenchSummary {
  results: PromptRunResult[];
  total: number;
  passed: number;
  /** Prompts whose output was judged and failed a check. Excludes errored. */
  failed: number;
  failedIds: string[];
  /** Prompts with no output to judge (provider outage). */
  errored: number;
  erroredIds: string[];
  /** Model id the bench ran against (null when no prompt reached a model). */
  model: string | null;
}

// ── Check helpers ────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
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

/**
 * Canonical specificity check.
 *
 * Before 2026-09-13 this benchmark had a second implementation that counted
 * any capitalized token / digit and returned an integer percentage, while the
 * live critic used nour-voice-profile's marker density. Both were called
 * "specificity density" despite incompatible units. The benchmark now calls
 * the same deterministic function as production.
 */
export function checkSpecificityMarkerDensity(output: string, min: number): CheckResult {
  const density = specificityDensity(output);
  return {
    check: "minSpecificityMarkerDensity",
    pass: density >= min,
    detail: `specificity-marker-density ${density.toFixed(2)}/100w (floor: ${min.toFixed(2)})`,
  };
}

/**
 * Identity of the gold set: a pass rate compares only against a run of the same
 * set (06-X3). RegExp checks are spelled out because JSON.stringify drops them.
 */
export function goldSetHash(prompts: readonly QualityPrompt[]): string {
  const json = JSON.stringify(prompts, (_k, v: unknown) => (v instanceof RegExp ? v.toString() : v));
  return createHash("sha256").update(json).digest("hex").slice(0, 12);
}

// ── Model invocation ─────────────────────────────────────────────────

async function callModel(prompt: QualityPrompt): Promise<{ output: string; model: string; systemPromptLength: number }> {
  // Use the in-codebase provider stack so the bench tests the SAME
  // path that production uses. This includes the model selection, the
  // env override, the brand context, etc.
  const { generateText } = await import("ai");
  const { getModel } = await import("@/lib/ai/provider");

  // No task argument = the provider stack's default lane. The script this was
  // extracted from passed the string "default", which is not a TaskType — it
  // only typechecked because scripts/ is excluded from tsc.
  const model = getModel();
  const modelId = (model as { modelId?: string }).modelId ?? String(model);

  // The production prompt, tiered like the chat route; without it the bench graded the bare model (06-F7).
  const { buildSystemPromptUncached, detectTopicTier } = await import("@/lib/ai/system-prompt");
  const system = await buildSystemPromptUncached(detectTopicTier(prompt.user), prompt.user);

  // Build messages · simulates a chat turn with optional prior context
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (prompt.priorAssistant) {
    messages.push({ role: "assistant", content: prompt.priorAssistant });
  }
  messages.push({ role: "user", content: prompt.user });

  const { text } = await generateText({
    model,
    experimental_telemetry: langfuseTelemetry({ functionId: "quality-bench", tags: ["eval"] }),
    system,
    messages: messages as never,
    maxOutputTokens: 600,
    temperature: 0.5,
    abortSignal: AbortSignal.timeout(30000),
  });

  // An empty completion is generateText's version of the aiChat outage
  // sentinel: there is nothing to judge, so it is errored, not a failure.
  if (!text || text.trim().length === 0) {
    throw new Error(`empty completion from ${modelId}`);
  }

  // Run through the sanitizer · matches production path
  const { sanitizeResponse } = await import("@/lib/ai/output-sanitizer");
  return { output: sanitizeResponse(text).cleaned, model: modelId, systemPromptLength: system.length };
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
  let called: { output: string; model: string; systemPromptLength: number };
  try {
    called = await callModel(prompt);
  } catch (e) {
    // A provider failure, never a verdict on the model's output.
    result.error = (e as Error).message;
    result.pass = false;
    result.errored = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  try {
    const { output, model, systemPromptLength } = called;
    result.model = model;
    result.systemPromptLength = systemPromptLength;
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
    if (typeof prompt.checks.minSpecificityMarkerDensity === "number") {
      result.checks.push(
        checkSpecificityMarkerDensity(
          output,
          prompt.checks.minSpecificityMarkerDensity,
        ),
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
    // The harness crashed while checking: no verdict on the output, so never a drift alert.
    result.error = (e as Error).message;
    result.pass = false;
    result.errored = true;
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
  const erroredIds = results.filter((r) => r.errored).map((r) => r.id);
  const failedIds = results.filter((r) => !r.pass && !r.errored).map((r) => r.id);
  return {
    results,
    total: results.length,
    passed: results.length - failedIds.length - erroredIds.length,
    failed: failedIds.length,
    failedIds,
    errored: erroredIds.length,
    erroredIds,
    model: results.find((r) => r.model)?.model ?? null,
  };
}
