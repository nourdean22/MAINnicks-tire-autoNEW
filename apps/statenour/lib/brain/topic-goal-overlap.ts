/**
 * 2026-05-27 · Power Atlas Phase 3 · Topic graph × goal overlap.
 *
 * Extracts the top topics the operator consistently discusses about a
 * person + cross-references against active LifeGoals to derive a
 * "is this person on-mission" alignment score (0.0-1.0). Powered by a
 * single tracedAiChat "reason" call that does both extraction +
 * matching in one shot · cheaper than two passes.
 *
 * Returns null when fewer than 5 chat mentions exist (signal too thin).
 *
 * The cron persists the result into PersonProfile.metadata.topicGoalOverlap.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface TopicGoalOverlap {
  topics: string[];
  goalAlignmentScore: number;
  goalMatches: {
    goalId: string;
    goalTitle: string;
    matchedTopics: string[];
  }[];
}

export async function computeTopicGoalOverlap(
  personId: string,
): Promise<TopicGoalOverlap | null> {
  const person = await prisma.personProfile.findUnique({
    where: { id: personId },
  });
  if (!person) return null;

  const mentions = await prisma.chatMessage.findMany({
    where: {
      content: { contains: person.name, mode: "insensitive" },
      role: "user",
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { content: true },
  });
  if (mentions.length < 5) return null;

  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active" },
    select: { id: true, title: true, why: true, domain: true },
    take: 12,
  });
  if (goals.length === 0) return null;

  const userPrompt = `Chat mentions of ${person.name}:
${mentions
  .map((m) => m.content.slice(0, 200))
  .join("\n---\n")
  .slice(0, 6000)}

Operator's active goals:
${goals
  .map(
    (g) =>
      `- ${g.id} · "${g.title}" (${g.domain}, why: ${g.why ?? "—"})`,
  )
  .join("\n")}

Output JSON only · no fences:
{
  "topics": ["top 5 topics operator + person consistently discuss"],
  "goalAlignmentScore": 0.0 to 1.0,
  "goalMatches": [{"goalId", "goalTitle", "matchedTopics": ["which topics match"]}]
}`;

  try {
    const result = await tracedAiChat(
      {
        label: "topic-goal-overlap",
        source: "cron",
        metadata: { personId },
      },
      [
        {
          role: "system",
          content:
            "Extract top topics + cross-reference with goals. Output STRICT JSON only.",
        },
        { role: "user", content: userPrompt },
      ],
      "reason",
    );
    const raw = (result.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw) as TopicGoalOverlap;
    // Light sanitization · ensure shape conforms before persisting
    if (!Array.isArray(parsed.topics)) return null;
    if (
      typeof parsed.goalAlignmentScore !== "number" ||
      !Number.isFinite(parsed.goalAlignmentScore)
    )
      return null;
    return {
      topics: parsed.topics.slice(0, 8),
      goalAlignmentScore: Math.max(
        0,
        Math.min(1, parsed.goalAlignmentScore),
      ),
      goalMatches: Array.isArray(parsed.goalMatches)
        ? parsed.goalMatches.slice(0, 8)
        : [],
    };
  } catch {
    return null;
  }
}
