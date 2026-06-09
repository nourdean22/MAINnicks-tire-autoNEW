/**
 * Memory-eval truth scoreboard — types.
 *
 * A typed dataset of "does Statenour know its own current truth?" checks:
 * deploy path, source-of-truth, stale-doc handling, migration safety, action
 * honesty, task classification, memory kinds, business + personal-OS context,
 * provider truth. Deterministic by default (grounds expected facts against real
 * repo docs); the optional answer-grading path supports a future LLM judge.
 *
 * No DB. No external API. See docs/project/NEXT-INTELLIGENCE-WAVE.md (P5).
 */

export type MemoryEvalCategory =
  | "deployment_truth"
  | "source_of_truth"
  | "stale_doc_detection"
  | "migration_safety"
  | "action_honesty"
  | "task_classification"
  | "memory_kind"
  | "business_context"
  | "personal_os_context"
  | "provider_truth";

export type EvalSeverity = "critical" | "high" | "medium" | "low";

export interface MemoryEval {
  /** Stable id (semantic kebab). Unique across the dataset. */
  id: string;
  category: MemoryEvalCategory;
  /** The question an agent/operator is implicitly answering. */
  question: string;
  /**
   * Case-insensitive substrings a correct answer (or grounding doc) MUST
   * contain. ANDed. Pick robust, low-ambiguity tokens.
   */
  expectedFacts: string[];
  /**
   * Case-insensitive substrings a correct ANSWER must NOT contain (stale/false
   * claims). Used only by gradeAnswer (with negator-awareness) — NOT applied to
   * grounding docs, which legitimately name retired terms to mark them retired.
   */
  forbiddenClaims: string[];
  severity: EvalSeverity;
  /** Where the truth is verifiable (for the operator). */
  sourceHints: string[];
  /**
   * Repo-relative doc whose content should TEACH expectedFacts. When present
   * and readable, the eval is graded deterministically against it. When absent
   * or unreadable, the eval is "manual".
   */
  groundingDoc?: string;
  tags?: string[];
}

export type EvalStatus = "pass" | "fail" | "manual";

export interface EvalOutcome {
  id: string;
  category: MemoryEvalCategory;
  severity: EvalSeverity;
  status: EvalStatus;
  /** How it was graded. */
  source: "doc" | "answer" | "none";
  missingFacts: string[];
  presentForbidden: string[];
  note?: string;
}

export interface MemoryEvalRunResult {
  total: number;
  passed: number;
  failed: number;
  manual: number;
  criticalFailures: EvalOutcome[];
  byCategory: Record<string, { total: number; passed: number; failed: number; manual: number }>;
  datasetIssues: string[];
  results: EvalOutcome[];
}
