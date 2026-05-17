/**
 * POST /api/ai/teach
 *
 * The Learn-mode teach endpoint. Give it a topic and Nick generates
 * a tight micro-course that gets Nour from zero to operator-level
 * understanding in one read.
 *
 * Unlike /api/ai/plan-project mode=learn which is project-scoped,
 * this one is AD-HOC — Nour can ask "teach me options trading" or
 * "teach me how to hire a shop manager" without creating a project.
 *
 * Body:
 *   { topic: string,
 *     depth?: "quick" | "standard" | "deep"   // default "standard"
 *   }
 *
 * Returns a structured course with keyConcepts, mvuRead, common
 * mistakes, resources, and practice exercises.
 */
import { NextRequest, NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
// v10.0.529.37 · Arc B F7 expansion · style addendum on the teach
// surface so micro-courses inherit operator-level voice tells.
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";

import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/teach");
export const maxDuration = 120;

const schema = z.object({
  topic: z.string().min(2).max(500),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

const DEPTH_FRAMING: Record<"quick" | "standard" | "deep", string> = {
  quick:
    "5-minute read. Just the ONE big idea + 3 rules of thumb + one thing to try today. Nour is busy and wants signal.",
  standard:
    "15-minute read. Cover the 20% of this topic that handles 80% of the decisions. Include concrete examples from Nour's world (auto shop, Cleveland, revenue $20K target, 186 lbs goal).",
  deep:
    "30-minute read. The full operator's guide. Foundations, tactics, common traps, advanced moves. Write like Nour is going to rely on this.",
};

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed_in = await safeParseBody(schema, req, "teach");
    if (!parsed_in.ok) return parsed_in.response;
    const { topic, depth } = parsed_in.data;

    // Pull any relevant brain memories so the course references
    // Nour's actual situation, not generic advice.
    let memoryContext = "";
    try {
      const keywords = topic
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 4);
      if (keywords.length > 0) {
        const memories = await prisma.brainMemory.findMany({
          where: {
            // v8.27 · soft-delete retrofit
            deletedAt: null,
            OR: keywords.map((k) => ({
              content: { contains: k, mode: "insensitive" as const },
            })),
          },
          orderBy: { confidence: "desc" },
          take: 6,
          select: { content: true, category: true },
        });
        if (memories.length > 0) {
          memoryContext =
            "\n\nNOUR CONTEXT (reference if relevant):\n" +
            memories.map((m) => `- [${m.category}] ${m.content.slice(0, 200)}`).join("\n");
        }
      }
    } catch {}

    const prompt = `Nour wants to learn: "${topic}".

${DEPTH_FRAMING[depth]}
${memoryContext}

You're Nour's teacher. You know he runs an auto shop in Cleveland, targets $20K/month revenue + 186 lbs body weight, and has ADHD + high drive. Write specifically for him.

Return ONLY valid JSON:
{
  "title": "Course title",
  "overview": "2-sentence overview — what he'll know after reading this",
  "keyConcepts": ["5-8 concepts at the core of the topic"],
  "mvuRead": "The actual teaching — 3-6 paragraphs, written in second person, plain English, specific examples from Nour's world when possible. This is the main read.",
  "rulesOfThumb": ["3-6 heuristics Nour can use under pressure without thinking"],
  "commonMistakes": ["3-5 mistakes that trip up beginners"],
  "tryToday": "ONE concrete action Nour can do in the next 24h to apply this",
  "resources": [
    { "title": "Resource name", "url": "optional https://...", "note": "why this is worth 10 minutes" }
  ],
  "nextQuestions": ["3 questions Nour should ask once he's absorbed this"],
  "learningPath": [
    { "topic": "Next topic to learn after this", "why": "One sentence explaining why this follows logically" },
    { "topic": "Second follow-up topic", "why": "Why this builds on what was just learned" },
    { "topic": "Third deeper topic", "why": "Where this path leads long-term" }
  ]
}`;

    // v10.0.251 · Strategic Frameworks lens injection (5th surface).
    // Teaching benefits from framework reasoning · the lens block adds
    // structure to the topic the same way Nick already structures
    // explanations. Topic-driven so business intent fires reliably.
    let lensBlock = "";
    try {
      const { pickFrameworks, composeStrategicLensBlock } = await import(
        "@/lib/ai/strategic-frameworks"
      );
      const { recordLensFire } = await import(
        "@/lib/ai/strategic-frameworks/record-lens-fire"
      );
      lensBlock = composeStrategicLensBlock(topic);
      if (lensBlock) {
        const matches = pickFrameworks(topic);
        recordLensFire({
          surface: "teach",
          matches,
          lensBlockLength: lensBlock.length,
          metadata: { depth },
        });
      }
    } catch (err) {
      log.warn("strategic_lens_failed", {
        surface: "teach",
        error: sanitizeError(err),
      });
    }

    const result = await tracedAiChat(
      { label: "teach", source: "tool", metadata: { topic, depth } },
      [
        {
          role: "system",
          content: await applyOperatorStyle(
            "You are the world's best teacher for busy operators. You write like Malcolm Gladwell meets a grizzled shop mechanic — stories + hard rules + zero fluff. Return only valid JSON." +
              (lensBlock ? `\n\n${lensBlock}` : ""),
          ),
        },
        { role: "user", content: prompt },
      ],
      depth === "quick" ? "fast" : "deep"
    );

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(result.content.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { title: topic, mvuRead: result.content, raw: true };
    }

    return NextResponse.json({
      topic,
      depth,
      ...parsed,
      provider: result.provider,
    });
  } catch (err) {
    return aiRouteError(err, "teach", "teach failed");
  }
}
