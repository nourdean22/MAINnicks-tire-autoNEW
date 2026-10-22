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
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { getEmbedding } from "@/lib/ai/provider";
import { cosineSimilarity } from "./embedding-utils";
import type { Contradiction, ContradictionStatus } from "./contradiction-surfacer";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";
import { today } from "@/lib/utils/datetime";

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
  /**
   * Overrides SIMILARITY_THRESHOLD for this call only. Caller-supplied so
   * this module stays free of query-plan knowledge (mirrors
   * retrieval-arbiter.ts's injected-function pattern) — see
   * NICK_CORRECTION_THRESHOLD_BOOST in lib/feature-flags.ts for the one
   * caller that sets it today.
   */
  similarityThreshold?: number;
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
  const threshold = Number.isFinite(ctx.similarityThreshold) ? (ctx.similarityThreshold as number) : SIMILARITY_THRESHOLD;

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
    // 2026-09-18 · highest score across ALL candidates, threshold ignored.
    // NICK_CORRECTION_THRESHOLD_BOOST has been off since 2026-09-17 with the
    // reason "the 0.6 choice is a conservative starting guess, not
    // calibrated" — and there was no way to calibrate it, because a turn that
    // surfaced nothing recorded nothing, so the scores that ALMOST cleared the
    // bar were exactly the data nobody had. This is that data.
    //
    // It is free. The threshold is applied on the line AFTER the per-candidate
    // getEmbedding() above, so every candidate is embedded regardless of where
    // the bar sits; tracking the max costs one comparison, no extra I/O, and
    // changes no behaviour — `best` and the return value below are untouched.
    let bestAny: { key: string; sim: number } | null = null;
    for (const c of candidates) {
      const text = `${c.parsed.new_excerpt}\n${c.parsed.old_excerpt}`;
      const vec = await getEmbedding(text).catch((): number[] => []);
      if (vec.length === 0) continue;
      const sim = cosineSimilarity(userVec, vec);
      // Number.isFinite guard: cosineSimilarity returns NaN on a zero-magnitude
      // vector, and NaN poisons a running max — `sim > NaN` is false forever,
      // so a single NaN arriving FIRST would pin bestAny at NaN and publish
      // `bestSim: null` (JSON.stringify(NaN)) into the very distribution this
      // instrument exists to collect. Skip it; a candidate we cannot score is
      // not a near miss.
      if (Number.isFinite(sim) && (!bestAny || sim > bestAny.sim)) bestAny = { key: c.key, sim };
      if (sim < threshold) continue;
      if (!best || sim > best.sim) {
        best = { ...c, sim };
      }
    }
    if (!best) {
      // The near-miss band: something scored, nothing cleared the bar. Read the
      // distribution of `sim` here across real correction turns to pick the
      // boost threshold from evidence instead of from a guess. A turn with no
      // candidates at all logs nothing — that is an absence of signal, not a
      // near miss, and conflating the two would bias the distribution upward.
      if (bestAny) {
        console.info(
          "[contradiction-injector] near_miss",
          JSON.stringify({ threshold, bestSim: Number(bestAny.sim.toFixed(4)), candidates: candidates.length }),
        );
      }
      return null;
    }

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
  // The two excerpts are raw memory content → memory_recall (2026-09-02).
  return [
    "# CONTRADICTION ALERT",
    fenceContent(
      "contradictionAlert",
      "memory_recall",
      [`${hit.daysApart} days ago you said: "${hit.oldExcerpt}"`, `Today you said: "${hit.newExcerpt}"`].join("\n"),
    ),
    "",
    "These conflict. Ask the operator gently: \"which is current?\"",
    "Do NOT block your response — answer the actual question first, then",
    "weave the contradiction into a single closing line. If they answer,",
    `call the resolveContradiction tool with contradictionKey: "${hit.key}"`,
    "and currentBelief set to whichever side they confirmed.",
  ].join("\n");
}

// ── Claim vs record (2026-10-22) ───────────────────────────────────
// The nightly thinking engine (lib/brain/thinking-engine.ts, L7) writes
// "he said X, the record shows Y" rows to the `contradictions` TABLE — a
// different store from the BrainMemory rows above, which the surfacer has
// never written (0 rows, all time, measured 2026-10-22). The table had 76 open
// rows and nothing read them: 555 of 555 closures were the 30-day auto-expiry.
// Audit: docs/research/2026-10-22-insight-engines-audit.md.

/**
 * Measured 2026-10-22 (prod vector_embeddings, read-only): best cosine of each
 * of the 250 newest chat turns against 40 analysis-style memories was p50
 * 0.387, p90 0.459, p95 0.482, max 0.576. 0.47 sits near p92 of that, so a
 * gap clears it on roughly one turn in twelve before the once-a-day cap.
 * Calibrate from the `[claim-gap] score` log line, not from this guess.
 */
export const CLAIM_GAP_THRESHOLD = 0.47;
const CLAIM_GAP_LOOKBACK_DAYS = 30; // memory-consolidation auto-resolves at 30
const CLAIM_GAP_TOPIC_COOLDOWN_DAYS = 7;
const CLAIM_GAP_MAX_CANDIDATES = 12;
const CLAIM_GAP_KEY_PREFIX = "claim-gap:";
/** Candidate vectors by row id: without it every chat turn re-embeds up to 12 rows (the provider memo lasts 45s). */
const gapVecCache = new Map<string, number[]>();

export interface ClaimGap {
  id: string;
  claim: string;
  reality: string;
  gap: string;
  category: string;
  createdAt: Date;
  similarity: number;
}

/**
 * The open claim-vs-record row that best matches this turn, or null. At most
 * one per day (the day's log key is the claim, so two racing turns cannot both
 * fire) and never a category raised in the last week. Never throws.
 */
export async function findRelevantClaimGap(ctx: {
  userMessage: string;
  conversationId?: string | null;
  userEmbedding?: number[];
}): Promise<ClaimGap | null> {
  if (!ctx.userMessage || ctx.userMessage.length < 8) return null;
  try {
    const rows = await prisma.contradiction.findMany({
      where: {
        resolved: false,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - CLAIM_GAP_LOOKBACK_DAYS * 86400_000) },
      },
      orderBy: { createdAt: "desc" },
      take: CLAIM_GAP_MAX_CANDIDATES,
      select: { id: true, claim: true, reality: true, gap: true, category: true, createdAt: true },
    });
    if (rows.length === 0) return null;

    const day = today();
    const recent = await prisma.brainMemory.findMany({
      where: {
        category: "contradiction_injection_log",
        key: { startsWith: CLAIM_GAP_KEY_PREFIX },
        createdAt: { gte: new Date(Date.now() - CLAIM_GAP_TOPIC_COOLDOWN_DAYS * 86400_000) },
      },
      select: { key: true, content: true },
    });
    if (recent.some((r) => r.key === `${CLAIM_GAP_KEY_PREFIX}${day}`)) return null;
    const raisedTopics = new Set(
      recent.map((r) => {
        try {
          return String(JSON.parse(r.content).category ?? "");
        } catch {
          return "";
        }
      }),
    );
    const candidates = rows.filter((r) => !raisedTopics.has(r.category));
    if (candidates.length === 0) return null;

    const userVec = ctx.userEmbedding?.length
      ? ctx.userEmbedding
      : await getEmbedding(ctx.userMessage).catch((): number[] => []);
    if (userVec.length === 0) return null;

    const scored = await Promise.all(
      candidates.map(async (c) => {
        let vec = gapVecCache.get(c.id) ?? [];
        // A row's text never changes; re-embed only on a miss or a provider dimension change.
        if (vec.length !== userVec.length) {
          vec = await getEmbedding(`${c.claim}\n${c.reality}\n${c.gap}`).catch((): number[] => []);
          if (vec.length) {
            if (gapVecCache.size >= 200) gapVecCache.clear();
            gapVecCache.set(c.id, vec);
          }
        }
        const sim = vec.length ? cosineSimilarity(userVec, vec) : NaN;
        return { ...c, similarity: sim };
      }),
    );
    const best = scored
      .filter((s) => Number.isFinite(s.similarity))
      .sort((a, b) => b.similarity - a.similarity)[0];
    const fired = !!best && best.similarity >= CLAIM_GAP_THRESHOLD;
    console.info(
      "[claim-gap] score",
      JSON.stringify({
        threshold: CLAIM_GAP_THRESHOLD,
        bestSim: best ? Number(best.similarity.toFixed(4)) : null,
        candidates: candidates.length,
        fired,
      }),
    );
    if (!fired) return null;

    try {
      // brain-memory-direct-write: the once-a-day claim row (a dedupe marker, not a belief); create must fail on a duplicate key, which remember()'s upsert never does.
      await prisma.brainMemory.create({
        data: {
          category: "contradiction_injection_log",
          key: `${CLAIM_GAP_KEY_PREFIX}${day}`,
          content: JSON.stringify({
            contradictionId: best.id,
            category: best.category,
            similarity: best.similarity,
            conversationId: ctx.conversationId ?? null,
          }),
          confidence: 1,
          source: "contradiction_injector",
          expiresAt: new Date(Date.now() + (CLAIM_GAP_TOPIC_COOLDOWN_DAYS + 1) * 86400_000),
        },
      });
    } catch (err) {
      // P2002: another turn claimed today first. It surfaces; this one stays quiet.
      if ((err as { code?: string })?.code === "P2002") return null;
      logError("brain.contradiction-injector", err, { fn: "findRelevantClaimGap.claim" });
    }
    return best;
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: "findRelevantClaimGap" });
    return null;
  }
}

/** Prompt block for a claim-vs-record hit. The row text is model-written, so it is fenced. */
export function buildClaimGapBlock(hit: ClaimGap): string {
  return [
    "# CLAIM VS RECORD",
    fenceContent(
      "claimGap",
      "memory_recall",
      [`He said (${hit.category}): "${hit.claim}"`, `The record shows: "${hit.reality}"`, `The gap: "${hit.gap}"`].join("\n"),
    ),
    "",
    "Answer his actual question first. Only if this gap bears on what he is asking, add ONE",
    "closing line that names the gap in plain words and asks one question: is the record wrong",
    "(something is not being logged) or is the plan wrong? If he says the record is wrong, believe",
    "him and say what would have to be logged to fix it. No lecture, and do not raise it again in",
    "this conversation.",
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
