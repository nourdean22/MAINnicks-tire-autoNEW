/**
 * lib/services/ai-teach.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The Learn-mode "teach" engine · lifted verbatim from
 * app/api/ai/teach/route.ts so the legacy REST endpoint AND the new
 * `ai.teach` tRPC procedure call the SAME function · drift between
 * consumers structurally impossible.
 *
 * Give it a topic and Nick generates a tight micro-course that gets
 * Nour from zero to operator-level understanding in one read.
 *
 * The return type is `TeachResult` — an explicit, flat interface. The
 * AI payload is a heterogeneous JSON blob spread into known string /
 * string[] fields, so no Prisma row and no recursive Json type reaches
 * the AppRouter (the TS2589 firewall is satisfied trivially).
 */

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { prisma } from "@/lib/prisma";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("service/ai-teach");

export type TeachDepth = "quick" | "standard" | "deep";

/** A generated micro-course · the flat shape the Learn tab renders. */
export interface TeachResult {
  topic: string;
  depth: TeachDepth;
  title?: string;
  overview?: string;
  keyConcepts?: string[];
  mvuRead?: string;
  rulesOfThumb?: string[];
  commonMistakes?: string[];
  tryToday?: string;
  resources?: Array<{ title: string; url?: string; note?: string }>;
  nextQuestions?: string[];
  learningPath?: Array<{ topic: string; why: string }>;
  provider?: string;
  /** Set when the model returned non-JSON and `mvuRead` is the raw text. */
  raw?: boolean;
}

const DEPTH_FRAMING: Record<TeachDepth, string> = {
  quick:
    "5-minute read. Just the ONE big idea + 3 rules of thumb + one thing to try today. Nour is busy and wants signal.",
  standard:
    "15-minute read. Cover the 20% of this topic that handles 80% of the decisions. Include concrete examples from Nour's world (auto shop, Cleveland, revenue $20K target, 186 lbs goal).",
  deep:
    "30-minute read. The full operator's guide. Foundations, tactics, common traps, advanced moves. Write like Nour is going to rely on this.",
};

/**
 * Generate a micro-course on `topic`. The REST route and the `ai.teach`
 * procedure both call this. `depth` defaults to "standard".
 */
export async function runTeach(input: {
  topic: string;
  depth?: TeachDepth;
}): Promise<TeachResult> {
  const topic = input.topic;
  const depth: TeachDepth = input.depth ?? "standard";

  // Pull any relevant brain memories so the course references Nour's
  // actual situation, not generic advice.
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
          memories
            .map((m) => `- [${m.category}] ${m.content.slice(0, 200)}`)
            .join("\n");
      }
    }
  } catch (e) {
    logError("services.ai-teach", e, { stage: "recall-memories" }, "warn");
  }

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

  // Strategic Frameworks lens injection. Teaching benefits from
  // framework reasoning · the lens block adds structure to the topic.
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
    depth === "quick" ? "fast" : "deep",
  );

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(result.content.replace(/```json|```/g, "").trim());
  } catch {
    parsed = { title: topic, mvuRead: result.content, raw: true };
  }

  return {
    topic,
    depth,
    ...parsed,
    provider: result.provider,
  } as TeachResult;
}
