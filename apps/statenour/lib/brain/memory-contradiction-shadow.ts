/**
 * Q-31 · admission-time contradiction shadow.
 *
 * This is deliberately not another contradiction system. It reuses the
 * existing contradiction row contract and signal vocabulary, but constrains
 * candidate retrieval to the SAME category and newest 25 rows. That query rides
 * BrainMemory's (category, updatedAt) index instead of asking global vector
 * search for hundreds of mixed-category neighbors and filtering afterwards.
 *
 * Shadow rows remain measurable in category=contradiction, but the normal
 * ticker hides row.shadow=true until the detector earns its precision target.
 */
import { prisma } from "@/lib/prisma";
import {
  detectContradictionSignal,
  surfaceContradictionPair,
} from "@/lib/brain/contradiction-surfacer";
import { nearDuplicateScore } from "@/lib/brain/memory-commit-gateway";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const MAX_CANDIDATES = 25;
const MAX_FLAGS_PER_WRITE = 3;
const MIN_TOPIC_OVERLAP = 0.35;

const SKIP_CATEGORIES = new Set<string>([
  BRAIN_CATEGORIES.CONTRADICTION,
  BRAIN_CATEGORIES.SUPERSEDED_SNAPSHOT,
  "memory_gateway_shadow",
]);

export interface AdmissionContradictionShadowResult {
  scanned: number;
  flagged: number;
}

export async function shadowAdmissionContradictions(input: {
  memoryId: string;
  category: string;
  content: string;
}): Promise<AdmissionContradictionShadowResult> {
  const content = input.content.trim();
  if (
    content.length < 12 ||
    SKIP_CATEGORIES.has(input.category)
  ) {
    return { scanned: 0, flagged: 0 };
  }

  const candidates = await prisma.brainMemory.findMany({
    where: {
      category: input.category,
      id: { not: input.memoryId },
      deletedAt: null,
      supersededById: null,
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_CANDIDATES,
    select: {
      id: true,
      content: true,
      createdAt: true,
    },
  });

  let flagged = 0;
  for (const old of candidates) {
    const signal = detectContradictionSignal(content, old.content);
    if (!signal) continue;

    // Topic guard. Reversal words alone are not enough; the two claims must
    // also share material vocabulary. Conservative by design because shadow
    // precision, not raw recall, is the graduation metric.
    const overlap = nearDuplicateScore(content.slice(0, 600), old.content.slice(0, 600));
    if (overlap < MIN_TOPIC_OVERLAP) continue;

    await surfaceContradictionPair({
      newMemoryId: input.memoryId,
      oldMemoryId: old.id,
      newContent: content,
      oldContent: old.content,
      similarity: Math.round(overlap * 1000) / 1000,
      signal,
      oldCreatedAt: old.createdAt,
      shadow: true,
      detector: "admission_index_constrained_v1",
    });
    flagged++;
    if (flagged >= MAX_FLAGS_PER_WRITE) break;
  }

  return { scanned: candidates.length, flagged };
}
