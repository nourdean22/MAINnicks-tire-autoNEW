/**
 * 2026-05-27 · Power Atlas Phase 2 · Psychographic ladder profiler.
 *
 * Adapts the `customer-psychographic-profiler` framework: extract
 * identity · needs · fears · status concerns · 1-line values snapshot
 * from operator's chat corpus mentioning the person. Output written
 * to PersonProfile.psychographicLadder by the weekly refresh cron.
 *
 * Same pattern as behavioral-xray-adapter (≥5 mentions gate · structured
 * JSON · null on failure · refreshedAt timestamp).
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface PsychographicLadder {
  identity: string[]; // who they see themselves as
  needs: string[]; // unmet needs driving behavior
  fears: string[]; // anxieties they protect against
  statusConcerns: string[]; // how they want to be seen
  valuesSnapshot: string; // 1-sentence values summary
  refreshedAt: string;
}

export async function runPsychographicLadder(
  personId: string,
): Promise<PsychographicLadder | null> {
  const person = await prisma.personProfile.findUnique({
    where: { id: personId },
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

  const prompt = `Psychographic ladder profiling a single person from operator's chat about them. Output STRICT JSON only · no fences.

Person: ${person.name}
Role: ${person.role}

Operator's chat mentions (last 40):
${corpus}

Infer:
{
  "identity": ["3-5 short phrases of who they see themselves as"],
  "needs": ["3-5 short phrases of unmet needs that drive their behavior"],
  "fears": ["3-5 short phrases of anxieties they protect against"],
  "statusConcerns": ["3-5 short phrases of how they want to be seen"],
  "valuesSnapshot": "1-sentence values summary"
}`;

  try {
    const result = await tracedAiChat(
      {
        label: "psychographic-ladder",
        source: "cron",
        metadata: { personId },
      },
      [
        {
          role: "system",
          content:
            "You are a psychographic analyst trained in self-determination theory + identity theory + values-based segmentation. Output STRICT JSON only following the schema below.",
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
      PsychographicLadder,
      "refreshedAt"
    >;
    return { ...parsed, refreshedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}
