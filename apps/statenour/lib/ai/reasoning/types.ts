/**
 * lib/ai/reasoning/types.ts · Phase H (2026-05-18 PM)
 *
 * Shared types for the Nick Reasoning Engine.
 *
 * The engine produces a structured trace the operator can SEE — every
 * reasoning step has a label, a timestamp, optional input/output, and
 * a duration. This is the "show your work" surface that makes deep
 * mode feel different from quick mode.
 */

export type ReasoningStepKind =
  | "classify"
  | "decompose"
  | "plan"
  | "fanout"
  | "agent_call"
  | "tool_call"
  | "critique"
  | "refine"
  | "deliver";

export interface ReasoningStep {
  /** Stable enum of step kinds · drives icon + color in the UI */
  kind: ReasoningStepKind;
  /** Human-readable one-line label · e.g. "decomposed into 3 sub-questions" */
  label: string;
  /** Optional structured detail · varies by kind */
  detail?: unknown;
  /** ms since the run started */
  elapsedMs: number;
  /** Per-step latency · how long this step alone took */
  durationMs: number;
}

export interface ReasoningTrace {
  /** All steps in order */
  steps: ReasoningStep[];
  /** Final answer · streamed if streaming · single string if not */
  answer: string;
  /** Confidence in the answer · 0-1 */
  confidence: number;
  /** Total wall time */
  totalMs: number;
  /** Aggregate token / cost estimate (best-effort) */
  cost: {
    /** Approximate USD · 0 if unknown */
    usd: number;
    /** Number of LLM calls made */
    calls: number;
  };
}

/** What kind of reasoning does this question need? */
export type ReasoningTier =
  /** No deep mode · pass through to standard chat */
  | "quick"
  /** Run pretask fanout + critique · ~3-5s · ~$0.005 */
  | "standard"
  /** Run multi-agent + fanout + critique · ~8-15s · ~$0.02 */
  | "deep"
  /** Run deep-research + multi-agent + critique · ~30-60s · ~$0.10 */
  | "thorough"
  /** Phase H.2 · Mega Charizard · deep-research + multi-agent + ghost-nick
   *  predictions + wisdom citation in one composite. The biggest hammer
   *  for the hardest questions. ~60-120s · ~$0.20+ */
  | "mega";

export interface ReasoningRequest {
  /** The question to reason about */
  question: string;
  /** Optional brain context to ground the lenses · pass the operator's
   *  current page context, recent decisions, etc. */
  brainContext?: string;
  /** Override the auto-classifier · pass undefined for auto */
  tier?: ReasoningTier;
  /** Operator id · used for memory writes + audit trail */
  operatorId?: string;
  /** H.7.3 · opt out of trace persistence for sensitive runs.
   *  When false, the run completes normally but no BrainMemory(
   *  reasoning_trace) row is written. The trade-off: the run is
   *  invisible in /reason/history AND its cost is missing from
   *  the budget reader (so it won't count against tomorrow's cap
   *  · counts against today's only via the in-flight reservation
   *  while running). Defaults to true (persist).
   *
   *  Operator triggers this with `@private` or `/private` marker
   *  in the question · classifier strips the marker + sets this. */
  persist?: boolean;
}

export interface ReasoningResult {
  /** The complete reasoning trace */
  trace: ReasoningTrace;
  /** The tier the engine ran at */
  tier: ReasoningTier;
  /** The classifier rationale (if auto-classified) */
  classifierReason: string;
}
