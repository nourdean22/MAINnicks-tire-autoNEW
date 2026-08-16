/**
 * Memory Commit Gateway (spine-2, 2026-07-28 · Phase-1 live 2026-08-11 ·
 * Phase-2 opt-in 2026-08-16).
 *
 * ENFORCEMENT STATUS — read this before assuming a verdict is obeyed:
 *   · `noop`            ENFORCED by default (Phase-1, kill-switch
 *                       NICK_MEMORY_GATEWAY_PHASE1=0)
 *   · `update`          ENFORCED when NICK_MEMORY_GATEWAY_PHASE2=1
 *   · `review_required` ENFORCED when NICK_MEMORY_GATEWAY_PHASE2=1, and only
 *                       for reasonCode "weaker_evidence". "unknown_category"
 *                       still falls through on purpose — it is the larger
 *                       slice of the 349/wk and parking it would freeze
 *                       whole categories of automation writes.
 *   · `supersede` / `reinforce` / `add` — legacy behavior is already correct.
 * The enforcement itself lives in lib/brain/memory-manager.ts remember();
 * this module stays a pure decision function plus its shadow recorder.
 *
 * BrainMemory's write semantics treat any category/key re-sighting as
 * corroboration: reinforce() bumps confidence, three sightings make the
 * row permanent, and a changed content REPLACES the old claim while
 * STRENGTHENING it — even when every sighting came from the same
 * repeating automation. That is the audit's P0: no universal commit
 * authority.
 *
 * This module is the authority's first form. It does NOT change any
 * write today. `shadowMemoryCommit()` runs the pure evaluator beside
 * every remember() call and records what the gateway WOULD have decided
 * as a self-expiring shadow receipt. After ~a week the receipts get
 * compared against what the legacy path actually did; only then do
 * high-value writers route through the gateway for real (spine-3
 * deliberately ships only the safe subset).
 *
 * Design rule from the audit, kept: deterministic provenance + conflict
 * detection FIRST — no LLM in the write path.
 */
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { logError } from "@/lib/utils/error-log";

export type MemoryEvidenceClass =
  | "operator_stated"
  | "direct_observation"
  | "system_receipt"
  | "external_source"
  | "supported_inference"
  | "weak_inference"
  | "prediction"
  | "generated_summary";

export type MemoryDecision =
  | "add"
  | "reinforce"
  | "update"
  | "supersede"
  | "review_required"
  | "noop";

/**
 * Deterministic source → evidence-class mapping. Sources the operator
 * personally vouched for outrank machine inference; receipts outrank
 * summaries. Unknown sources default to weak_inference — never assume
 * strength.
 */
export function evidenceClassForSource(source: string): MemoryEvidenceClass {
  const s = source.toLowerCase();
  if (s === "user" || s === "manual" || s === "skill_ingestion") return "operator_stated";
  if (s.includes("receipt") || s.includes("tool-exec") || s.includes("action")) return "system_receipt";
  if (s.includes("observ") || s.includes("event")) return "direct_observation";
  if (s.includes("external") || s.includes("import") || s.includes("drive")) return "external_source";
  if (s.includes("predict")) return "prediction";
  if (s.includes("summary") || s.includes("brief") || s.includes("digest")) return "generated_summary";
  if (s.includes("infer") || s.includes("insight") || s.includes("pattern")) return "supported_inference";
  return "weak_inference";
}

const CLASS_STRENGTH: Record<MemoryEvidenceClass, number> = {
  operator_stated: 6,
  system_receipt: 5,
  direct_observation: 4,
  external_source: 3,
  supported_inference: 2,
  generated_summary: 1,
  prediction: 1,
  weak_inference: 0,
};

export interface MemoryCandidate {
  category: string;
  key: string;
  content: string;
  source: string;
  /** true when validateAndCanonicalizeCategory recognized the category */
  categoryKnown: boolean;
}

export interface ExistingMemoryFacts {
  content: string;
  source: string;
  seenCount: number;
  confidence: number;
}

/**
 * Machine-readable companion to `reason`. Phase-2 enforcement needs to treat
 * the two review_required causes differently — unknown-category is ~5x the
 * volume of weaker-evidence contradiction (349/wk combined, measured
 * 2026-08-11) and parking both at once would freeze whole categories of
 * automation writes. String-matching `reason` to tell them apart would be a
 * latent break the moment someone rewords a message.
 */
export type MemoryVerdictReason =
  | "unknown_category"
  | "new_claim"
  | "same_source_repeat"
  | "independent_corroboration"
  | "stronger_evidence"
  | "weaker_evidence"
  | "equal_strength_change";

export interface GatewayVerdict {
  decision: MemoryDecision;
  reason: string;
  reasonCode: MemoryVerdictReason;
  candidateEvidence: MemoryEvidenceClass;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Pure decision function — exported for tests. The rules the legacy
 * path gets wrong, stated as code:
 *   - SAME-SOURCE repetition of the SAME claim is not corroboration →
 *     noop (legacy: reinforce + confidence bump + promotion progress).
 *   - A CHANGED claim is an update, not stronger evidence for the old
 *     claim → update, confidence should NOT rise (legacy: both at once).
 *   - A weaker-evidence source changing a stronger-evidence claim needs
 *     review → review_required (legacy: silent overwrite).
 *   - Unknown categories need review before they mint new taxonomy →
 *     review_required (legacy: warn-and-write-anyway).
 */
export function evaluateMemoryCandidate(
  candidate: MemoryCandidate,
  existing: ExistingMemoryFacts | null,
): GatewayVerdict {
  const candidateEvidence = evidenceClassForSource(candidate.source);

  if (!candidate.categoryKnown) {
    return {
      decision: "review_required",
      reason: "unknown category — writing would mint new taxonomy without review",
      reasonCode: "unknown_category",
      candidateEvidence,
    };
  }

  if (!existing) {
    return {
      decision: "add",
      reason: "no existing claim for this category/key",
      reasonCode: "new_claim",
      candidateEvidence,
    };
  }

  const sameContent = norm(existing.content) === norm(candidate.content);
  const sameSource = existing.source === candidate.source;
  const existingEvidence = evidenceClassForSource(existing.source);

  if (sameContent && sameSource) {
    return {
      decision: "noop",
      reason: "same source repeating the same claim — repetition is not corroboration",
      reasonCode: "same_source_repeat",
      candidateEvidence,
    };
  }
  if (sameContent && !sameSource) {
    return {
      decision: "reinforce",
      reason: `independent source (${candidate.source}) repeats the claim previously from ${existing.source}`,
      reasonCode: "independent_corroboration",
      candidateEvidence,
    };
  }

  // Content differs — this is a CHANGE, never a reinforcement.
  const candidateStrength = CLASS_STRENGTH[candidateEvidence];
  const existingStrength = CLASS_STRENGTH[existingEvidence];
  if (candidateStrength > existingStrength) {
    return {
      decision: "supersede",
      reason: `stronger evidence (${candidateEvidence}) replaces ${existingEvidence} claim`,
      reasonCode: "stronger_evidence",
      candidateEvidence,
    };
  }
  if (candidateStrength < existingStrength) {
    return {
      decision: "review_required",
      reason: `weaker evidence (${candidateEvidence}) contradicts a ${existingEvidence} claim — do not silently overwrite`,
      reasonCode: "weaker_evidence",
      candidateEvidence,
    };
  }
  return {
    decision: "update",
    reason: "equal-strength source changed the claim — update content WITHOUT a confidence boost",
    reasonCode: "equal_strength_change",
    candidateEvidence,
  };
}

/**
 * Wave-4 (2026-07-29) · token-Jaccard similarity on normalized content —
 * the deterministic stand-in for semantic dedup (the audit's "39 writers,
 * no semantic pre-dedup") that honors this module's design rule: no LLM,
 * no embedding call, in the write path. Exported for tests.
 */
export function nearDuplicateScore(a: string, b: string): number {
  const tok = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2));
  const ta = tok(a);
  const tb = tok(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / (ta.size + tb.size - hit);
}

const DUP_SUSPECT_THRESHOLD = 0.8;
const DUP_SCAN_LIMIT = 50;

/**
 * For an `add` verdict, scan the category's recent rows (different key)
 * for a near-duplicate claim. Same-claim-different-key duplicates sail
 * past the exact @@unique([category,key]) guard today — this measures
 * how often, in shadow, before any enforcement.
 */
async function findDuplicateSuspect(
  candidate: MemoryCandidate,
): Promise<{ key: string; score: number } | null> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: candidate.category, key: { not: candidate.key }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: DUP_SCAN_LIMIT,
    select: { key: true, content: true },
  });
  let best: { key: string; score: number } | null = null;
  for (const r of rows) {
    const score = nearDuplicateScore(candidate.content.slice(0, 500), r.content.slice(0, 500));
    if (score >= DUP_SUSPECT_THRESHOLD && (!best || score > best.score)) {
      best = { key: r.key, score: Math.round(score * 100) / 100 };
    }
  }
  return best;
}

const SHADOW_CATEGORY = "memory_gateway_shadow";
const SHADOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Record what the gateway WOULD do — fire-and-forget, self-expiring,
 * never touches the legacy write. Skips its own category (no recursive
 * shadowing) and never throws into the caller.
 */
export async function shadowMemoryCommit(
  candidate: MemoryCandidate,
  existing: ExistingMemoryFacts | null,
  legacyAction: "create" | "reinforce",
): Promise<void> {
  if (candidate.category === SHADOW_CATEGORY) return;
  try {
    const verdict = evaluateMemoryCandidate(candidate, existing);
    // Wave-4: on would-be adds, measure the semantic-dupe rate the exact
    // unique guard can't see. Shadow-only — no write is ever blocked.
    const dupSuspect =
      verdict.decision === "add"
        ? await findDuplicateSuspect(candidate).catch(() => null)
        : null;
    const agrees =
      (legacyAction === "create" && verdict.decision === "add") ||
      (legacyAction === "reinforce" && verdict.decision === "reinforce");
    const fingerprint = createHash("sha256")
      .update(`${candidate.category}:${candidate.key}:${norm(candidate.content)}:${candidate.source}`)
      .digest("hex")
      .slice(0, 16);
    await prisma.brainMemory.create({
      data: {
        category: SHADOW_CATEGORY,
        key: `shadow:${fingerprint}:${Date.now()}`,
        content: JSON.stringify({
          decision: verdict.decision,
          reason: verdict.reason,
          evidence: verdict.candidateEvidence,
          legacyAction,
          agrees,
          category: candidate.category,
          memoryKey: candidate.key,
          source: candidate.source,
          ...(dupSuspect ? { dupSuspectKey: dupSuspect.key, dupScore: dupSuspect.score } : {}),
        }).slice(0, 1500),
        confidence: 0.1,
        source: "memory-commit-gateway",
        expiresAt: new Date(Date.now() + SHADOW_TTL_MS),
        metadata: {
          shadow: true,
          agrees,
          decision: verdict.decision,
          dupSuspect: dupSuspect !== null,
        } as never,
      },
    });
  } catch (err) {
    logError("brain.memory-gateway", err, { stage: "shadow-receipt" }, "warn");
  }
}
