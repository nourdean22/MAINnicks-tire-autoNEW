/**
 * NICK VNEXT · typed Claim/Evidence ledger — SHADOW schema (2026-08-11).
 *
 * Truth as STATE, not writing style: a material assertion in a
 * high-stakes answer becomes a typed Claim whose support is a set of
 * evidence references graded on the SAME evidence ladder the memory
 * commit gateway already enforces (lib/brain/memory-commit-gateway.ts
 * MemoryEvidenceClass) — one vocabulary across both surfaces, no
 * parallel taxonomy. Pure types + zod + derivation helpers; nothing
 * imports this into the live chat path yet (additive-migration rule:
 * route traffic only after it wins an eval).
 *
 * Vocabulary alignment is enforced at COMPILE TIME: if the gateway
 * union gains or renames a class, the satisfies + both-ways check below
 * breaks the build instead of letting the two ladders drift.
 */
import { z } from "zod";
import type { MemoryEvidenceClass } from "@/lib/brain/memory-commit-gateway";

export const MEMORY_EVIDENCE_CLASSES = [
  "operator_stated",
  "direct_observation",
  "system_receipt",
  "external_source",
  "supported_inference",
  "weak_inference",
  "prediction",
  "generated_summary",
] as const satisfies readonly MemoryEvidenceClass[];

// Both-ways lock: every member of the gateway union must appear above.
type EveryClassListed = MemoryEvidenceClass extends (typeof MEMORY_EVIDENCE_CLASSES)[number]
  ? true
  : never;
const everyClassListed: EveryClassListed = true;
void everyClassListed;

/**
 * Mirrors the gateway's CLASS_STRENGTH ladder. Deliberately NOT a value
 * import: memory-commit-gateway's module scope pulls prisma, and this
 * module must stay importable from client-reachable code (same trap the
 * v10.0.209 note in lib/ai/provider.ts records). Keys are type-locked
 * to the gateway union, so renames still break the build here.
 */
export const EVIDENCE_STRENGTH: Record<MemoryEvidenceClass, number> = {
  operator_stated: 6,
  system_receipt: 5,
  direct_observation: 4,
  external_source: 3,
  supported_inference: 2,
  generated_summary: 1,
  prediction: 1,
  weak_inference: 0,
};

export const CLAIM_KINDS = [
  "OBSERVED",
  "RETRIEVED",
  "INFERRED",
  "SPECULATIVE",
  "RECOMMENDATION",
] as const;

export const CLAIM_CONFIDENCE = ["HIGH", "MED", "LOW"] as const;

export const CLAIM_VERIFICATION = ["SUPPORTED", "PARTIAL", "CONTRADICTED", "UNKNOWN"] as const;

export const evidenceRefSchema = z.object({
  id: z.string().min(1),
  evidenceClass: z.enum(MEMORY_EVIDENCE_CLASSES),
  /** "brain:123" · "receipt:tool-exec:456" · a URL · "user:turn:789" */
  sourceRef: z.string().min(1),
  /** ISO timestamp of when this evidence was observed. */
  observedAt: z.string().min(1),
  /** Untrusted evidence can INFORM a claim but never SUPPORT it (see deriveVerification). */
  trust: z.enum(["TRUSTED", "UNTRUSTED"]),
  contentHash: z.string().optional(),
});

export const claimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(CLAIM_KINDS),
  /** 0-1 · how much the answer depends on this claim. */
  materiality: z.number().min(0).max(1),
  /** 0-1 · how fast the fact can change → drives mandatory retrieval. */
  volatility: z.number().min(0).max(1),
  confidence: z.enum(CLAIM_CONFIDENCE),
  evidence: z.array(evidenceRefSchema),
  contradictionIds: z.array(z.string()).default([]),
  verification: z.enum(CLAIM_VERIFICATION),
});

/**
 * Per-turn runtime transparency — resolved model, effort, whether the
 * fallback chain fired, whether a refusal occurred. This is the shape
 * the Context & Evidence panel reads once the ledger goes live.
 */
export const turnMetaSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  fallbackFired: z.boolean(),
  refusal: z.boolean().default(false),
  costUsd: z.number().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
});

export const claimLedgerSchema = z.object({
  claims: z.array(claimSchema),
  meta: turnMetaSchema,
});

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type TurnMeta = z.infer<typeof turnMetaSchema>;
export type ClaimLedger = z.infer<typeof claimLedgerSchema>;
export type ClaimVerification = (typeof CLAIM_VERIFICATION)[number];

/** external_source (3) is the minimum ladder rung that can carry a claim alone. */
export const SUPPORT_THRESHOLD = EVIDENCE_STRENGTH.external_source;

/**
 * Derive a claim's verification state from its evidence. Rules:
 *   · only TRUSTED evidence counts toward support — a Tier-D fact does
 *     not become Tier-A because a strong model read it, and untrusted
 *     content never mints support (or authority);
 *   · contradictions demote: strong support + contradiction → PARTIAL,
 *     weak-or-no support + contradiction → CONTRADICTED;
 *   · weak-only trusted evidence → PARTIAL, none → UNKNOWN.
 */
export function deriveVerification(
  evidence: EvidenceRef[],
  hasContradiction: boolean,
): ClaimVerification {
  const trusted = evidence.filter((e) => e.trust === "TRUSTED");
  const strongest =
    trusted.length > 0 ? Math.max(...trusted.map((e) => EVIDENCE_STRENGTH[e.evidenceClass])) : -1;
  if (hasContradiction) return strongest >= SUPPORT_THRESHOLD ? "PARTIAL" : "CONTRADICTED";
  if (strongest >= SUPPORT_THRESHOLD) return "SUPPORTED";
  if (strongest >= 0) return "PARTIAL";
  return "UNKNOWN";
}

/**
 * 2026-08-11 · server-derived verification. A model (or any caller) must
 * NEVER supply its own `verification` — that would let a turn stamp
 * "SUPPORTED" onto empty evidence. The input schema refuses the field
 * entirely (strict), and parseClaimLedger() derives verification
 * mathematically from the evidence + contradictions on every claim.
 * (zod strips unknown keys by default, so a smuggled `verification`
 * field is dropped at parse and the derivation below is authoritative.)
 */
export const claimInputSchema = claimSchema.omit({ verification: true });

export const claimLedgerInputSchema = z.object({
  claims: z.array(claimInputSchema),
  meta: turnMetaSchema,
});

/** Parse an untrusted ledger payload; verification is ALWAYS derived here. */
export function parseClaimLedger(input: unknown): ClaimLedger {
  const parsed = claimLedgerInputSchema.parse(input);
  return {
    ...parsed,
    claims: parsed.claims.map((c) => ({
      ...c,
      verification: deriveVerification(c.evidence, c.contradictionIds.length > 0),
    })),
  };
}

const CONFIDENCE_UNCERTAINTY: Record<(typeof CLAIM_CONFIDENCE)[number], number> = {
  HIGH: 0.1,
  MED: 0.4,
  LOW: 0.7,
};

/** Above this materiality x uncertainty x irreversibility product, a turn must be verified BEFORE release. */
export const BLOCKING_VERIFIER_THRESHOLD = 0.25;

/**
 * The blocking-verifier gate (plan §4.2): pay verification latency only
 * where a wrong answer is expensive. The cheap post-turn critic still
 * runs everywhere; this decides which turns get a verifier BEFORE the
 * answer is released. Reversible turns discount irreversibility to 0.4
 * rather than 0 — a reversible-but-material wrong answer still misleads,
 * so the gate stays REACHABLE at maximum materiality + LOW confidence
 * (1.0 x 0.7 x 0.4 = 0.28 > threshold) without firing on ordinary turns.
 */
export function requiresBlockingVerification(input: {
  materiality: number;
  confidence: (typeof CLAIM_CONFIDENCE)[number];
  irreversible: boolean;
}): boolean {
  const uncertainty = CONFIDENCE_UNCERTAINTY[input.confidence];
  const irreversibility = input.irreversible ? 1 : 0.4;
  return input.materiality * uncertainty * irreversibility > BLOCKING_VERIFIER_THRESHOLD;
}
