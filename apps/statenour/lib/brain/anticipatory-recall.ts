/**
 * Anticipatory Recall — embedding-based "likely-next context" lane.
 *
 * Today lib/ai/predictive-prefetch.ts pre-routes TOOL fetches by
 * keyword-matching the CURRENT message only. This complementary lane
 * works off the recent conversation TRAJECTORY (last few turns,
 * weighted toward the most recent user+assistant pair) and semantic-
 * searches brain memories for what Nick will likely need NEXT — so a
 * topic pivot mid-thread doesn't make him "forget what we were just
 * discussing".
 *
 * ADDITIVE + flag-gated. When NICK_ANTICIPATORY_RECALL is off this
 * returns "" immediately, so recall is byte-identical to today. It
 * never throws into the chat path (try/catch -> "") and self-bounds
 * with a 2000ms timeout matching the route's aux-promise pattern.
 *
 * It does NOT duplicate getContextualMemories — it's a thin lane that
 * reuses semanticSearch over sourceType "brain_memory" and returns the
 * top 2-3 hits NOT already present in the current recall block.
 */

import { getFlag } from "@/lib/feature-flags";
import { semanticSearch } from "@/lib/brain/embedding-utils";
import { fenceContent } from "@/lib/ai/tool-result-fencing";

const ANTICIPATE_TIMEOUT_MS = 2000;
const MIN_SIMILARITY = 0.35; // only confident next-topic matches
const MAX_HITS = 3;

interface TrajectoryMessage {
  role: string;
  content: string;
}

/**
 * Build the trajectory query text from the last few turns. The most
 * recent user+assistant pair is concatenated TWICE so the embedding is
 * weighted toward where the conversation is heading right now, while
 * still carrying the broader topic from earlier turns.
 */
function buildTrajectoryText(messages: TrajectoryMessage[]): string {
  const turns = messages
    .filter((m) => typeof m?.content === "string" && m.content.trim().length > 0)
    .slice(-4);
  if (turns.length === 0) return "";
  const flat = turns.map((m) => m.content.trim());
  // Most-recent pair (last up-to-2 turns) gets double weight.
  const recentPair = flat.slice(-2);
  return [...flat, ...recentPair].join("\n").slice(0, 1500);
}

/**
 * Pre-warm the memories Nick will likely need on the NEXT turn from
 * the recent conversation trajectory. Returns a short formatted
 * "### Likely-next context" block, or "" when off / empty / on any error.
 *
 * @param recentMessages last few chat turns ({ role, content }); the
 *   most recent pair is weighted highest.
 * @param alreadyRecalled the current recall block string (e.g. the
 *   getContextualMemories output) — hits whose content already appears
 *   here are skipped to avoid duplicating context.
 */
export async function anticipateMemories(
  recentMessages: TrajectoryMessage[],
  alreadyRecalled = "",
): Promise<string> {
  if (!getFlag("NICK_ANTICIPATORY_RECALL")?.isOn) return "";

  try {
    const trajectory = buildTrajectoryText(recentMessages ?? []);
    if (!trajectory) return "";

    const work = (async (): Promise<string> => {
      // semanticSearch embeds the trajectory and runs the same
      // pgvector/JSON cosine path the main recall uses — one embed +
      // one vector search. We over-fetch a little so the dedup step
      // still leaves us MAX_HITS.
      const matches = await semanticSearch(trajectory, MAX_HITS + 5, [
        "brain_memory",
      ]);
      if (matches.length === 0) return "";

      const seen = alreadyRecalled.toLowerCase();
      const picks: typeof matches = [];
      for (const m of matches) {
        if (m.similarity < MIN_SIMILARITY) continue;
        // Skip anything already in the current recall block. Compare on
        // a content prefix (recall truncates to ~200 chars when rendered).
        const probe = m.content.slice(0, 80).toLowerCase().trim();
        if (probe && seen.includes(probe)) continue;
        picks.push(m);
        if (picks.length >= MAX_HITS) break;
      }
      if (picks.length === 0) return "";

      // S-1 completion (2026-09-02) · these are BrainMemory rows of any
      // category (gmail_thread included). Heading outside, memories fenced.
      const body: string[] = [];
      for (const m of picks) {
        const cat = m.category ?? m.sourceType;
        body.push(`[${cat}] ${m.content.slice(0, 180)}`);
      }
      return [
        "### Likely-next context (anticipated from where this conversation is heading)",
        fenceContent("anticipatoryRecall", "memory_recall", body.join("\n"), { maxChars: 20_000 }),
      ].join("\n");
    })();

    // Match the route's aux-promise timeout pattern: a slow embed or
    // vector scan never blocks the chat stream.
    return await Promise.race([
      work,
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(""), ANTICIPATE_TIMEOUT_MS),
      ),
    ]);
  } catch {
    // Never throw into the chat path.
    return "";
  }
}
