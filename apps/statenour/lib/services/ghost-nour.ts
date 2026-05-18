/**
 * lib/services/ghost-nour.ts · Phase Y.3 (2026-05-18 PM)
 *
 * Ghost-Nour candidate-decisions helper. Returns recent
 * MasteryDecision rows that have no actualOutcome yet · the UI
 * surfaces these as "run ghost on this" cards for pending decisions.
 *
 * Extracted from `app/api/system/ghost-nour/route.ts` GET handler
 * (the `?list=recent` branch). Same shared-service pattern: the
 * legacy REST endpoint AND `trpc.system.ghostNourCandidates`
 * both call this function · drift impossible.
 *
 * NOTE · the POST handler (similarity search + recommendation) stays
 * inline in the route. Migrating it requires more thought because
 * the page uses it as a heavy mutation with substantial result
 * shape · separate phase scope when needed.
 */

import { prisma } from "@/lib/prisma";

export interface GhostNourCandidate {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  chosen: string | null;
  stakes: string | null;
  createdAt: Date;
}

export async function readGhostNourCandidates(
  options?: { take?: number },
): Promise<GhostNourCandidate[]> {
  const take = options?.take ?? 20;
  return prisma.masteryDecision.findMany({
    where: { actualOutcome: null, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      date: true,
      title: true,
      domain: true,
      chosen: true,
      stakes: true,
      createdAt: true,
    },
  });
}
