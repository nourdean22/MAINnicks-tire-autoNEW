/**
 * Grounding & Verification Engine
 * Validates new intelligence claims against existing brain memory using semantic search.
 */
import { semanticSearch } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/grounding");

export interface GroundedClaim {
  text: string;
  category: "research_claim" | "research_contradiction" | "research_action" | "research_question";
  confidence: number;
  verificationScore: number;
  status: "source_supported" | "weak_support" | "unverified";
  bestMatchChunk: string | null;
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

    let status: "source_supported" | "weak_support" | "unverified" = "unverified";
    if (similarity >= 0.75) {
      status = "source_supported";
    } else if (similarity >= 0.55) {
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
    log.error(`Error grounding claim:`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      text,
      category,
      confidence,
      verificationScore: 0.0,
      status: "unverified",
      bestMatchChunk: null,
    };
  }
}
