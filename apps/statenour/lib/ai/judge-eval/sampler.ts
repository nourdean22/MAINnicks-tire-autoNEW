/**
 * lib/ai/judge-eval/sampler.ts · Phase W (2026-05-18 PM)
 *
 * Pulls recent assistant chat replies from the ChatMessage table and
 * pairs each with the immediately-preceding user message to form a
 * `{prompt, v2Reply, messageId}` candidate the operator can compare
 * against V1.
 *
 * The dashboard surfaces these in a "Candidate prompts" section ·
 * operator copies the prompt + V2 reply, manually generates a V1 reply
 * (or pastes one from a captured trace), then POSTs to
 * /api/judge-eval/run to add it to the corpus.
 *
 * Phase W+ will close the loop with a shadow-execute cron that fires
 * V1 automatically · until then this is the unblock for the manual
 * workflow the V.6 endpoint enables.
 *
 * IMPORTANT contract · we only sample assistant replies whose
 * preceding message in the same conversation has role = "user". Any
 * orphan assistant reply (tool result, system, prefix-less) is
 * skipped because the comparator needs both halves.
 *
 * IMPORTANT contract · we filter out samples that ALREADY have a
 * comparison run recorded (cross-reference via messageId stored in
 * the PROMPT_COMPARISON_RUN metadata) so the operator doesn't
 * duplicate work.
 */

import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/judge-eval/sampler");

export interface CandidateSample {
  messageId: string;
  conversationId: string;
  prompt: string;
  v2Reply: string;
  /** ISO-8601 string · createdAt of the assistant reply. */
  createdAt: string;
  /** Heuristic intent class · null if no marker matches. */
  intentClass: string | null;
}

interface SampleOptions {
  /** Cap on number of candidates returned. Default 20. */
  take?: number;
  /** Only consider assistant replies from the last N days. Default 7. */
  sinceDays?: number;
  /** If true, return ONLY samples that have not yet been compared
   *  (default true · this is the common case for corpus building). */
  excludeAlreadyCompared?: boolean;
}

/**
 * Heuristic intent classifier · keeps the sampler dependency-free
 * (no LLM call). Matches the categories the dashboard's "by intent"
 * breakdown is most useful for · refined later as patterns emerge.
 *
 * Exported for unit-testability · the routing rules are stable
 * enough that drift would meaningfully change which intent class a
 * prompt lands in (and therefore which bucket the dashboard shows).
 */
export function classifyIntent(prompt: string): string | null {
  const lc = prompt.trim().toLowerCase();
  if (!lc) return null;
  if (/^(what|when|where|who|how|why|which)\b/.test(lc)) return "question";
  if (/^(write|draft|compose|create|make|generate)\b/.test(lc)) return "compose";
  if (/^(summarize|tldr|tl;dr|sum up)/.test(lc)) return "summarize";
  if (/^(plan|design|sketch|outline)\b/.test(lc)) return "plan";
  if (/^(should|do you think|recommend|advice|advise)\b/.test(lc)) return "decide";
  if (/^(fix|debug|why isn'?t|why won'?t)\b/.test(lc)) return "debug";
  if (/^(audit|review|check|inspect)\b/.test(lc)) return "review";
  if (lc.length > 250) return "long-form";
  return null;
}

/**
 * Read recent V2 assistant replies + paired user prompts. Returns
 * newest-first. Best-effort · returns [] on persistence failure.
 */
export async function readRecentV2Samples(
  options: SampleOptions = {},
): Promise<CandidateSample[]> {
  const take = options.take ?? 20;
  const sinceDays = options.sinceDays ?? 7;
  const excludeAlreadyCompared = options.excludeAlreadyCompared ?? true;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  try {
    const { prisma } = await import("@/lib/prisma");

    // Pull a bigger batch than `take` so the pairing step has room to
    // filter out unpairable assistant replies and already-compared ones.
    const RAW_FETCH_MULTIPLIER = 4;
    const assistantRows = await prisma.chatMessage.findMany({
      where: {
        role: "assistant",
        createdAt: { gte: since },
        content: { not: "" },
      },
      orderBy: { createdAt: "desc" },
      take: take * RAW_FETCH_MULTIPLIER,
      select: {
        id: true,
        conversationId: true,
        content: true,
        createdAt: true,
      },
    });

    if (assistantRows.length === 0) return [];

    // For each assistant reply, look up the immediately-preceding user
    // message in the same conversation. Single pass · O(N) prisma calls
    // · cap at the raw fetch size so worst-case is ~80 queries per
    // dashboard load. Fine for an operator-grade page.
    const candidates: CandidateSample[] = [];
    for (const reply of assistantRows) {
      if (candidates.length >= take) break;

      const precedingUser = await prisma.chatMessage.findFirst({
        where: {
          conversationId: reply.conversationId,
          role: "user",
          createdAt: { lt: reply.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      if (!precedingUser?.content || !precedingUser.content.trim()) continue;

      candidates.push({
        messageId: reply.id,
        conversationId: reply.conversationId,
        prompt: precedingUser.content,
        v2Reply: reply.content,
        createdAt: reply.createdAt.toISOString(),
        intentClass: classifyIntent(precedingUser.content),
      });
    }

    if (!excludeAlreadyCompared || candidates.length === 0) {
      return candidates;
    }

    // Cross-reference against PROMPT_COMPARISON_RUN BrainMemory rows ·
    // any sample whose messageId already appears in metadata is dropped.
    // We pull the recent comparison heads (same window as samples) and
    // build a set for O(1) lookup.
    const comparisonRows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.PROMPT_COMPARISON_RUN,
        deletedAt: null,
        createdAt: { gte: since },
      },
      select: { metadata: true },
      take: 1000,
    });

    const alreadyCompared = new Set<string>();
    for (const row of comparisonRows) {
      const m = (row.metadata ?? {}) as Record<string, unknown>;
      if (typeof m.sourceMessageId === "string") {
        alreadyCompared.add(m.sourceMessageId);
      }
    }

    return candidates.filter((c) => !alreadyCompared.has(c.messageId));
  } catch (e) {
    log.warn("sampler_failed", { err: (e as Error).message?.slice(0, 200) });
    return [];
  }
}
