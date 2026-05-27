/**
 * 2026-05-27 · Power Atlas Phase 3 · Tone-shift detector.
 *
 * Compares the operator's recent sentiment (last 3 chat-mention messages)
 * vs the trailing window (next 30 messages back) for each person.
 * Sentiment scored by a thin tracedAiChat call ("fast" tier).
 *
 * Returns null when fewer than 10 mentions exist (signal too thin).
 * The cron writes the snapshot into PersonProfile.metadata.toneShift ·
 * the alert flag fires when |shift| ≥ 0.5 so the surface can highlight
 * it without firing Telegram.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export interface ToneShiftSnapshot {
  recentSentiment: number;
  trailingSentiment: number;
  shift: number;
  alert: boolean;
}

/**
 * Run the tone-shift detection for a single person. Returns null when
 * fewer than 10 chat mentions exist (signal too thin to act on).
 */
export async function detectToneShift(
  personId: string,
): Promise<ToneShiftSnapshot | null> {
  const person = await prisma.personProfile.findUnique({
    where: { id: personId },
  });
  if (!person) return null;

  const all = await prisma.chatMessage.findMany({
    where: {
      content: { contains: person.name, mode: "insensitive" },
      role: "user",
    },
    orderBy: { createdAt: "desc" },
    take: 33,
    select: { content: true },
  });
  if (all.length < 10) return null;

  const recent = all.slice(0, 3);
  const trailing = all.slice(3, 33);

  const score = async (texts: string[]): Promise<number> => {
    if (texts.length === 0) return 0;
    try {
      const result = await tracedAiChat(
        {
          label: "tone-sentiment",
          source: "cron",
          metadata: { personId },
        },
        [
          {
            role: "system",
            content:
              "Rate the operator's sentiment when mentioning this person. Output ONE number from -1 (very negative) to +1 (very positive). NO other text.",
          },
          {
            role: "user",
            content: texts.map((t) => t.slice(0, 500)).join("\n---\n"),
          },
        ],
        "fast",
      );
      const num = parseFloat((result.content ?? "0").trim());
      return Number.isFinite(num) ? Math.max(-1, Math.min(1, num)) : 0;
    } catch {
      return 0;
    }
  };

  const [recentSentiment, trailingSentiment] = await Promise.all([
    score(recent.map((m) => m.content)),
    score(trailing.map((m) => m.content)),
  ]);
  const shift = recentSentiment - trailingSentiment;
  return {
    recentSentiment,
    trailingSentiment,
    shift,
    alert: Math.abs(shift) >= 0.5,
  };
}
