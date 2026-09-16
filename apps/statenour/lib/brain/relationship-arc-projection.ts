/**
 * 2026-05-27 · Power Atlas Phase 2 · 5-year arc projection.
 *
 * Sam-flavored strategist · projects 3 trajectories for a relationship
 * based on (a) recent vs older ledger trend (b) Greene archetype +
 * dark traits + applicable laws (c) dossier snippet. Output is a
 * structured JSON blob the operator reads on /relationships.
 *
 * Cached on `PersonProfile.lastArcPlan` so re-opening the panel
 * doesn't re-bill the AI · operator hits the "re-project" button to
 * force a fresh run.
 *
 * Failure path · returns null (caller bubbles up an empty state ·
 * never blocks the operator).
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";

export interface ArcProjection {
  do_nothing: string; // 5-year arc if operator changes nothing
  double_effort: string; // 5-year arc if operator doubles effort
  blow_up: string; // 5-year arc if operator severs
  recommendation: string; // strategist's one-line read · Greene voice
  projectedAt: string;
}

export async function projectFiveYearArc(
  personId: string,
): Promise<ArcProjection | null> {
  const person = await prisma.personProfile.findUnique({
    where: { id: personId },
  });
  if (!person) return null;

  // CONTACT rows only (W8): recentTrend/olderTrend below are amount sums.
  const ledger = contactRowsOnly(
    await prisma.relationshipLedger.findMany({
      where: { personId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ).slice(0, 30);

  const recentTrend = ledger.slice(0, 10).reduce((s, r) => s + r.amount, 0);
  const olderTrend = ledger.slice(10, 20).reduce((s, r) => s + r.amount, 0);

  const prompt = `Strategist · 5-year arc projection. Read the data, output JSON only.

Person: ${person.name}
Role: ${person.role}
Status: ${person.status}
Trust: ${Math.round(person.trustScore * 100)}/100
Power balance: ${person.powerBalance.toFixed(2)} (negative = they have leverage over operator)
Recent ledger trend (last 10): ${recentTrend}
Older ledger trend (entries 10-20): ${olderTrend}
Greene archetype: ${person.greeneType ?? "unknown"}
Dark traits: [${person.darkTraits.join(",")}]
Applicable laws: [${person.applicableLaws.join(",")}]
Dossier:
${(person.dossierMd ?? "").slice(0, 800)}

Output JSON only · NO markdown fences:
{
  "do_nothing": "1-sentence projection if operator changes nothing",
  "double_effort": "1-sentence projection if operator 2x effort",
  "blow_up": "1-sentence projection if operator severs (only applicable if status != 'blown_up')",
  "recommendation": "strategist's 1-line read in Greene's voice"
}`;

  try {
    const result = await tracedAiChat(
      { label: "arc-projection", source: "tool", metadata: { personId } },
      [
        {
          role: "system",
          content:
            "You are a relationship strategist trained in Greene's corpus. Output STRICT JSON only.",
        },
        { role: "user", content: prompt },
      ],
      "reason",
    );
    const raw = (result.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as Omit<ArcProjection, "projectedAt">;
    return { ...parsed, projectedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
