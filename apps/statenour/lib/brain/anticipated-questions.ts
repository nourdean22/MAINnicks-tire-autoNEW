/**
 * Anticipated-Question Feed · v10.0.526 · Arc B Feature 6
 *
 * Daily prediction of the 3 questions the operator is most likely to
 * ask tomorrow, with answers precomputed in the background. When the
 * operator asks one, the chat route surfaces the cached take as a
 * system-prompt addendum so Nick can answer instantly with the
 * already-warm context.
 *
 * Pipeline (folded into mega-evening · runs nightly):
 *   1. gatherSignals(7) · pulls last-7d chat user-turns + decisions +
 *      commitments + open loops · the "what's-on-his-mind" surface
 *   2. draftAnticipatedQuestions(signals) · single aiChat call (factual
 *      task · cheap) returns 3 short questions
 *   3. precomputeAnswers(questions) · one NO-tools "reason" call per
 *      question (10s budget each, parallel) drafting a take that never
 *      asserts live numbers or claims actions — TRUTH-RULE compatible
 *      by construction (2026-06-10: built; the original "in-process
 *      chat pipeline" design was never implemented)
 *   4. storeAnticipated(...) · upsert BrainMemory(category=
 *      "anticipated_question", key="anticipated_YYYY-MM-DD") · NO new
 *      table, the no-duplicate-data rule
 *
 * Match-at-ask-time (2026-06-10: built — was doc-only before):
 *   · findAnticipated(query, userEmbedding?) · cosine vs today's set
 *     (yesterday-fallback: the EVENING fan-out keys the row to the
 *     ending day) · >= 0.85 returns the cached answer + freshness.
 *   · brain-context injects the take as a reranked block · DOES NOT
 *     short-circuit · the operator's exact phrasing always drives the
 *     final response (per the spec).
 *
 * Cost · 1 draft call (factual, ~$0.001) + 3 no-tools reason calls
 * nightly · the chat hot path adds ZERO embedding calls (reuses the
 * route's prefetch embedding; question vectors cached per day).
 *
 * Skill stances applied: production-code-audit (no shadow tables,
 * surgical fold into existing cron), kaizen (smallest change that
 * solves the goal), karpathy-guidelines (verifiable goal · "operator
 * asks X tomorrow, answer is already in context"), prompt-engineering
 * (factual task profile + tight question-shape constraints),
 * database-architect (extend BrainMemory · idempotent per-day key).
 */

import { prisma } from "@/lib/prisma";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { getEmbedding } from "@/lib/ai/provider";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/anticipated-questions");

const aiChat = makeTracedAiChat("anticipate-questions", "cron");

// ── Tunables ─────────────────────────────────────────────────────

/** Default lookback window for signal gathering. */
const DEFAULT_SIGNAL_DAYS = 7;

/** Number of questions to draft per day. */
const QUESTION_COUNT = 3;

/** Cap on signal-input size to keep the draft call cheap. */
const MAX_CHAT_SIGNALS = 50;
const MAX_DECISION_SIGNALS = 20;
const MAX_COMMITMENT_SIGNALS = 15;
const MAX_OPEN_LOOP_SIGNALS = 15;

/** Match-time cache TTL · today's anticipated set rarely changes mid-day. */
const TODAY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Types ────────────────────────────────────────────────────────

export interface Signal {
  kind: "chat" | "decision" | "commitment" | "open_loop";
  text: string;
  /** ISO date · used by the draft prompt for "recent vs older" framing. */
  createdAt: string;
}

export interface GatheredSignals {
  chats: Signal[];
  decisions: Signal[];
  commitments: Signal[];
  openLoops: Signal[];
  /** Total signal count · 0 means cold-start, skip the draft call. */
  total: number;
}

export interface AnticipatedQuestion {
  question: string;
  /** Best-effort topic line · helps the chat route show a context hint. */
  topic: string | null;
  /**
   * v10.0.529.40 · model self-confidence in this prediction · [0, 1].
   * Defaults to 1.0 when absent (legacy rows · pre-confidence drafts).
   * Filters at draft time drop anything < MIN_CONFIDENCE so weak
   * picks don't pollute the operator's tile.
   */
  confidence?: number;
}

/** Confidence floor · questions scoring below this get dropped at draft time. */
export const MIN_CONFIDENCE = 0.3;

export interface AnticipatedSet {
  /** YYYY-MM-DD · the date this set covers (today). */
  date: string;
  /** ISO timestamp the set was built · used for freshness checks. */
  builtAt: string;
  questions: AnticipatedQuestion[];
  /** Per-question precomputed answer · null when precompute failed. */
  answers: Array<string | null>;
}

// ── 1. Signal gathering ──────────────────────────────────────────

/**
 * Pull the last `days` of operator signals. Each lane is a separate
 * query · they're cheap (each capped) and parallelizable. The shape
 * is `Signal[]` so downstream prompts treat lanes uniformly.
 */
export async function gatherSignals(
  days: number = DEFAULT_SIGNAL_DAYS,
): Promise<GatheredSignals> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [chats, decisions, commitments, tasks] = await Promise.all([
    // User chat turns · most recent first, capped at 50.
    prisma.chatMessage
      .findMany({
        where: { role: "user", createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: MAX_CHAT_SIGNALS,
        select: { content: true, createdAt: true },
      })
      .catch((err): never[] => {
        log.warn("gather_chat_failed", { err: errMsg(err) });
        return [];
      }),
    // Decisions · use most recent first by date string.
    prisma.masteryDecision
      .findMany({
        where: { date: { gte: since.toISOString().slice(0, 10) } },
        orderBy: { date: "desc" },
        take: MAX_DECISION_SIGNALS,
        select: { title: true, chosen: true, context: true, date: true },
      })
      .catch((err): never[] => {
        log.warn("gather_decisions_failed", { err: errMsg(err) });
        return [];
      }),
    // Active commitments · prioritize aging ones (oldest first).
    prisma.commitment
      .findMany({
        where: { status: { in: ["active", "in_progress", "broken"] } },
        orderBy: { dateMade: "desc" },
        take: MAX_COMMITMENT_SIGNALS,
        select: { description: true, deadline: true, status: true, dateMade: true },
      })
      .catch((err): never[] => {
        log.warn("gather_commitments_failed", { err: errMsg(err) });
        return [];
      }),
    // Open loops · overdue/stale tasks in INBOX/READY/DOING.
    prisma.task
      .findMany({
        where: {
          status: { in: ["INBOX", "READY", "DOING"] },
          deletedAt: null,
        },
        orderBy: [{ autoPriority: "desc" }, { createdAt: "asc" }],
        take: MAX_OPEN_LOOP_SIGNALS,
        select: { title: true, nextPhysicalAction: true, createdAt: true },
      })
      .catch((err): never[] => {
        log.warn("gather_tasks_failed", { err: errMsg(err) });
        return [];
      }),
  ]);

  const chatSignals: Signal[] = chats
    .map((c) => ({
      kind: "chat" as const,
      text: (c.content ?? "").trim().slice(0, 400),
      createdAt: c.createdAt.toISOString(),
    }))
    .filter((s) => s.text.length > 0);

  const decisionSignals: Signal[] = decisions.map((d) => ({
    kind: "decision" as const,
    text: [d.title, d.chosen, d.context]
      .filter(Boolean)
      .map((s) => (s as string).trim())
      .join(" · ")
      .slice(0, 400),
    createdAt: d.date,
  }));

  const commitmentSignals: Signal[] = commitments.map((c) => ({
    kind: "commitment" as const,
    text: `[${c.status}] ${c.description.slice(0, 200)}${c.deadline ? ` (due ${c.deadline})` : ""}`,
    createdAt: c.dateMade,
  }));

  const openLoopSignals: Signal[] = tasks.map((t) => ({
    kind: "open_loop" as const,
    text: t.nextPhysicalAction
      ? `${t.title} → ${t.nextPhysicalAction}`.slice(0, 300)
      : t.title.slice(0, 300),
    createdAt: t.createdAt.toISOString(),
  }));

  const total =
    chatSignals.length +
    decisionSignals.length +
    commitmentSignals.length +
    openLoopSignals.length;

  return {
    chats: chatSignals,
    decisions: decisionSignals,
    commitments: commitmentSignals,
    openLoops: openLoopSignals,
    total,
  };
}

// ── 2. Question drafting ─────────────────────────────────────────

/**
 * Single LLM call that turns gathered signals into 3 short questions.
 * Returns [] when the model fails / response is unparseable · caller
 * decides whether to bail or fall back.
 *
 * The prompt enforces:
 *   · 3 questions max
 *   · under 12 words each
 *   · forward-looking ("tomorrow") · NOT a recap of today
 *   · distinct topics · no near-duplicates
 */
export async function draftAnticipatedQuestions(
  signals: GatheredSignals,
): Promise<AnticipatedQuestion[]> {
  if (signals.total === 0) return [];

  const lines: string[] = [];
  if (signals.chats.length > 0) {
    lines.push("RECENT CHAT TURNS (most-recent first):");
    for (const c of signals.chats.slice(0, 20)) {
      lines.push(`- ${c.text}`);
    }
  }
  if (signals.decisions.length > 0) {
    lines.push("\nRECENT DECISIONS:");
    for (const d of signals.decisions.slice(0, 10)) {
      lines.push(`- ${d.text}`);
    }
  }
  if (signals.commitments.length > 0) {
    lines.push("\nACTIVE COMMITMENTS:");
    for (const c of signals.commitments.slice(0, 10)) {
      lines.push(`- ${c.text}`);
    }
  }
  if (signals.openLoops.length > 0) {
    lines.push("\nOPEN LOOPS:");
    for (const t of signals.openLoops.slice(0, 10)) {
      lines.push(`- ${t.text}`);
    }
  }

  const corpus = lines.join("\n").slice(0, 6000);

  const system = `You are the operator's pattern-recognizer. Given the last 7 days of his chat turns, decisions, commitments, and open loops, predict the 3 questions he is MOST LIKELY to ask TOMORROW.

Rules · non-negotiable:
1. Return ONLY a JSON array of exactly ${QUESTION_COUNT} objects. No prose, no markdown fences, no commentary.
2. Each object shape: { "question": string, "topic": string, "confidence": number }
3. "question" must be SHORT — under 12 words — and phrased as the operator would phrase it (terse, direct, no fluff).
4. "topic" is a 1-3 word tag that names the topic (e.g. "ALG declined work", "VAPI tuning", "cohort summary").
5. "confidence" is YOUR self-assessed probability (0.0 to 1.0) that the operator actually asks this question tomorrow. Be HONEST · low scores (0.2-0.4) for weak signals, high (0.7+) only for strong corpus alignment. Calibration matters · don't inflate.
6. Questions must be FORWARD-LOOKING. Avoid recapping today — predict what fresh thing he'll want to check or push on next.
7. Topics must be DISTINCT. No two questions covering the same subject.
8. Anchor on concrete signals from the corpus. No generic "how can I improve?" filler.`;

  const user = `CORPUS (operator signals last 7d):\n\n${corpus}\n\nReturn exactly ${QUESTION_COUNT} predicted questions as JSON array.`;

  try {
    // task profile: "extract" · we're structurally extracting predicted
    // questions from a signal corpus · routes to the structured-output
    // model tier per ai-policy.md (cheap + JSON-stable).
    const result = await aiChat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      "extract",
    );
    if (!result.content || result.content.trim().length === 0) {
      log.warn("draft_empty_content");
      return [];
    }
    const parsed = extractJsonArray<unknown>(result.content);
    if (!parsed.ok) {
      log.warn("draft_parse_failed", { contentLen: result.content.length });
      return [];
    }
    const out: AnticipatedQuestion[] = [];
    const seenTopics = new Set<string>();
    let droppedLowConfidence = 0;
    for (const raw of parsed.value) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as Record<string, unknown>;
      const q = typeof obj.question === "string" ? obj.question.trim() : "";
      const t = typeof obj.topic === "string" ? obj.topic.trim() : null;
      if (q.length < 5 || q.length > 200) continue;
      // v529.40 · confidence parse + filter. The model is asked to
      // self-rate calibration (0..1) · low scores (< 0.3) get dropped
      // before reaching the operator's tile. Defaults to 1.0 when
      // missing (old prompts didn't ask · we treat absence as
      // implicit-high so we don't crash on a legacy response shape).
      const cRaw = obj.confidence;
      const c = typeof cRaw === "number" && Number.isFinite(cRaw)
        ? Math.max(0, Math.min(1, cRaw))
        : 1;
      if (c < MIN_CONFIDENCE) {
        droppedLowConfidence++;
        continue;
      }
      // Topic-level dedup · prevents two "ALG" questions sneaking in.
      const topicKey = (t ?? q).toLowerCase();
      if (seenTopics.has(topicKey)) continue;
      seenTopics.add(topicKey);
      out.push({ question: q, topic: t, confidence: c });
      if (out.length >= QUESTION_COUNT) break;
    }
    // v529.40 · sort by confidence desc · the strongest picks lead
    // so the operator sees high-signal items first if we ever cap
    // display to fewer than QUESTION_COUNT.
    out.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    if (droppedLowConfidence > 0) {
      log.info("draft_low_confidence_filtered", {
        kept: out.length,
        dropped: droppedLowConfidence,
      });
    }
    return out;
  } catch (err) {
    log.warn("draft_threw", { err: errMsg(err) });
    return [];
  }
}

// ── 3. Answer precompute ─────────────────────────────────────────

/** Per-question budget · keeps the cron's 60s ceiling safe (3 x 10s worst case). */
const PRECOMPUTE_TIMEOUT_MS = 10_000;

/** Cap stored answers · they ride BrainMemory metadata JSON + the chat prompt. */
const MAX_ANSWER_CHARS = 1200;

/**
 * The take is drafted at night WITHOUT tools or live data — the system
 * prompt forbids asserting live numbers or claiming checks, so the
 * cached answer can be injected tomorrow without violating the chat
 * TRUTH RULE (it's framing/strategy, never a fact-claim).
 */
const PRECOMPUTE_SYSTEM = `You are Nick, Nour's operator, drafting a take TONIGHT so it's warm if he asks this question TOMORROW.
You have NO tools and NO live data in this draft. Rules:
1. Give the framing, the strategy, and concrete next moves — the thinking, not the lookup.
2. NEVER assert a specific live number (revenue, counts, streaks, prices). Say what to check and where instead.
3. NEVER claim an action was taken or a check was performed.
4. Under 120 words. Terse operator voice.`;

/**
 * Precompute a draft answer per question. Degrades per-question to
 * null on timeout/failure — the caller stores nulls and downstream
 * surfaces (morning brief, chat match) skip them.
 */
export async function precomputeAnswers(
  questions: AnticipatedQuestion[],
): Promise<Array<string | null>> {
  if (questions.length === 0) return [];
  return Promise.all(
    questions.map(async (q) => {
      try {
        const result = await Promise.race([
          aiChat(
            [
              { role: "system", content: PRECOMPUTE_SYSTEM },
              { role: "user", content: q.question },
            ],
            "reason",
          ),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), PRECOMPUTE_TIMEOUT_MS),
          ),
        ]);
        // aiChat NEVER throws on total provider-chain failure — it
        // returns an "I'm having trouble connecting…" sentinel with
        // provider "emergency"/"none" (lib/ai/provider.ts). Without
        // this check the sentinel would be stored as the question's
        // answer and injected into next-day chat as a "draft take".
        if (!result || result.provider === "emergency" || result.provider === "none") {
          return null;
        }
        const text = typeof result.content === "string" ? result.content.trim() : "";
        return text.length > 0 ? text.slice(0, MAX_ANSWER_CHARS) : null;
      } catch (err) {
        log.warn("precompute_failed", {
          question: q.question.slice(0, 80),
          err: errMsg(err),
        });
        return null;
      }
    }),
  );
}

// ── 4. Storage (BrainMemory upsert · no new table) ──────────────

/**
 * Today's date in America/New_York · matches the morning-brief key
 * convention so freshness reasoning lines up across the two pipelines.
 */
export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

/**
 * Upsert today's anticipated-question set. The key is per-day so a
 * second cron run on the same day overwrites · idempotent by design.
 */
export async function storeAnticipated(
  questions: AnticipatedQuestion[],
  answers: Array<string | null>,
  opts: { date?: string } = {},
): Promise<AnticipatedSet> {
  const date = opts.date ?? todayKey();
  const set: AnticipatedSet = {
    date,
    builtAt: new Date().toISOString(),
    questions,
    answers,
  };

  // Content is a human-readable summary so the morning brief can pull
  // it directly without re-parsing the metadata. Metadata holds the
  // structured payload for findAnticipated.
  const content = questions
    .map((q, i) => `${i + 1}. ${q.question}${q.topic ? ` [${q.topic}]` : ""}`)
    .join("\n");

  const key = `anticipated_${date}`;
  await prisma.brainMemory.upsert({
    where: { category_key: { category: "anticipated_question", key } },
    update: {
      content,
      confidence: questions.length > 0 ? 0.8 : 0.3,
      source: "cron:anticipate",
      metadata: set as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["create"]["metadata"],
      // updatedAt auto-bumps; lastSeen we touch manually so freshness
      // checks via lastSeen also see the latest write.
      lastSeen: new Date(),
    },
    create: {
      category: "anticipated_question",
      key,
      content,
      confidence: questions.length > 0 ? 0.8 : 0.3,
      source: "cron:anticipate",
      metadata: set as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["create"]["metadata"],
    },
  });

  return set;
}

// ── 5. Match-at-ask-time (cosine over today's set) ───────────────

let todayCache: { date: string; set: AnticipatedSet | null; at: number } | null =
  null;

/**
 * Load today's anticipated set (or yesterday's if today's not built
 * yet) · cached 5min · returns null when nothing's stored.
 */
/** Yesterday's date in America/New_York · the evening-build fallback key. */
export function yesterdayKey(): string {
  return new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

async function fetchSetByKey(key: string): Promise<AnticipatedSet | null> {
  const row = await prisma.brainMemory
    .findUnique({
      where: {
        category_key: { category: "anticipated_question", key },
      },
      select: { metadata: true, updatedAt: true },
    })
    .catch((err) => {
      log.warn("loadToday_failed", { key, err: errMsg(err) });
      return null as { metadata: unknown; updatedAt: Date } | null;
    });
  if (!row || !row.metadata) return null;
  const meta = row.metadata as unknown as AnticipatedSet;
  if (Array.isArray(meta.questions) && Array.isArray(meta.answers)) {
    return meta;
  }
  return null;
}

async function loadTodaysSet(): Promise<AnticipatedSet | null> {
  const date = todayKey();
  if (
    todayCache &&
    todayCache.date === date &&
    Date.now() - todayCache.at < TODAY_CACHE_TTL_MS
  ) {
    return todayCache.set;
  }

  // 2026-06-10 · yesterday-fallback — this function's contract promised
  // it from day one but it was never implemented, and it is LOAD-BEARING:
  // the anticipate cron runs inside the mega-EVENING fan-out (0 3 * * *
  // UTC ≈ 10-11pm ET, BEFORE midnight ET), so the set lands under the
  // ENDING day's key. Every next-morning read (morning brief, proactive
  // pushes, chat match) computed the NEW day's key and silently got
  // null — the feature wrote rows nobody could read. The fallback is
  // bounded to exactly one day; an older set stays honestly absent.
  const set =
    (await fetchSetByKey(`anticipated_${date}`)) ??
    (await fetchSetByKey(`anticipated_${yesterdayKey()}`));

  todayCache = { date, set, at: Date.now() };
  return set;
}

/**
 * Read-only accessor for today's set · used by the system endpoint
 * + morning brief without forcing them through findAnticipated's
 * cosine flow.
 */
export async function getTodaysAnticipated(): Promise<AnticipatedSet | null> {
  return loadTodaysSet();
}

/** Test seam · clear the 5min cache between unit tests. */
export function _resetTodayCacheForTests(): void {
  todayCache = null;
}

// ── 6. findAnticipated · cosine match at ask time ────────────────
//
// The module doc promised this from day one ("the chat route surfaces
// the cached take as a system-prompt addendum") but it was never
// built — the chat route had zero callers (evolution audit 2026-06-10).
// Contract per the original spec: similarity above the 0.85 floor
// returns the cached answer; the chat route injects it as CONTEXT and
// never short-circuits the live response.

/** Conservative match floor — a false-positive injection pollutes the turn. */
export const ANTICIPATED_MATCH_FLOOR = 0.85;

export interface AnticipatedMatch {
  question: string;
  topic: string | null;
  answer: string;
  similarity: number;
  /** ISO timestamp the set was built · drives the freshness framing. */
  builtAt: string;
  /** YYYY-MM-DD the set covers. */
  date: string;
}

/**
 * Per-build cache of the 3 question embeddings · 3 embed calls once
 * per build per process. Keyed by date+builtAt (not date alone) so a
 * same-day manual cron re-run past the 6h skip window — which rewrites
 * the questions — can't pair stale vectors with the new questions.
 */
let questionEmbedCache: { buildKey: string; vectors: Array<number[] | null> } | null = null;

async function questionVectors(set: AnticipatedSet): Promise<Array<number[] | null>> {
  const buildKey = `${set.date}|${set.builtAt}`;
  if (questionEmbedCache && questionEmbedCache.buildKey === buildKey) {
    return questionEmbedCache.vectors;
  }
  const vectors = await Promise.all(
    set.questions.map(async (q) => {
      try {
        const v = await getEmbedding(q.question);
        return Array.isArray(v) && v.length > 0 ? v : null;
      } catch {
        return null;
      }
    }),
  );
  questionEmbedCache = { buildKey, vectors };
  return vectors;
}

/**
 * Match the operator's message against today's anticipated set.
 * Returns the best match at/above the cosine floor that has a
 * precomputed answer, else null. Accepts the chat route's
 * already-computed user embedding so the hot path adds ZERO
 * embedding calls; embeds the message itself only when absent
 * (cron/test callers).
 */
export async function findAnticipated(
  userMessage: string,
  userEmbedding?: number[],
): Promise<AnticipatedMatch | null> {
  if (!userMessage || userMessage.trim().length < 5) return null;
  const set = await loadTodaysSet();
  if (!set || set.questions.length === 0) return null;
  // Matching is only worth an embed when at least one answer exists.
  const hasAnswer = (set.answers ?? []).some(
    (a) => typeof a === "string" && a.length > 0,
  );
  if (!hasAnswer) return null;

  let msgVec = userEmbedding ?? [];
  if (msgVec.length === 0) {
    try {
      msgVec = await getEmbedding(userMessage);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(msgVec) || msgVec.length === 0) return null;

  const vectors = await questionVectors(set);
  let best: AnticipatedMatch | null = null;
  for (let i = 0; i < set.questions.length; i++) {
    const answer = set.answers?.[i];
    if (typeof answer !== "string" || answer.length === 0) continue;
    const qVec = vectors[i];
    if (!qVec) continue;
    const sim = cosineSimilarity(msgVec, qVec);
    if (sim < ANTICIPATED_MATCH_FLOOR) continue;
    if (!best || sim > best.similarity) {
      best = {
        question: set.questions[i].question,
        topic: set.questions[i].topic,
        answer,
        similarity: sim,
        builtAt: set.builtAt,
        date: set.date,
      };
    }
  }
  return best;
}

/**
 * Chat-context block · "" when no match (same contract as every other
 * brain block, so brain-context can append it blindly). The framing
 * keeps the TRUTH RULE intact: the take was drafted last night WITHOUT
 * tools, so the model is told to verify volatile facts live and never
 * claim a check already happened.
 */
export async function buildAnticipatedContextBlock(
  userMessage: string,
  userEmbedding?: number[],
): Promise<string> {
  const match = await findAnticipated(userMessage, userEmbedding).catch(() => null);
  if (!match) return "";
  return [
    `### ANTICIPATED QUESTION (precomputed ${match.date} · match ${match.similarity.toFixed(2)})`,
    `You predicted Nour would ask: "${match.question}"${match.topic ? ` [${match.topic}]` : ""}`,
    `Draft take from last night (drafted with NO tools — verify any live number with tools before asserting it; never claim you already checked something this turn):`,
    match.answer,
  ].join("\n");
}

/** Test seam · clear the per-day question-embedding cache. */
export function _resetAnticipatedMatchCacheForTests(): void {
  questionEmbedCache = null;
}

// ── helpers ──────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
}
