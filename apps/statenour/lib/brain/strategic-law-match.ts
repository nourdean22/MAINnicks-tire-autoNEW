/**
 * Match a described situation to a strategic law.
 *
 * WHY THIS IS SHARED (2026-09-18). This keyword match lived inline in the
 * `logSituation` tool (lib/ai/tools/tasks.ts). Deriving situation_logs from
 * journal dumps needs the same match, and two copies of a scoring predicate
 * ALWAYS diverge — that is the same defect as the two task scorers that each
 * carried their own "is this terminal" predicate and disagreed.
 *
 * ⚠ THE MATCH IS DELIBERATELY WEAK, AND THAT IS FINE. It is a keyword overlap
 * against law titles and essences, not a semantic search. `lawId` is a HINT the
 * operator can correct, not a claim the law applies — and `system-health`'s law
 * feedback loop counts how many situations carried a law at all, not how well
 * they matched. A null here is an honest "nothing obvious", never an error.
 */
import { prisma as defaultPrisma } from "@/lib/prisma";

type PrismaLike = typeof defaultPrisma;

/** Words shorter than this carry no signal and match half the corpus. */
const MIN_KEYWORD = 5;
/** More than this and the OR explodes without improving the hit. */
const MAX_KEYWORDS = 5;

export interface MatchedLaw {
  id: string;
  book: string;
  number: number;
  title: string;
  essence: string | null;
}

/** Keywords a law lookup should use for this text. Exported for tests. */
export function lawKeywords(situation: string): string[] {
  return (situation ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > MIN_KEYWORD - 1)
    .slice(0, MAX_KEYWORDS);
}

/**
 * Up to three laws whose title or essence overlaps the situation's keywords.
 * Empty array when nothing matches, or on any failure — a law lookup must never
 * be able to fail the write it decorates.
 */
export async function matchStrategicLaws(
  situation: string,
  prisma: PrismaLike = defaultPrisma,
): Promise<MatchedLaw[]> {
  const keywords = lawKeywords(situation);
  if (keywords.length === 0) return [];
  try {
    return await prisma.strategicLaw.findMany({
      where: {
        OR: keywords.map((k) => ({
          OR: [
            { title: { contains: k, mode: "insensitive" as const } },
            { essence: { contains: k, mode: "insensitive" as const } },
          ],
        })),
      },
      select: { id: true, book: true, number: true, title: true, essence: true },
      take: 3,
    });
  } catch {
    return [];
  }
}
