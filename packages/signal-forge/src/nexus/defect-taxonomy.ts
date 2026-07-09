import { DefectCode } from "../shared/types.js";

// Helper to ensure safe mapping from domain rules to strict schema strings
export const DEFECT_MAP: Record<DefectCode, string> = {
  "H1_FACTUAL_HALLUCINATION": "H1 Factual hallucination",
  "H2_UNSUPPORTED_CLAIM": "H2 Unsupported claim",
  "H3_REASONING_LEAP": "H3 Reasoning leap",
  "H4_MISLEADING_CERTAINTY": "H4 Misleading certainty",
  "R1_RETRIEVAL_MISS": "R1 Retrieval miss",
  "R2_LOW_RELEVANCE": "R2 Low-relevance context",
  "R3_CONTEXT_INSUFFICIENCY": "R3 Context insufficiency",
  "R4_CITATION_MISMATCH": "R4 Citation mismatch",
  "T1_WRONG_TOOL": "T1 Wrong tool choice",
  "T2_TOOL_RESULT_MISUSE": "T2 Tool result misuse",
  "T3_BROKEN_SEQUENCING": "T3 Broken sequencing",
  "T4_UNVERIFIED_ACTION": "T4 Action without verified prerequisite",
  "SEC1_PROMPT_INJECTION": "S1 Prompt injection susceptibility",
  "SEC2_INSECURE_OUTPUT": "S2 Insecure output handling risk",
  "SEC3_DATA_EXPOSURE": "S3 Sensitive data exposure risk",
  "SEC4_LEAKAGE": "S4 Prompt or policy leakage risk",
  "SEC5_EXCESSIVE_AGENCY": "S5 Excessive agency / unsafe action tendency",
  "O1_ORCHESTRATION_FAILURE": "O1 Orchestration failure",
  "O2_FALLBACK_FAILURE": "O2 Fallback failure",
  "O3_STATE_WEAKNESS": "O3 State tracking weakness",
  "C1_CONTEXT_BLOAT": "C1 Unnecessary context bloat",
  "C2_REDUNDANT_SPEND": "C2 Redundant retrieval or tool spend",
  "L1_LATENCY_RISK": "L1 Latency amplification risk",
  "Q1_INCOMPLETE_ANSWER": "Q1 Incomplete answer",
  "Q2_MISLEADING_CONFIDENCE": "Q2 Misleading confidence",
  "Q3_WEAK_ESCALATION": "Q3 Weak escalation behavior"
};
