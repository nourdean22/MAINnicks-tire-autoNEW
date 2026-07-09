/**
 * Contradiction Injector — Arc B Feature 5 · v10.0.526
 *
 * Bridges the existing contradiction-surfacer (which DETECTS) into the
 * chat route (which surfaces them mid-turn so Nick can ask "which is
 * current?"). The detector already writes BrainMemory(category=
 * "contradiction") rows; this module reads them, cosine-matches against
 * the operator's CURRENT statement, and returns the single highest-
 * confidence relevant one so the chat route can append it as a SOFT
 * NUDGE context block before streamText.
 *
 * The bet — same as the surfacer: catching "I'm changing X" mid-
 * conversation is far more valuable than catching it after-the-fact in
 * a /brain dashboard tile. The cost is one extra cosine pass per turn
 * over ~40 rows; cheap when contradictions are sparse.
 *
 * Why this file exists (vs. extending contradiction-surfacer):
 *   - The surfacer is on the WRITE path (importance-scorer post-hook).
 *   - This is on the READ path (chat-route pre-streamText hook).
 *   - Different lifecycle = different file. Resolves cleanly when both
 *     are imported by the chat pipeline.
 *
 * NO PARALLEL TABLE: everything lives in BrainMemory. The single new
 * synthetic category is "contradiction_injection_log" — a tiny
 * dedup-per-conversation-per-day marker (key = "${convId}:${date}:${
 * contradictionKey}"). Eliminates the re-inject-every-turn problem
 * without needing a Contradiction.surfacedInConversations column.
 *
 * Dismissal respect: a contradiction whose stored JSON has
 *   status: "dismissed" / "current_wins" / "old_wins" / "both_valid"
 * is filtered out. Re-surfacing a resolved one is a trust-killer.
 *
 * Idempotency: per (conversationId, date, contradictionKey). The same
 * contradiction can re-surface tomorrow, but not twice today in the
 * same convo. This is a deliberate "kaizen · error-proofing" choice —
 * the most likely failure mode is the user dismissing in-chat, the
 * model re-surfacing the same alert next message, and Nour losing
 * trust in the surfacing.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { cosineSimilarity } from "./embedding-utils";
import type { Contradiction, ContradictionStatus } from "./contradiction-surfacer";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const SIMILARITY_THRESHOLD = 0.7;
const LOOKBACK_DAYS = 60;
const DISMISS_WINDOW_DAYS = 30;
const MAX_CANDIDATES = 40;

export interface RelevantContradiction {
  key: string;
  newExcerpt: string;
  oldExcerpt: string;
  daysApart: number;
  signal: Contradiction["signal"];
  similarity: number;
  createdAt: string;
}

interface InjectionContext {
  userMessage: string;
  conversationId?: string | null;
}

/**
 * Pull all unresolved contradictions from the last LOOKBACK_DAYS,
 * cosine-match each one's combined excerpt-text against the user's
 * current message, and return the single highest-similarity hit when
 * it clears the threshold — provided it hasn't been dismissed in the
 * last DISMISS_WINDOW_DAYS and hasn't already been surfaced in this
 * conversation today.
 *
 * Returns null on any of: no embedding, no candidates, similarity
 * below threshold, dismissed-recently, already-surfaced-today.
 *
 * Best-effort throughout — any DB or embedding failure returns null,
 * never throws. The chat route MUST be able to call this without a
 * try/catch wrapping the call site.
 */
export async function findRelevantContradictions(
  ctx: InjectionContext,
): Promise<RelevantContradiction | null> {
  const { userMessage, conversationId } = ctx;
  if (!userMessage || userMessage.length < 8) return null;

  try {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.CONTRADICTION,
        deletedAt: null,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_CANDIDATES,
      select: { key: true, content: true, createdAt: true },
    });
    if (rows.length === 0) return null;

    // Parse + filter to unresolved-only first, BEFORE the embedding
    // call. Embedding the user message is the expensive step
    // (network round-trip to Venice); skip it when there are no
    // viable candidates to compare against.
    const candidates: Array<{
      key: string;
      parsed: Contradiction;
      createdAt: Date;
    }> = [];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.content) as Contradiction;
        const status: ContradictionStatus = parsed.status ?? "unresolved";
        if (status !== "unresolved") {
          // Respect dismissal: if status is anything other than
          // unresolved AND it was resolved within DISMISS_WINDOW_DAYS,
          // skip. Older resolutions are also skipped — once it's
          // resolved, the canonical belief moves on.
          if (parsed.resolved_at) {
            const resolvedAt = new Date(parsed.resolved_at).getTime();
            const ageDays = (Date.now() - resolvedAt) / 86400_000;
            if (ageDays < DISMISS_WINDOW_DAYS) continue;
            // Still skip even past the window — a resolved
            // contradiction has had its canonical belief written. The
            // window is just to make the intent of "respect dismissal"
            // explicit; in practice we always skip non-unresolved.
            continue;
          }
          continue;
        }
        candidates.push({ key: r.key, parsed, createdAt: r.createdAt });
      } catch (err) {
        // Corrupted row — ignore
        logError("brain.contradiction-injector", err, { fn: "findRelevantContradictions.parse" });
      }
    }
    if (candidates.length === 0) return null;

    // Embed once
    const userVec = await getEmbedding(userMessage).catch((): number[] => []);
    if (userVec.length === 0) return null;

    // Cosine each candidate's combined excerpt vs. the user message.
    // Why combined: the user's NEW statement might match the OLD
    // position (they're re-affirming the old view) OR the NEW position
    // (they're doubling-down on the new view). Either way, the
    // contradiction is relevant — embed the concatenation so we catch
    // semantic overlap with either side.
    let best: { key: string; parsed: Contradiction; createdAt: Date; sim: number } | null = null;
    for (const c of candidates) {
      const text = `${c.parsed.new_excerpt}\n${c.parsed.old_excerpt}`;
      const vec = await getEmbedding(text).catch((): number[] => []);
      if (vec.length === 0) continue;
      const sim = cosineSimilarity(userVec, vec);
      if (sim < SIMILARITY_THRESHOLD) continue;
      if (!best || sim > best.sim) {
        best = { ...c, sim };
      }
    }
    if (!best) return null;

    // Per-conversation-per-day idempotency. The dedup marker is a
    // tiny BrainMemory row in its own category so the contradiction
    // row itself stays clean. The key encodes convId + date + the
    // contradiction key — same convo + same day + same contradiction
    // = skip. Different day or different convo = re-surface allowed.
    if (conversationId) {
      const dedupKey = buildDedupKey(conversationId, best.key);
      const already = await prisma.brainMemory.findUnique({
        where: {
          category_key: {
            category: "contradiction_injection_log",
            key: dedupKey,
          },
        },
        select: { id: true },
      });
      if (already) return null;

      // Write the dedup marker BEFORE returning so a second concurrent
      // turn in the same conversation doesn't both fire. Best-effort —
      // if the write fails we still return the hit (degraded but
      // non-broken behavior).
      await prisma.brainMemory
        .create({
          data: {
            category: "contradiction_injection_log",
            key: dedupKey,
            content: JSON.stringify({
              conversationId,
              contradictionKey: best.key,
              surfacedAt: new Date().toISOString(),
              similarity: best.sim,
            }),
            confidence: 1,
            source: "contradiction_injector",
            // TTL · the log only needs to live ~24h to suppress same-
            // day re-surfacing. Set a 7-day expiry so the daily-decay
            // cron eventually prunes it.
            expiresAt: new Date(Date.now() + 7 * 86400_000),
          },
        })
        .catch((err) => {
          /* race / dup — non-fatal */
          logError("brain.contradiction-injector", err, { fn: "findRelevantContradictions.createLog" });
        });
    }

    return {
      key: best.key,
      newExcerpt: best.parsed.new_excerpt,
      oldExcerpt: best.parsed.old_excerpt,
      daysApart: best.parsed.days_apart,
      signal: best.parsed.signal,
      similarity: best.sim,
      createdAt: best.createdAt.toISOString(),
    };
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: "findRelevantContradictions" });
    return null;
  }
}

/**
 * Build the prompt block the chat route will append to systemPrompt.
 * Exported so tests can lock the wording without re-importing the
 * route.
 */
export function buildContradictionAlertBlock(hit: RelevantContradiction): string {
  return [
    "# CONTRADICTION ALERT",
    `${hit.daysApart} days ago you said: "${hit.oldExcerpt}"`,
    `Today you said: "${hit.newExcerpt}"`,
    "",
    "These conflict. Ask the operator gently: \"which is current?\"",
    "Do NOT block your response — answer the actual question first, then",
    "weave the contradiction into a single closing line. If they answer,",
    `call the resolveContradiction tool with contradictionKey: "${hit.key}"`,
    "and currentBelief set to whichever side they confirmed.",
  ].join("\n");
}

function buildDedupKey(conversationId: string, contradictionKey: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${conversationId}:${date}:${contradictionKey}`;
}

/**
 * Test/debug helper: clear the per-day dedup markers for a given
 * conversation. Not used in production hot paths — only exported so
 * tests can reset state between cases without poking BrainMemory
 * directly.
 */
export async function clearInjectionLog(conversationId: string): Promise<number> {
  const res = await prisma.brainMemory
    .deleteMany({
      where: {
        category: "contradiction_injection_log",
        key: { startsWith: `${conversationId}:` },
      },
    })
    .catch(() => ({ count: 0 }));
  return res.count;
}
