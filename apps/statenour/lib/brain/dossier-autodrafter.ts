/**
 * 2026-05-27 · Power Atlas Phase 2 · Dossier auto-drafter.
 *
 * Scans chat mentions + recent ledger + alpha moments + behavioral
 * fingerprint and drafts a 5-7 bullet markdown dossier for the
 * operator to approve/edit on Monday morning. Plain markdown · no
 * emoji · concise (phone-readable).
 *
 * Called from the weekly cron (Monday 04:00 UTC = 11pm ET Sunday)
 * with a 5-profiles-per-run cap. Embedding refresh fires after each
 * successful draft so /api/people/search hybrid search picks up the
 * new dossier content on its next cosine query.
 *
 * Failure path · returns null · cron skips that profile silently.
 * Operator's existing dossier blob is NEVER overwritten by a failed
 * draft (caller-side check).
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";

export async function draftDossierFor(
  personId: string,
): Promise<string | null> {
  // Wave AM · 2026-05-28 · soft-delete safety
  const person = await prisma.personProfile.findFirst({
    where: { id: personId, deletedAt: null },
  });
  if (!person) return null;

  const [chatMentions, recentLedger, alphaMoments] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        content: { contains: person.name, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { content: true, createdAt: true },
    }),
    prisma.relationshipLedger
      .findMany({
        where: { personId },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { amount: true, note: true, createdAt: true, metadata: true },
      })
      // CONTACT rows only (W8) — the dossier describes the relationship.
      .then((rows) => contactRowsOnly(rows).slice(0, 20)),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.ALPHA_MOMENT,
        key: { startsWith: `${personId}:` },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true },
    }),
  ]);

  const alphaBullets = alphaMoments
    .map((a) => {
      try {
        const parsed = JSON.parse(a.content) as { moment: string };
        return `- ${parsed.moment.slice(0, 200)}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `Draft a 5-bullet markdown dossier for ${person.name}. Plain markdown. NO emojis. The operator reads on phone. Concise.

Role: ${person.role}
Existing dossier (preserve operator's edits where useful):
${person.dossierMd ?? "(none)"}

Chat mentions (recent 30):
${chatMentions
  .map((m) => `- ${m.content.slice(0, 200)}`)
  .join("\n")
  .slice(0, 4000)}

Recent ledger:
${recentLedger
  .map(
    (l) =>
      `- ${l.amount >= 0 ? "+" : ""}${l.amount} · ${l.note.slice(0, 80)}`,
  )
  .join("\n")}

Alpha moments pinned:
${alphaBullets}

Behavioral fingerprint:
${person.behavioralFingerprint ? JSON.stringify(person.behavioralFingerprint).slice(0, 800) : "(none)"}

Output 5-7 markdown bullets covering:
- Who they are (1 bullet)
- How operator met them + key shared history (1 bullet)
- Their current state of life (1 bullet)
- Communication norms with this person (1 bullet)
- Strategic notes · Greene-flavored (1-2 bullets)
- The single most important thing for the operator to remember (1 bullet)

Plain markdown · no headers · just bullets.`;

  try {
    const result = await tracedAiChat(
      {
        label: "dossier-autodraft",
        source: "cron",
        metadata: { personId },
      },
      [
        {
          role: "system",
          content:
            "Editorial assistant. Plain markdown bullets. No emoji. No fluff.",
        },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    const draft = (result.content ?? "").trim();
    return draft.length > 0 ? draft : null;
  } catch {
    return null;
  }
}
