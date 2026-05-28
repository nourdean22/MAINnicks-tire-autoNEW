/**
 * 2026-05-27 · Power Atlas Phase 3 · Greene law auto-tagger.
 *
 * Semantic-matches a person's state (role · status · trust · power ·
 * dark traits · recent ledger trend) against each seeded Greene law's
 * `applicabilityPrompt`. Returns up to 3 most-applicable law numbers.
 *
 * Source corpus · BrainMemory(category="greene_law", key="law_<N>")
 * seeded by scripts/seed-greene-corpus. Each row's content is JSON
 * { number, title, summary, applicabilityPrompt, ... }.
 *
 * The cron writes the result to PersonProfile.applicableLaws (int[]
 * column). Pure read · no DB writes from this module.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/**
 * Return up to 3 Greene law numbers that best fit this person's
 * current state. Returns [] when no candidate laws are seeded or
 * the AI failed to produce a parseable answer (safe default · the
 * surface renders empty + the cron keeps moving).
 */
export async function tagApplicableLaws(
  personId: string,
): Promise<number[]> {
  // Wave AM · 2026-05-28 · soft-delete safety
  const person = await prisma.personProfile.findFirst({
    where: { id: personId, deletedAt: null },
  });
  if (!person) return [];

  const lawRows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.GREENE_LAW,
      key: { startsWith: "law_" },
    },
    select: { key: true, content: true },
  });
  if (lawRows.length === 0) return [];

  const laws = lawRows
    .map((r) => {
      try {
        const parsed = JSON.parse(r.content) as {
          number?: number;
          title?: string;
          applicabilityPrompt?: string;
        };
        if (
          typeof parsed.number !== "number" ||
          typeof parsed.title !== "string" ||
          typeof parsed.applicabilityPrompt !== "string"
        ) {
          return null;
        }
        return {
          number: parsed.number,
          title: parsed.title,
          prompt: parsed.applicabilityPrompt,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (l): l is { number: number; title: string; prompt: string } =>
        l !== null,
    );
  if (laws.length === 0) return [];

  const metaAny = person.metadata as Record<string, unknown> | null;
  const recentSum =
    metaAny && typeof metaAny.recentLedgerSum === "number"
      ? metaAny.recentLedgerSum
      : "unknown";

  const personState = `Person ${person.name} · role ${person.role} · status ${person.status} · trust ${person.trustScore} · power ${person.powerBalance} · darkTraits [${person.darkTraits.join(",")}] · recent ledger trend ${recentSum}`;

  const lawsBlock = laws
    .map((l) => `Law ${l.number} "${l.title}": ${l.prompt}`)
    .join("\n");

  try {
    const result = await tracedAiChat(
      {
        label: "greene-law-tag",
        source: "cron",
        metadata: { personId },
      },
      [
        {
          role: "system",
          content:
            "Select up to 3 most-applicable Greene laws for this person. Output STRICT JSON only · no fences.",
        },
        {
          role: "user",
          content: `${personState}\n\nCandidate laws:\n${lawsBlock}\n\nOutput JSON: {"applicableLaws":[<number>,<number>,<number>]}`,
        },
      ],
      "reason",
    );
    const raw = (result.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as { applicableLaws?: unknown };
    if (!Array.isArray(parsed.applicableLaws)) return [];
    return parsed.applicableLaws
      .filter(
        (n): n is number =>
          typeof n === "number" &&
          Number.isInteger(n) &&
          n >= 1 &&
          n <= 48,
      )
      .slice(0, 3);
  } catch {
    return [];
  }
}
