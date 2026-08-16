/**
 * Grounding Engine — measures how similar a new claim is to what we ALREADY
 * BELIEVE. It does not verify anything against a source.
 *
 * 2026-08-16 · this file used to be called the "Grounding & Verification
 * Engine" and its top status was `source_supported`. Both overclaimed, in the
 * one place it mattered most: `status` is interpolated verbatim into an LLM
 * prompt (lib/intelligence/scoring.ts) as "Grounding Status", where a model
 * reads "source_supported" as "a source confirmed this". What actually
 * happened is a cosine-similarity lookup against BrainMemory — which contains
 * the system's OWN prior inferences, so a machine-generated belief can
 * "support" a new claim. That is self-corroboration, not verification.
 *
 * The persisted values are UNCHANGED on purpose. `status` is a real String
 * column on intelligence_claims with a literal default, it is indexed, and
 * two queries filter it by exact literal (promote.ts, compose-daily-brief.ts).
 * Renaming the stored vocabulary needs a hand-applied backfill plus an
 * ALTER COLUMN SET DEFAULT against prod — a protected operation, and one that
 * fails SILENTLY if code ships ahead of data (both queries would just return
 * zero rows). The honest fix costs no DB risk: keep the stored enum, and
 * describe it truthfully at every boundary where a human or a model reads it.
 * See describeGroundingStatus below.
 */
import { semanticSearch } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/grounding");

/**
 * Persisted vocabulary — do NOT rename without a prod backfill (see header).
 * Declared once and reused so a future rename has a single edit site; the two
 * inline copies this replaced had already drifted from the docs.
 */
export type GroundingStatus = "source_supported" | "weak_support" | "unverified";

/** Cosine thresholds. The docs claimed 0.80/0.55; the code has always been 0.75. */
export const GROUNDING_STRONG_THRESHOLD = 0.75;
export const GROUNDING_WEAK_THRESHOLD = 0.55;

/**
 * What each stored value actually means, in words that do not overclaim.
 * This is the string that reaches an LLM prompt and any operator-facing
 * surface — never the raw enum.
 */
export function describeGroundingStatus(status: GroundingStatus): string {
  switch (status) {
    case "source_supported":
      return `closely matches an existing belief in memory (cosine >= ${GROUNDING_STRONG_THRESHOLD}) — similarity only, NOT independent verification`;
    case "weak_support":
      return `loosely matches an existing belief in memory (cosine >= ${GROUNDING_WEAK_THRESHOLD}) — similarity only, NOT verification`;
    case "unverified":
      return "no similar prior belief found, or the similarity check could not run — treat as unsupported";
  }
}

export interface GroundedClaim {
  text: string;
  category: "research_claim" | "research_contradiction" | "research_action" | "research_question";
  confidence: number;
  /** Cosine similarity to the nearest existing memory. NOT a verification score. */
  verificationScore: number;
  status: GroundingStatus;
  bestMatchChunk: string | null;
  /**
   * True when the similarity check itself FAILED (not when it found nothing).
   * `unverified` is overloaded three ways — low similarity, zero matches, and
   * a thrown error — and only the first two are real measurements. This flag
   * keeps the error case distinguishable in-process without changing the
   * persisted enum. It is deliberately not written to the DB: storing
   * "unverified" on a failed check already fails CLOSED (PROMOTABLE_STATUS is
   * source_supported, so nothing gets promoted off a failure).
   */
  groundingFailed?: boolean;
}

export async function groundClaim(
  text: string,
  category: "research_claim" | "research_contradiction" | "research_action" | "research_question",
  confidence: number
): Promise<GroundedClaim> {
  try {
    // Search the brain memories for matching context
    const matches = await semanticSearch(text, 3, ["brain_memory"]);

    if (matches.length === 0) {
      return {
        text,
        category,
        confidence,
        verificationScore: 0.0,
        status: "unverified",
        bestMatchChunk: null,
      };
    }

    // Find the best match
    const bestMatch = matches[0];
    const similarity = bestMatch.similarity; // ranges from 0 to 1

    let status: GroundingStatus = "unverified";
    if (similarity >= GROUNDING_STRONG_THRESHOLD) {
      status = "source_supported";
    } else if (similarity >= GROUNDING_WEAK_THRESHOLD) {
      status = "weak_support";
    }

    log.info(`Grounded claim "${text.slice(0, 40)}..." -> similarity: ${similarity.toFixed(3)}, status: ${status}`);

    return {
      text,
      category,
      confidence,
      verificationScore: Math.round(similarity * 100) / 100, // round to 2 decimals
      status,
      bestMatchChunk: bestMatch.content,
    };
  } catch (err) {
    // Loud, not silent: a grounding failure and a genuine no-match both store
    // "unverified", so without this log the two are indistinguishable in prod.
    log.error(`Error grounding claim — storing as unverified (fails closed)`, {
      error: err instanceof Error ? err.message : String(err),
      textPreview: text.slice(0, 80),
    });
    return {
      text,
      category,
      confidence,
      verificationScore: 0.0,
      status: "unverified",
      bestMatchChunk: null,
      groundingFailed: true,
    };
  }
}
