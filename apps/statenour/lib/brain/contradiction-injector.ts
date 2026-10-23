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
import { getEmbedding, getEmbeddingWithModel, type EmbeddingResult } from "@/lib/ai/provider";
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
//
// Two steps on purpose (PR #3219 review): findRelevantClaimGap only READS, and the
// caller claims the day with claimClaimGapDay once it knows the block will be used.
// A lookup that outlives the caller's timeout therefore cannot spend the day.

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
const CLAIM_GAP_FETCH = 60; // open rows read before the cooldown filter
const CLAIM_GAP_MAX_CANDIDATES = 24; // scored after it
const CLAIM_GAP_KEY_PREFIX = "claim-gap:";
/** Candidate embeddings in flight at once: a cold cache must not burst the provider chain. */
const CLAIM_GAP_EMBED_CONCURRENCY = 4;
/**
 * Candidate vectors by row id, with the model that made them: every provider
 * returns 1024 dims, so only the model id tells two embedding spaces apart.
 * Without the cache every chat turn re-embeds the candidates (the provider memo lasts 45s).
 */
const gapVecCache = new Map<string, EmbeddingResult>();

export interface ClaimGap {
  id: string;
  /** The ET calendar day the thinking engine recorded the row (thinking-engine.ts writes today()). */
  date: string;
  claim: string;
  reality: string;
  gap: string;
  category: string;
  /** Where the claim came from. The thinking engine writes "ai_detected": its inference, not his words. */
  claimSource?: string;
  createdAt: Date;
  similarity: number;
}

/** claimSource values that ARE his words (schema comment on Contradiction.claimSource). Anything else is inferred. */
const OWN_WORDS_SOURCES = new Set(["chat", "brain_dump", "commitment"]);

type ClaimRow = { claim: string; category: string; claimSource?: string };
const isOwnWords = (row: ClaimRow) => !!row.claimSource && OWN_WORDS_SOURCES.has(row.claimSource);

/** The claim line (inside the fence): quoted only when it is his words, otherwise labelled as an inference. */
function claimLines(row: ClaimRow): string[] {
  return isOwnWords(row)
    ? [`He said (${row.category}): "${row.claim}"`]
    : [`Inferred claim, not his words (${row.category}; source: ${row.claimSource ?? "unknown"}): "${row.claim}"`];
}

/** The matching instruction (outside the fence, where instructions belong). */
function claimProvenanceLines(row: ClaimRow): string[] {
  return isOwnWords(row)
    ? []
    : ["The claim is the engine's inference from his records, not his words: never say he said it; say the record suggests it."];
}

/**
 * The open claim-vs-record row that best matches this turn, or null. Read-only.
 * Returns null when today's gap was already shown, and never offers a category
 * raised in the last week. Never throws.
 */
export async function findRelevantClaimGap(ctx: { userMessage: string }): Promise<ClaimGap | null> {
  if (!ctx.userMessage || ctx.userMessage.length < 8) return null;
  try {
    const rows = await prisma.contradiction.findMany({
      where: {
        resolved: false,
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - CLAIM_GAP_LOOKBACK_DAYS * 86400_000) },
      },
      orderBy: { createdAt: "desc" },
      take: CLAIM_GAP_FETCH,
      select: { id: true, date: true, claim: true, reality: true, gap: true, category: true, claimSource: true, createdAt: true },
    });
    if (rows.length === 0) return null;

    const recent = await prisma.brainMemory.findMany({
      where: {
        category: "contradiction_injection_log",
        // One shared day key for this and the daily question (claimDailyContradiction), so a day
        // that already asked a contradiction stays at one, and that topic cools down too.
        key: { startsWith: CLAIM_GAP_KEY_PREFIX },
        createdAt: { gte: new Date(Date.now() - CLAIM_GAP_TOPIC_COOLDOWN_DAYS * 86400_000) },
      },
      select: { key: true, content: true, lastSeen: true },
    });
    const todayKey = claimKey();
    if (recent.some((r) => r.key === todayKey && claimHoldsDay(r))) return null;
    // Only topics actually ASKED cool down; a reservation that was never delivered raised nothing.
    const raisedTopics = new Set(recent.filter((r) => isAsked(r.content)).map((r) => String(parseClaim(r.content).category ?? "")));
    // Cooldown BEFORE the cap, so recently raised topics cannot crowd out the rest.
    const candidates = rows.filter((r) => !raisedTopics.has(r.category)).slice(0, CLAIM_GAP_MAX_CANDIDATES);
    if (candidates.length === 0) return null;

    // The chat route embedded this same text a moment ago, so this is a memo hit; it is
    // called here (not passed in) because only this call reports the model.
    const user = await getEmbeddingWithModel(ctx.userMessage).catch(
      (): EmbeddingResult => ({ vec: [], model: null }),
    );
    if (user.vec.length === 0 || !user.model) return null;

    const scoreOne = async (c: (typeof candidates)[number]) => {
      let emb = gapVecCache.get(c.id);
      if (!emb || emb.model !== user.model) {
        emb = await getEmbeddingWithModel(`${c.claim}\n${c.reality}\n${c.gap}`).catch(
          (): EmbeddingResult => ({ vec: [], model: null }),
        );
        if (emb.vec.length) {
          if (gapVecCache.size >= 200) gapVecCache.clear();
          gapVecCache.set(c.id, emb);
        }
      }
      // Scores across two embedding spaces mean nothing: an unmatched candidate is not scored.
      const sim = emb.vec.length && emb.model === user.model ? cosineSimilarity(user.vec, emb.vec) : NaN;
      return { ...c, similarity: sim };
    };
    // Bounded: at most CLAIM_GAP_EMBED_CONCURRENCY provider calls at once (PR #3219 review).
    const scored: Array<ClaimGap> = [];
    for (let i = 0; i < candidates.length; i += CLAIM_GAP_EMBED_CONCURRENCY) {
      scored.push(...(await Promise.all(candidates.slice(i, i + CLAIM_GAP_EMBED_CONCURRENCY).map(scoreOne))));
    }
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
    return fired ? best : null;
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: "findRelevantClaimGap" });
    return null;
  }
}

// ── The day claim: a RESERVATION first, the "asked" receipt only after delivery ──
// One unique key per ET day (claim-gap:<day>) for both the claim gap and the daily
// question. brain-context writes it as state "reserved" before generation; the
// persist path (persist-assistant-turn.ts) promotes it to "asked" once the reply
// is stored and asks a question. A reservation nobody promoted within
// RESERVATION_STALE_MS (failed, cancelled or question-less turn) stops holding
// the day and can be taken over by compare-and-swap. Only "asked" rows count as
// asked: the follow-up, the topic cooldown and the kill criterion read those.

const LOG_CATEGORY = "contradiction_injection_log";
const RESERVATION_STALE_MS = 10 * 60_000;
const RESERVED_MARK = '"state":"reserved"';

/** What brain-context hands the persist path for this turn's claim. */
export interface ContradictionClaim {
  key: string;
  contradictionId: string;
  kind: "match" | "daily";
}

export function claimKey(day: string = today()): string {
  return `${CLAIM_GAP_KEY_PREFIX}${day}`;
}

function parseClaim(content: string): { state?: string; contradictionId?: unknown; conversationId?: unknown; category?: unknown } {
  try {
    return JSON.parse(content) ?? {};
  } catch {
    return {};
  }
}

/** Rows written before reservations existed carry no state: they were asked. */
const isAsked = (content: string) => (parseClaim(content).state ?? "asked") === "asked";

/** Does this claim row hold its day? Asked: yes. Reserved: only while fresh. */
function claimHoldsDay(row: { content: string; lastSeen: Date }): boolean {
  if (isAsked(row.content)) return true;
  return Date.now() - row.lastSeen.getTime() < RESERVATION_STALE_MS;
}

/**
 * Reserve `key` for this turn. Create wins outright; on a duplicate key, a STALE
 * reservation is taken over with a compare-and-swap on that exact state
 * (claim-before-act), so two racing turns still cannot both win. Any other
 * failure returns false and the caller shows nothing.
 */
async function reserveDay(key: string, content: Record<string, unknown>, ttlDays: number, fn: string): Promise<boolean> {
  const body = JSON.stringify({ ...content, state: "reserved" });
  const expiresAt = new Date(Date.now() + ttlDays * 86400_000);
  try {
    // brain-memory-direct-write: the once-a-day claim row (a dedupe marker, not a belief); create must fail on a duplicate key, which remember()'s upsert never does.
    await prisma.brainMemory.create({
      data: { category: LOG_CATEGORY, key, content: body, confidence: 1, source: "contradiction_injector", expiresAt, lastSeen: new Date() },
    });
    return true;
  } catch (err) {
    if ((err as { code?: string })?.code !== "P2002") {
      logError("brain.contradiction-injector", err, { fn });
      return false;
    }
  }
  try {
    const took = await prisma.brainMemory.updateMany({
      where: {
        category: LOG_CATEGORY,
        key,
        content: { contains: RESERVED_MARK },
        lastSeen: { lt: new Date(Date.now() - RESERVATION_STALE_MS) },
      },
      data: { content: body, lastSeen: new Date(), expiresAt },
    });
    return took.count === 1;
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: `${fn}.takeover` });
    return false;
  }
}

/**
 * Promote this turn's reservation to the "asked" receipt, after the reply was
 * persisted. Only when the stored reply asks a question, and only while the row
 * is still this turn's reservation (CAS on the exact content read).
 * shortcut: "asks a question" = the reply contains "?"; upgrade to a model check if it misfires.
 */
export async function markContradictionAsked(claim: ContradictionClaim, messageId: string, replyText: string): Promise<boolean> {
  if (!replyText.includes("?")) return false;
  try {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: LOG_CATEGORY, key: claim.key } },
      select: { content: true, lastSeen: true },
    });
    if (!row) return false;
    const parsed = parseClaim(row.content);
    if (parsed.state !== "reserved" || parsed.contradictionId !== claim.contradictionId) return false;
    const done = await prisma.brainMemory.updateMany({
      where: { category: LOG_CATEGORY, key: claim.key, content: row.content },
      data: { content: JSON.stringify({ ...parsed, state: "asked", messageId, askedAt: new Date().toISOString() }) },
    });
    return done.count === 1;
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: "markContradictionAsked" });
    return false;
  }
}

/**
 * Reserve today's single contradiction slot for `hit` (shared with the daily
 * question). Any failed write returns false and the caller shows nothing: the
 * once-a-day cap holds even when the database does not.
 */
export async function claimClaimGapDay(hit: ClaimGap, conversationId?: string | null, day: string = today()): Promise<boolean> {
  return reserveDay(
    claimKey(day),
    { kind: "match", contradictionId: hit.id, category: hit.category, similarity: hit.similarity, conversationId: conversationId ?? null },
    CLAIM_GAP_TOPIC_COOLDOWN_DAYS + 1,
    "claimClaimGapDay",
  );
}

/** Prompt block for a claim-vs-record hit. The row text is model-written, so it is fenced. */
export function buildClaimGapBlock(hit: ClaimGap, todayEt: string = today()): string {
  // Both days are ET calendar dates (the row's stored `date` and the shop clock's today), so a
  // row written at 10 pm ET is not reported as recorded the next day.
  const dayNum = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400_000;
  const recorded = hit.date;
  const ageDays = Math.max(0, Math.round(dayNum(todayEt) - dayNum(recorded)));
  return [
    "# CLAIM VS RECORD",
    fenceContent(
      "claimGap",
      "memory_recall",
      [
        `Recorded ${recorded} (${ageDays} day${ageDays === 1 ? "" : "s"} ago); any "last N days" below counts back from then.`,
        ...claimLines(hit),
        `The record shows: "${hit.reality}"`,
        `The gap: "${hit.gap}"`,
      ].join("\n"),
    ),
    "",
    ...claimProvenanceLines(hit),
    "Answer his actual question first. Only if this gap bears on what he is asking, add ONE",
    "closing line that names the gap in plain words, says how old the record is when it is",
    "more than a few days, and offers three answers: the record is right (the claim was wrong),",
    "the claim is outdated (things moved on), or ignore it. No lecture, and do not raise it",
    "again in this conversation.",
    ...claimGapResolveLines(hit.id),
  ].join("\n");
}

/** How Nick closes a table row once Nour picks an answer. One owner: lib/services/contradictions.ts. */
function claimGapResolveLines(id: string): string[] {
  return [
    "If he picks one, call the resolveContradiction tool with",
    `contradictionKey "tbl:${id}" and side "current_wins" for the record is right, "old_wins"`,
    'for outdated, "dismissed" for ignore. If he says the record is wrong (something is not',
    "being logged), believe him, say what would have to be logged, and close it as ignore.",
    "Any other reply leaves it open. Give it no [brain:...] citation tag; name the record's",
    "date instead (the row is also on /brain, Memory tab, Contradictions).",
  ];
}

// ── One open contradiction a day (2026-10-23, NICK_DAILY_CONTRADICTION) ──
// The claim gap above fires only when a row matches the turn, so most open rows
// are never seen before the 30-day auto-expiry. On the first chat turn of an ET
// day with no claim-gap hit, Nick asks the most severe, oldest open row as one
// question. Same two steps: findDailyContradiction only READS; the caller claims
// the day with claimDailyContradiction once it knows the block will be used.

/**
 * Open rows read for the pick (76 open on 2026-10-22; the writer adds at most 4 a night
 * and memory-consolidation closes them at 30 days, so ~120 is the ceiling).
 * shortcut: the pick sees the 500 oldest open rows; past 500 open, page it.
 */
const DAILY_FETCH = 500;
/** Claims the follow-up reads: one per day, alive for at most DAILY_CLAIM_TTL_DAYS. */
const FOLLOW_UP_CLAIMS = 30;
/** The claim row is the kill-criterion receipt (asked row ids): keep it past the 2-week read. */
const DAILY_CLAIM_TTL_DAYS = 21;
// The thinking engine writes mild|moderate|severe|critical (thinking-engine.ts prompt); anything else ranks last.
const SEVERITY_RANK: Record<string, number> = { critical: 4, severe: 3, moderate: 2, mild: 1 };

export type DailyContradiction = Omit<ClaimGap, "similarity"> & { severity: string };

/** Most severe first, then oldest. Pure, so the ordering is pinned by a test. */
export function pickDailyContradiction<T extends { severity: string; createdAt: Date }>(rows: T[]): T | null {
  // An off-vocabulary severity is the writer's own default ("moderate", thinking-engine.ts), not "below mild".
  const rank = (s: string) => SEVERITY_RANK[s.toLowerCase()] ?? SEVERITY_RANK.moderate;
  return (
    [...rows].sort((a, b) => rank(b.severity) - rank(a.severity) || a.createdAt.getTime() - b.createdAt.getTime())[0] ??
    null
  );
}

const ROW_SELECT = {
  id: true, date: true, claim: true, reality: true, gap: true, category: true, severity: true, claimSource: true, createdAt: true,
} as const;

/**
 * Today's one open contradiction, or null while today's claim (daily question or
 * claim gap) holds the day: asked, or reserved and fresh (one a day, never two).
 * Read-only. Never throws.
 */
export async function findDailyContradiction(): Promise<DailyContradiction | null> {
  try {
    const claim = await prisma.brainMemory.findUnique({
      where: { category_key: { category: LOG_CATEGORY, key: claimKey() } },
      select: { content: true, lastSeen: true },
    });
    if (claim && claimHoldsDay(claim)) return null;
    // A row ASKED in the last week (by either lane) is not asked again: an unanswered critical
    // row would otherwise come back every morning, and the kill criterion would count one nag.
    const recent = await prisma.brainMemory.findMany({
      where: {
        category: LOG_CATEGORY,
        key: { startsWith: CLAIM_GAP_KEY_PREFIX },
        createdAt: { gte: new Date(Date.now() - CLAIM_GAP_TOPIC_COOLDOWN_DAYS * 86400_000) },
      },
      select: { content: true },
    });
    const askedIds = new Set(recent.filter((r) => isAsked(r.content)).map((r) => parseClaim(r.content).contradictionId));
    const rows = await prisma.contradiction.findMany({
      where: { resolved: false, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: DAILY_FETCH,
      select: ROW_SELECT,
    });
    return pickDailyContradiction(rows.filter((r) => !askedIds.has(r.id)));
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: "findDailyContradiction" });
    return null;
  }
}

/**
 * The row last ASKED in THIS conversation, while it is still open and its claim is
 * alive, so a later turn can resolve it (the ask block does not repeat). Keyed on the
 * conversation, not the calendar day: an answer after midnight, or after another
 * conversation took the new day, still finds it. Null for another conversation, a
 * reservation never delivered, a resolved row, no claim, or any failure. Read-only.
 */
export async function findClaimedContradictionFollowUp(conversationId?: string | null): Promise<DailyContradiction | null> {
  if (!conversationId) return null;
  try {
    const claims = await prisma.brainMemory.findMany({
      where: {
        category: LOG_CATEGORY,
        key: { startsWith: CLAIM_GAP_KEY_PREFIX },
        expiresAt: { gt: new Date() },
        createdAt: { gte: new Date(Date.now() - (DAILY_CLAIM_TTL_DAYS + 1) * 86400_000) },
      },
      orderBy: { createdAt: "desc" },
      take: FOLLOW_UP_CLAIMS,
      select: { key: true, content: true, lastSeen: true },
    });
    const mine = claims.find((c) => parseClaim(c.content).conversationId === conversationId && isAsked(c.content));
    const id = mine ? parseClaim(mine.content).contradictionId : undefined;
    if (typeof id !== "string") return null;
    return await prisma.contradiction.findFirst({
      where: { id, resolved: false, deletedAt: null },
      select: ROW_SELECT,
    });
  } catch (err) {
    logError("brain.contradiction-injector", err, { fn: "findClaimedContradictionFollowUp" });
    return null;
  }
}

/** Resolution-only context for the turns after the ask: the key and the answers, never a new question. */
export function buildContradictionFollowUpBlock(row: DailyContradiction): string {
  return [
    "# CONTRADICTION ASKED EARLIER",
    fenceContent(
      "contradictionFollowUp",
      "memory_recall",
      [...claimLines(row), `The record shows: "${row.reality}"`].join("\n"),
    ),
    "",
    ...claimProvenanceLines(row),
    "Earlier in this conversation you asked him about this gap. Do not ask it again. Only if his",
    "message answers it (the record is right, the claim is outdated, or ignore it) close it.",
    ...claimGapResolveLines(row.id),
  ].join("\n");
}

/**
 * Reserve today's daily question for `row` on the SAME unique key as claimClaimGapDay,
 * so the database lets exactly one of the two win. Any failed write returns false.
 */
export async function claimDailyContradiction(
  row: DailyContradiction,
  conversationId?: string | null,
  day: string = today(),
): Promise<boolean> {
  return reserveDay(
    claimKey(day),
    { kind: "daily", contradictionId: row.id, category: row.category, severity: row.severity, conversationId: conversationId ?? null },
    DAILY_CLAIM_TTL_DAYS,
    "claimDailyContradiction",
  );
}

/** Prompt block for the daily question. The row text is model-written, so it is fenced. */
export function buildDailyContradictionBlock(row: DailyContradiction, todayEt: string = today()): string {
  const dayNum = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400_000;
  const ageDays = Math.max(0, Math.round(dayNum(todayEt) - dayNum(row.date)));
  return [
    "# ONE OPEN CONTRADICTION",
    fenceContent(
      "dailyContradiction",
      "memory_recall",
      [
        `Recorded ${row.date} (${ageDays} day${ageDays === 1 ? "" : "s"} ago); any "last N days" below counts back from then.`,
        ...claimLines(row),
        `The record shows: "${row.reality}"`,
        `The gap: "${row.gap}"`,
      ].join("\n"),
    ),
    "",
    ...claimProvenanceLines(row),
    "This is today's one open claim-vs-record question. Answer his message first. Then end with",
    "ONE short question that names the gap in plain words and offers three answers: the record",
    "is right (the claim was wrong), the claim is outdated (things moved on), or ignore it. Ask",
    "it once; do not repeat it later today.",
    ...claimGapResolveLines(row.id),
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
