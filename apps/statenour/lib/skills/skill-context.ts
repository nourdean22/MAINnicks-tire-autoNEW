/**
 * lib/skills/skill-context.ts · v10.0.434
 *
 * System-prompt helper that surfaces the top 3 skills semantically
 * relevant to the operator's CURRENT message · auto-injected during
 * prompt build when a userMessage is present.
 *
 * Why · the operator has 1,423 skills installed but most aren't
 * obvious until you need them. With this surface, Nick sees a
 * curated "look at these skills, they fit" hint each turn and can
 * either (a) pull the skill's protocol into the reply, or (b) call
 * the `searchSkills` tool to get more if 3 isn't enough.
 *
 * Safety · empty string when:
 *   · userMessage is missing / too short
 *   · no embeddings indexed yet
 *   · no skills above the 0.30 similarity floor
 * Operators get NO injection unless real signal is present.
 *
 * Cost · cached per-message-hash for 60s · the recall layer's own
 * query-cache absorbs repeats inside that window for free.
 */

import { recallSkills, formatSkillsBlock, type SkillMatch } from "./skill-recall";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("skills/context");

const TOP_K = 3;
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map<string, { block: string; at: number }>();

function hashMessage(s: string): string {
  // Cheap hash · last 80 chars (operator's intent usually at the end)
  return s.trim().slice(-80).toLowerCase();
}

/**
 * Returns a system-prompt section for the top relevant skills, or
 * empty string if no signal. Hard-fails closed (try/catch) so a
 * recall failure can't break the chat path.
 */
export async function getRelevantSkillsBlock(
  userMessage: string | null | undefined,
): Promise<string> {
  if (!userMessage || userMessage.trim().length < 10) return "";
  const key = hashMessage(userMessage);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.block;
  }

  try {
    const matches: SkillMatch[] = await recallSkills(userMessage, TOP_K);
    const block = formatSkillsBlock(matches, "Relevant skills");
    // Wrap with usage hint · tells the model HOW to use these
    const fullBlock = block
      ? `${block}\n` +
        `If one of these protocols cleanly fits the current request, apply it. ` +
        `Use the searchSkills tool to widen the search beyond top-${TOP_K}.`
      : "";
    cache.set(key, { block: fullBlock, at: Date.now() });
    if (cache.size > 50) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    // v10.0.471 · skill recall correlation logging (ADR-0007 open
    // item). Fire-and-forget · writes one SystemMetric row per recall
    // with skill names + similarity scores. Downstream `report-wisdom`
    // / future `report-skills` script joins this with judge-eval rows
    // by chat-conversation timestamps to build the "which skills correlate
    // with high-quality replies" picture for the quarterly top-50
    // re-curation pass. Best-effort · silent failure (the chat path
    // never blocks on telemetry).
    if (matches.length > 0) {
      void (async () => {
        try {
          const { prisma } = await import("@/lib/prisma");
          await prisma.systemMetric.create({
            data: {
              metric: "skill.recall.injected",
              value: matches.length,
              unit: "count",
              tags: {
                queryHash: key,
                skills: matches.map((m) => ({
                  name: m.name,
                  score: Math.round(m.similarity * 1000) / 1000,
                })),
              },
              source: "skill-recall",
            },
          });
        } catch {
          // telemetry must never block prompt delivery
        }
      })();
    }
    return fullBlock;
  } catch (err) {
    log.warn("relevant_skills_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return "";
  }
}
