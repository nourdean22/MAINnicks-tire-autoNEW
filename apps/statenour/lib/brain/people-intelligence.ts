/**
 * People Intelligence Engine — Layer 11 (Auto-Generated)
 *
 * Extracts, builds, and maintains profiles of people in Nour's life
 * from conversations, business data, and explicit input.
 *
 * Produces:
 * - Auto-profiles from conversation mentions
 * - Trust score evolution over time
 * - "You haven't talked to X in 2 weeks" alerts
 * - Relationship leverage analysis
 * - People most relevant to current goals
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("people-intelligence");
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { daysAgo, today } from "@/lib/utils/datetime";

/**
 * Run a people intelligence scan — analyzes recent interactions,
 * finds neglected relationships, and surfaces people relevant to goals.
 */
export async function runPeopleIntelligence(): Promise<{
  profilesUpdated: number;
  alerts: string[];
}> {
  const alerts: string[] = [];

  // Get all known people
  const people = await prisma.personProfile.findMany({
    orderBy: { interactionCount: "desc" },
    select: {
      id: true,
      name: true,
      role: true,
      relationship: true,
      trustScore: true,
      lastInteraction: true,
      interactionCount: true,
      leverageNotes: true,
      metadata: true,
    },
  });

  if (people.length === 0) return { profilesUpdated: 0, alerts: [] };

  // Detect neglected relationships
  const twoWeeksAgo = daysAgo(14);
  const neglected = people.filter(
    (p) =>
      p.interactionCount >= 3 && // Only alert for people we interact with regularly
      p.lastInteraction &&
      new Date(p.lastInteraction) < twoWeeksAgo
  );

  for (const n of neglected) {
    const daysSince = Math.round(
      (Date.now() - new Date(n.lastInteraction!).getTime()) /
        (24 * 60 * 60 * 1000)
    );
    alerts.push(
      `Haven't interacted with ${n.name} (${n.role}) in ${daysSince} days — ${n.relationship.slice(0, 60)}`
    );
  }

  // Enrich profiles that are too sparse
  const sparse = people.filter(
    (p) => p.role === "unknown" || !p.leverageNotes
  );

  let updated = 0;
  if (sparse.length > 0 && sparse.length <= 10) {
    // Get recent conversation digests mentioning these people
    const digests = await prisma.auditEvent
      .findMany({
        where: { eventType: "conversation_digest" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { payload: true },
      })
      .catch(() => []);

    const mentionContext: Record<string, string[]> = {};
    for (const d of digests) {
      const p = d.payload as any;
      if (!p?.peopleMentioned) continue;
      for (const mention of p.peopleMentioned) {
        if (!mentionContext[mention.name]) mentionContext[mention.name] = [];
        mentionContext[mention.name].push(mention.context);
      }
    }

    for (const person of sparse.slice(0, 5)) {
      const contexts = mentionContext[person.name] || [];
      if (contexts.length === 0 && person.role === "unknown") continue;

      const enrichResult = await aiChat(
        [
          {
            role: "system",
            content: `Based on these conversation mentions, determine this person's role and strategic relevance to Nour (CEO of an auto repair shop).

Return ONLY JSON:
{
  "role": "employee|customer|vendor|family|advisor|competitor|partner|friend",
  "leverageNotes": "How this person can help Nour or how Nour should manage this relationship",
  "trustAdjustment": 0 (no change) or -0.1 to +0.1
}`,
          },
          {
            role: "user",
            content: `Person: ${person.name}\nCurrent role: ${person.role}\nRelationship: ${person.relationship}\nMention contexts: ${contexts.join("; ") || "no recent mentions"}\nInteraction count: ${person.interactionCount}`,
          },
        ],
        "fast"
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const enrichExtracted = extractJsonObject<any>(enrichResult.content);
      if (enrichExtracted.ok) {
        try {
          const enriched = enrichExtracted.value;
          await prisma.personProfile.update({
            where: { id: person.id },
            data: {
              role:
                enriched.role && enriched.role !== "unknown"
                  ? enriched.role
                  : person.role,
              leverageNotes: enriched.leverageNotes || person.leverageNotes,
              trustScore: Math.max(
                0,
                Math.min(
                  1,
                  person.trustScore + (enriched.trustAdjustment || 0)
                )
              ),
            },
          });
          updated++;
        } catch {}
      }
    }
  }

  return { profilesUpdated: updated, alerts };
}

/**
 * Get people intelligence for the system prompt.
 */
export async function getPeopleIntelligence(): Promise<string> {
  const people = await prisma.personProfile
    .findMany({
      orderBy: [{ interactionCount: "desc" }, { trustScore: "desc" }],
      take: 15,
      select: {
        name: true,
        role: true,
        relationship: true,
        trustScore: true,
        lastInteraction: true,
        interactionCount: true,
        leverageNotes: true,
      },
    })
    .catch(() => []);

  if (people.length === 0) return "";

  const lines: string[] = [
    `\n## L11 — People Intelligence (${people.length} profiles)`,
  ];

  // Categorize by role
  type Person = (typeof people)[number];
  const byRole: Record<string, Person[]> = {};
  for (const p of people) {
    const role = p.role || "unknown";
    const bucket = byRole[role] ?? (byRole[role] = []);
    bucket.push(p);
  }

  for (const [role, members] of Object.entries(byRole)) {
    lines.push(
      `**${role}**: ${members.map((p) => {
        const daysSince = p.lastInteraction
          ? Math.round(
              (Date.now() - new Date(p.lastInteraction).getTime()) /
                (24 * 60 * 60 * 1000)
            )
          : null;
        const stale = daysSince && daysSince > 14 ? " ⚠️STALE" : "";
        return `${p.name} (trust: ${(p.trustScore * 100).toFixed(0)}%, ${p.interactionCount} interactions${stale})`;
      }).join(", ")}`
    );
  }

  // Surface neglected relationships
  const neglected = people.filter(
    (p) =>
      p.interactionCount >= 3 &&
      p.lastInteraction &&
      new Date(p.lastInteraction) < daysAgo(14)
  );

  if (neglected.length > 0) {
    lines.push(
      `**NEGLECTED**: ${neglected.map((n) => n.name).join(", ")} — haven't interacted in 14+ days`
    );
  }

  return lines.join("\n");
}
