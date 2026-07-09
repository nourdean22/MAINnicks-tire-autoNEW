export type LlmProvider = {
  invoke: (request: {
    system: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    outputSchema?: unknown;
    maxTokens?: number;
    timeoutMs?: number;
  }) => Promise<unknown>;
};

export type SignalForgeMode = "control" | "nexus";
export type WorkflowPattern = "single_agent" | "single_agent_with_tools" | "multi_agent";

// Namespace isolation: Score dimensions start with SCORE_
export type ScoreDimensionId =
  | "SCORE_S1_SIGNAL_FIT"
  | "SCORE_S2_CONTEXT_SUFFICIENCY"
  | "SCORE_S3_CLAIM_FAITHFULNESS"
  | "SCORE_S4_WORKFLOW_INTEGRITY"
  | "SCORE_S5_SECURITY_RESILIENCE"
  | "SCORE_S6_COMPLETENESS"
  | "SCORE_S7_CLARITY_AND_COHERENCE"
  | "SCORE_S8_COST_AND_LATENCY"
  | "SCORE_S9_FALLBACK_READINESS"
  | "SCORE_S10_RELEASE_READINESS";

// Namespace isolation: Defect codes
export type DefectCode =
  | "H1_FACTUAL_HALLUCINATION"
  | "H2_UNSUPPORTED_CLAIM"
  | "H3_REASONING_LEAP"
  | "H4_MISLEADING_CERTAINTY"
  | "R1_RETRIEVAL_MISS"
  | "R2_LOW_RELEVANCE"
  | "R3_CONTEXT_INSUFFICIENCY"
  | "R4_CITATION_MISMATCH"
  | "T1_WRONG_TOOL"
  | "T2_TOOL_RESULT_MISUSE"
  | "T3_BROKEN_SEQUENCING"
  | "T4_UNVERIFIED_ACTION"
  | "SEC1_PROMPT_INJECTION"
  | "SEC2_INSECURE_OUTPUT"
  | "SEC3_DATA_EXPOSURE"
  | "SEC4_LEAKAGE"
  | "SEC5_EXCESSIVE_AGENCY"
  | "O1_ORCHESTRATION_FAILURE"
  | "O2_FALLBACK_FAILURE"
  | "O3_STATE_WEAKNESS"
  | "C1_CONTEXT_BLOAT"
  | "C2_REDUNDANT_SPEND"
  | "L1_LATENCY_RISK"
  | "Q1_INCOMPLETE_ANSWER"
  | "Q2_MISLEADING_CONFIDENCE"
  | "Q3_WEAK_ESCALATION";

export type SeverityLevel = "critical" | "high" | "medium" | "low" | "none";

export type ReleaseGateDecision = "Ship" | "Ship with caution" | "Hold release" | "Block release";

export type VerificationVerdict = "supported" | "unsupported" | "weakly supported" | "unverifiable" | "structural risk";
