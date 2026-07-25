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
import { PERSON_ROLE_PROMPT_LIST, isPersonRole } from "./person-roles";
import { logError } from "@/lib/utils/error-log";

/**
 * Operator opened/edited the dossier within `days` — a "reviewed" signal
 * distinct from real CONTACT (lastInteraction, bumped only by chat
 * mention / logged outreach / ledger). A dossier edit deliberately does
 * NOT bump lastInteraction, so we use this to avoid crying "neglected"
 * right after the operator engaged with someone's record.
 */
function reviewedWithin(
  dossierUpdatedAt: Date | null | undefined,
  days = 14,
): boolean {
  return !!dossierUpdatedAt && new Date(dossierUpdatedAt) > daysAgo(days);
}

/**
 * Run a people intelligence scan — analyzes recent interactions,
 * finds neglected relationships, and surfaces people relevant to goals.
 */
export async function runPeopleIntelligence(): Promise<{
  profilesUpdated: number;
  alerts: string[];
}> {
  const alerts: string[] = [];

  // Get all known people · Wave AM · 2026-05-28 · CRITICAL soft-delete
  // gap · this is the engine that feeds every chat turn the operator's
  // people context. Pre-fix it returned soft-deleted profiles · operator
  // would delete person X · Nick would keep referencing X in chat replies.
  const people = await prisma.personProfile.findMany({
    where: { deletedAt: null },
    orderBy: { interactionCount: "desc" },
    select: {
      id: true,
      name: true,
      role: true,
      relationship: true,
      trustScore: true,
      lastInteraction: true,
      dossierUpdatedAt: true,
      interactionCount: true,
      leverageNotes: true,
      metadata: true,
      pendingClassification: true,
    },
  });

  if (people.length === 0) return { profilesUpdated: 0, alerts: [] };

  // Detect neglected relationships — no real CONTACT in 14d. Someone whose
  // dossier the operator just reviewed is still tracked, not neglected.
  const twoWeeksAgo = daysAgo(14);
  const neglected = people.filter(
    (p) =>
      p.interactionCount >= 3 && // Only alert for people we interact with regularly
      p.lastInteraction &&
      new Date(p.lastInteraction) < twoWeeksAgo &&
      !reviewedWithin(p.dossierUpdatedAt)
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

  // Propose enrichment for profiles that are too sparse — but skip any
  // that ALREADY have a suggestion waiting for the operator (don't burn
  // AI calls re-proposing the same thing, and don't clobber a pending one).
  const sparse = people.filter(
    (p) => (p.role === "unknown" || !p.leverageNotes) && !p.pendingClassification
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
      .catch((err) => {
        logError("brain.people-intelligence", err, { fn: "runPeopleIntelligence.findDigests" });
        return [];
      });

    const mentionContext: Record<string, string[]> = {};
    for (const d of digests) {
      const p = d.payload as any;
      if (!p?.peopleMentioned) continue;
      for (const mention of p.peopleMentioned) {
        if (!mentionContext[mention.name]) mentionContext[mention.name] = [];
        mentionContext[mention.name].push(mention.context);
      }
    }

    let enrichFailCount = 0;
    for (const person of sparse.slice(0, 5)) {
      const contexts = mentionContext[person.name] || [];
      if (contexts.length === 0 && person.role === "unknown") continue;

      const enrichResult = await aiChat(
        [
          {
            role: "system",
            content: `Based on these conversation mentions, determine this person's role and strategic relevance to Nour (CEO of an auto repair shop).

Pick the role from EXACTLY this list (use the closest fit; do not invent one):
${PERSON_ROLE_PROMPT_LIST}

Return ONLY JSON:
{
  "role": "<one value from the list above>",
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

       
      const enrichExtracted = extractJsonObject<any>(enrichResult.content);
      if (enrichExtracted.ok) {
        try {
          const enriched = enrichExtracted.value;
          // SUGGEST, don't clobber. Validate the role against the canonical
          // list; only propose a role change if it's valid AND differs from
          // what's there. Write the whole proposal to pendingClassification
          // for the operator to accept/dismiss on /people — role,
          // leverageNotes, and trustScore are NEVER silently overwritten.
          const suggestedRole =
            isPersonRole(enriched.role) && enriched.role !== person.role
              ? enriched.role
              : null;
          const suggestedNotes =
            typeof enriched.leverageNotes === "string" &&
            enriched.leverageNotes.trim() &&
            enriched.leverageNotes.trim() !== (person.leverageNotes ?? "").trim()
              ? enriched.leverageNotes.trim().slice(0, 2000)
              : null;
          const rawAdj = Number(enriched.trustAdjustment);
          const trustAdjustment = Number.isFinite(rawAdj)
            ? Math.max(-0.1, Math.min(0.1, rawAdj))
            : 0;

          // Nothing worth surfacing? Skip — don't park an empty suggestion.
          if (suggestedRole || suggestedNotes || trustAdjustment !== 0) {
            await prisma.personProfile.update({
              where: { id: person.id },
              data: {
                pendingClassification: {
                  role: suggestedRole,
                  leverageNotes: suggestedNotes,
                  trustAdjustment,
                  basis: contexts.slice(0, 3).join("; ").slice(0, 400) || "no recent mentions",
                  suggestedAt: today(),
                } as object,
              },
            });
            updated++;
          }
        } catch {
          enrichFailCount++;
        }
      }
    }
    
    if (enrichFailCount > 0) {
      logError("brain.people-intelligence", new Error(`${enrichFailCount} people enrichment failures`), { fn: "runPeopleIntelligence.enrich" });
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
      // Soft-deleted profiles must not leak into Nick's system prompt —
      // otherwise he keeps referencing people the operator deleted. The
      // scan (runPeopleIntelligence) already filters; this builder didn't.
      where: { deletedAt: null },
      orderBy: [{ interactionCount: "desc" }, { trustScore: "desc" }],
      take: 15,
      select: {
        name: true,
        role: true,
        relationship: true,
        trustScore: true,
        lastInteraction: true,
        dossierUpdatedAt: true,
        interactionCount: true,
        leverageNotes: true,
      },
    })
    .catch((err) => {
      logError("brain.people-intelligence", err, { fn: "getPeopleIntelligence.findProfiles" });
      return [];
    });

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
        const marker =
          daysSince && daysSince > 14
            ? reviewedWithin(p.dossierUpdatedAt)
              ? " 📝reviewed"
              : " ⚠️STALE"
            : "";
        return `${p.name} (trust: ${(p.trustScore * 100).toFixed(0)}%, ${p.interactionCount} interactions${marker})`;
      }).join(", ")}`
    );
  }

  // Surface neglected relationships — no real CONTACT in 14+ days. Someone
  // whose dossier the operator just reviewed is NOT neglected (clearly
  // still tracked) — split those into a truthful "reach out" nudge instead
  // of crying neglect right after they engaged with the record.
  const staleContact = people.filter(
    (p) =>
      p.interactionCount >= 3 &&
      p.lastInteraction &&
      new Date(p.lastInteraction) < daysAgo(14)
  );
  const neglected = staleContact.filter((p) => !reviewedWithin(p.dossierUpdatedAt));
  const reviewedNotContacted = staleContact.filter((p) =>
    reviewedWithin(p.dossierUpdatedAt)
  );

  if (neglected.length > 0) {
    lines.push(
      `**NEGLECTED**: ${neglected.map((n) => n.name).join(", ")} — no contact in 14+ days`
    );
  }
  if (reviewedNotContacted.length > 0) {
    lines.push(
      `**REACH OUT**: ${reviewedNotContacted.map((n) => n.name).join(", ")} — notes fresh, no actual contact yet`
    );
  }

  return lines.join("\n");
}
