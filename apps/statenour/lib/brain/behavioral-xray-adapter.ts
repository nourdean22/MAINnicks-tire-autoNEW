/**
 * 2026-05-27 · Power Atlas Phase 2 · Behavioral X-ray adapter.
 *
 * Adapts the `bdistill-behavioral-xray` framework: extract decision
 * style · refusal patterns · conflict triggers · tone defaults ·
 * communication cadence from operator's chat corpus mentioning the
 * person. Output structured JSON · written to
 * PersonProfile.behavioralFingerprint by the weekly refresh cron.
 *
 * Skips when fewer than 5 chat mentions exist (signal too thin).
 * Failure path returns null · cron skips silently.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface BehavioralFingerprint {
  decisionStyle: string;
  refusalPatterns: string[];
  conflictTriggers: string[];
  toneDefaults: string;
  communicationCadence: string;
  refreshedAt: string;
}

/**
 * Run a behavioral X-ray on a person's chat history. Caller is
 * responsible for filtering eligibility (fingerprint staleness +
 * ≥5 new ledger events since last refresh). This module just
 * computes.
 */
export async function runBehavioralXray(
  personId: string,
): Promise<BehavioralFingerprint | null> {
  // Wave AM · 2026-05-28 · soft-delete safety
  const person = await prisma.personProfile.findFirst({
    where: { id: personId, deletedAt: null },
  });
  if (!person) return null;

  const chatMentions = await prisma.chatMessage.findMany({
    where: {
      content: { contains: person.name, mode: "insensitive" },
      role: "user",
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { content: true, createdAt: true },
  });
  if (chatMentions.length < 5) return null;

  const corpus = chatMentions
    .map((m) => m.content)
    .join("\n---\n")
    .slice(0, 8000);

  const prompt = `Behavioral X-ray on a single person based on operator's chat about them. Output STRICT JSON only · no fences.

Person: ${person.name}
Role: ${person.role}

Operator's chat mentions (last 40):
${corpus}

Infer:
{
  "decisionStyle": "1-sentence · how do they make decisions (impulsive/deliberate/avoidant/etc)",
  "refusalPatterns": ["list of common ways they say no or push back, ≤3 items"],
  "conflictTriggers": ["specific topics that produce friction, ≤4 items"],
  "toneDefaults": "1-sentence · default emotional tone (warm/cool/transactional/etc)",
  "communicationCadence": "1-sentence · how often + when they reach out"
}`;

  try {
    const result = await tracedAiChat(
      {
        label: "behavioral-xray",
        source: "cron",
        metadata: { personId },
      },
      [
        {
          role: "system",
          content:
            "Behavioral analyst. Output STRICT JSON only.",
        },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    const raw = (result.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as Omit<
      BehavioralFingerprint,
      "refreshedAt"
    >;
    return { ...parsed, refreshedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
