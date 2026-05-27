/**
 * 2026-05-27 · Power Atlas Phase 3 · Social proof aggregator.
 *
 * Cross-references chat messages mentioning a target person against
 * mentions of OTHER people in the operator's network · derives a list
 * of which people the operator most often talks about alongside the
 * target. Surfaces in the detail panel as "Social proof · these are
 * the people who appear in the same conversation arc as X".
 *
 * Useful for · spotting cluster patterns ("every time I talk about
 * Mike I also talk about Sarah · they're a unit in my head"), bridge
 * candidates, and identifying who can vouch / introduce.
 *
 * Pure read · no DB writes. Capped 500 messages + 20 returned rows
 * to keep the per-query latency bounded.
 */

import "server-only";
import { prisma } from "@/lib/prisma";

export interface SocialProofSnapshot {
  totalCrossMentions: number;
  mentionsByPerson: {
    personId: string;
    personName: string;
    mentionCount: number;
  }[];
}

export async function aggregateSocialProof(
  personId: string,
): Promise<SocialProofSnapshot> {
  const target = await prisma.personProfile.findUnique({
    where: { id: personId },
    select: { id: true, name: true },
  });
  if (!target) return { totalCrossMentions: 0, mentionsByPerson: [] };

  const allPeople = await prisma.personProfile.findMany({
    where: { id: { not: personId }, deletedAt: null },
    select: { id: true, name: true },
  });
  if (allPeople.length === 0) {
    return { totalCrossMentions: 0, mentionsByPerson: [] };
  }

  // Find messages that mention the target · then count how many also
  // mention each OTHER person in the operator's network.
  const messages = await prisma.chatMessage.findMany({
    where: {
      content: { contains: target.name, mode: "insensitive" },
    },
    select: { content: true },
    take: 500,
  });

  const targetLower = target.name.toLowerCase();
  const others = allPeople.map((p) => ({
    id: p.id,
    name: p.name,
    needle: p.name.toLowerCase(),
  }));

  const mentionCounts: Map<string, number> = new Map();
  for (const msg of messages) {
    const lower = msg.content.toLowerCase();
    // Defensive · the .toLowerCase() filter on Postgres should have
    // ensured all messages match, but recheck client-side in case of
    // accent / unicode quirks.
    if (!lower.includes(targetLower)) continue;
    for (const o of others) {
      if (lower.includes(o.needle)) {
        mentionCounts.set(o.id, (mentionCounts.get(o.id) ?? 0) + 1);
      }
    }
  }

  const mentionsByPerson = Array.from(mentionCounts.entries())
    .map(([pid, count]) => {
      const person = others.find((p) => p.id === pid);
      return {
        personId: pid,
        personName: person?.name ?? "(unknown)",
        mentionCount: count,
      };
    })
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 20);

  return {
    totalCrossMentions: mentionsByPerson.reduce(
      (s, m) => s + m.mentionCount,
      0,
    ),
    mentionsByPerson,
  };
}
