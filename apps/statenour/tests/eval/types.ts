/**
 * tests/eval/types.ts · Nick regression eval suite (task #14 · 2026-05-23).
 *
 * Shared types + Zod schema for the LLM-as-judge regression suite: replays
 * a frozen seed of scenarios through Nick + scores via the 5-axis judge
 * (lib/ai/judge-eval.ts), answering "did Nick's *quality* shift?".
 *
 * This used to sit alongside a deterministic substring-predicate harness
 * at lib/eval/regression-runner.ts that answered "did the basics break?".
 * That harness was deleted 2026-08-09 as dead code (no production caller,
 * its page redirected away, its output store never had a writer).
 *
 * The runner has two modes by design:
 *   · dry-run (default) · validates scenario JSON · NO LLM calls · CI-safe
 *   · --live · actually calls Nick + judges · operator-only · costs ¢/run
 *
 * Why both: the contract test (run-suite.test.ts) needs to validate the
 * scenario schema without hitting paid APIs. The operator wants the
 * live run available behind a single flag when they're explicitly
 * spending money to measure quality drift.
 */
import { z } from "zod";

// ── Scenario schema (Zod · strict z.object per repo convention) ──────

export const scenarioCategoryValues = [
  "decision",
  "memory",
  "task",
  "brief",
  "edge",
  "refusal",
  "multi-turn",
  // 2026-08-18 · obedience / anti-sycophancy / calibration golden set —
  // the measurement layer for the persona traits GATE-2026-08-14 found
  // asserted in the prompt but verified nowhere. Case design adapts
  // published eval methodology (SycEval's regressive-sycophancy +
  // preemptive-rebuttal findings, Anthropic's "are you sure?" flip,
  // feedback-ownership bias, TRUTH DECAY multi-turn pressure) onto
  // real recorded operator-complaint lineage (auto-taskify v10.0.391,
  // sycophantic openers v10.0.392, the Bay 5 fabrication v10.0.162).
  "persona",
] as const;
export type ScenarioCategory = (typeof scenarioCategoryValues)[number];

export const scenarioMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1, "message content must be non-empty"),
});

export const judgeCriterionSchema = z.object({
  /** Stable slug · referenced in the JudgeResult payload. */
  id: z.string().min(1),
  /** What the judge looks for · max 200 chars (the rubric prompt is finite). */
  description: z.string().min(1).max(200),
  /** 0–10 weight on the composite · defaults to 1.0. */
  weight: z.number().min(0).max(10).default(1.0),
});

export const scenarioSchema = z.object({
  /** Stable slug · used as the report key + filename stem. */
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/, "id must be lowercase slug"),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: z.enum(scenarioCategoryValues),
  input: z.object({
    messages: z.array(scenarioMessageSchema).min(1, "input must have ≥1 message"),
  }),
  /**
   * Optional setup hints · text fragments only · the runner doesn't
   * mutate state from these. Kept as a free-form string array so the
   * scenario can describe a context ("assume 3 pending tasks") without
   * the suite needing to actually create that state. The judge sees
   * these as context when scoring.
   */
  contextSetup: z.array(z.string().min(1).max(300)).optional(),
  /**
   * 1–6 criteria the judge scores. More than 6 dilutes the signal and
   * pushes the rubric over the LLM's working budget.
   */
  judgeCriteria: z.array(judgeCriterionSchema).min(1).max(6),
  /** Human-readable expectation · operator docs · NOT shown to judge. */
  expectedBehavior: z.string().min(1).max(500).optional(),
  /** Free-form tags · `voice`, `brain`, `safety`, etc. */
  tags: z.array(z.string().min(1).max(40)).optional(),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioMessage = z.infer<typeof scenarioMessageSchema>;
export type JudgeCriterion = z.infer<typeof judgeCriterionSchema>;

// ── Judge result (per-scenario × per-criterion) ──────────────────────

export interface JudgeCriterionScore {
  criterionId: string;
  /** 0–10 (matches lib/ai/judge-eval.ts JudgeRubric scale). */
  score: number;
  /** One-line judge rationale · max ~80 chars (rubric instruction). */
  rationale: string;
}

export interface JudgeResult {
  scenarioId: string;
  /** Nick's actual response text (truncated to 2000 chars for storage). */
  responsePreview: string;
  /** Per-criterion scores · same length + order as scenario.judgeCriteria. */
  criterionScores: JudgeCriterionScore[];
  /** Weighted mean of criterion scores (0–10). */
  composite: number;
  /** True when composite < 6.0 (matches judge-eval.ts threshold). */
  flagForReview: boolean;
  /** Model/provider that did the judging · e.g. `openai:gpt-4o-mini`. */
  judgedBy: string;
  /** End-to-end ms for Nick + judge. */
  durationMs: number;
  /** Set when Nick or the judge errored · null on success. */
  error: string | null;
}

// ── Suite-level report ──────────────────────────────────────────────

export interface SuiteSummary {
  totalScenarios: number;
  ranScenarios: number;
  /** Scenarios whose composite ≥ 6.0. */
  passing: number;
  /** Composite < 6.0 (flagForReview === true). */
  flagged: number;
  /** Errored (Nick or judge threw). */
  errored: number;
  /** Mean composite across non-errored runs. */
  meanComposite: number;
}

export interface SuiteReport {
  /** Wall-clock ISO timestamp the suite started. */
  ranAt: string;
  /** `dry-run` validates scenarios without calling Nick. */
  mode: "dry-run" | "live";
  /** Optional category filter that was applied. */
  filter: ScenarioCategory | null;
  /** Per-scenario results · empty in dry-run mode. */
  results: JudgeResult[];
  summary: SuiteSummary;
  /** Total suite wall-clock duration. */
  durationMs: number;
}
