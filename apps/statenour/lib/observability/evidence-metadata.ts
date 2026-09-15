/**
 * Evidence-grade tags on Langfuse traces — provenance for free.
 *
 * Langfuse metadata is a flat key/value bag (string values <= 200 chars) that
 * propagates from trace to spans and is filterable in the UI. Tagging every
 * AI call that produces or consumes a claim with its evidence grade means
 * "show me every generation that leaned on H0-H1 evidence" is a filter, not
 * a new system — and it rides the OTel provider Sentry already shares
 * (instrumentation.ts), so nothing new is initialised.
 */
import type { LangfuseTelemetryInput } from "./langfuse";

export type EvidenceGrade = "H0" | "H1" | "H2" | "H3" | "H4" | "H5";

export interface EvidenceRef {
  grade: EvidenceGrade;
  claimId?: string;
  hypothesisId?: string;
  goalId?: string;
  contractHash?: string;
}

const MAX = 200;
const clip = (v: string | undefined) => (v === undefined ? undefined : v.slice(0, MAX));

/** Flat, clipped, prefixed keys. */
export function evidenceMetadata(ref: EvidenceRef): Record<string, string> {
  const out: Record<string, string> = { evidence_grade: ref.grade };
  const c = clip(ref.claimId);
  const h = clip(ref.hypothesisId);
  const g = clip(ref.goalId);
  const k = clip(ref.contractHash);
  if (c) out.evidence_claim_id = c;
  if (h) out.evidence_hypothesis_id = h;
  if (g) out.evidence_goal_id = g;
  if (k) out.evidence_contract_hash = k;
  return out;
}

/** Merge into an existing telemetry input; the grade also becomes a low-cardinality tag. */
export function withEvidence(input: LangfuseTelemetryInput, ref: EvidenceRef): LangfuseTelemetryInput {
  const tag = `evidence:${ref.grade}`;
  return {
    ...input,
    tags: Array.from(new Set([...(input.tags ?? []), tag])),
    metadata: { ...(input.metadata ?? {}), ...evidenceMetadata(ref) },
  };
}
