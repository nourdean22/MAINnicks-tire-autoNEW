/**
 * Contradiction injector: the claim-vs-record lanes of the chat turn.
 *
 * The `contradictions` TABLE ("he said X, the record shows Y", written by the
 * nightly thinking engine) is the one store. This module reads its open rows
 * into a turn (claim gap, daily question, follow-up) and owns the once-a-day
 * claim row (BrainMemory category "contradiction_injection_log") that keeps
 * the question to one a day. The old BrainMemory contradiction path (a
 * detector, an alert block, a memory-pair resolver) never held a row and is gone.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { getEmbeddingWithModel, type EmbeddingResult } from "@/lib/ai/provider";
import { cosineSimilarity } from "./embedding-utils";
import { logError } from "@/lib/utils/error-log";
import { today } from "@/lib/utils/datetime";

// ── Claim vs record (2026-10-22) ───────────────────────────────────
// The nightly thinking engine (lib/brain/thinking-engine.ts, L7) writes
// "he said X, the record shows Y" rows to the `contradictions` TABLE. When this was written the table had 76 open
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
  /** This turn's reservation id: a later turn's takeover of the same row carries a different one. */
  token: string;
}

export function claimKey(day: string = today()): string {
  return `${CLAIM_GAP_KEY_PREFIX}${day}`;
}

function parseClaim(content: string): {
  state?: string;
  contradictionId?: unknown;
  conversationId?: unknown;
  category?: unknown;
  token?: unknown;
} {
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

/** The three answer choices, in the order the blocks print them. */
const CONTRADICTION_CHOICES = ["record is right", "outdated", "ignore"] as const;
/** The fixed ending both blocks tell Nick to use; the promotion check looks for exactly these choices. */
export const CONTRADICTION_QUESTION_SHAPE = `${CONTRADICTION_CHOICES[0]}, ${CONTRADICTION_CHOICES[1]}, or ${CONTRADICTION_CHOICES[2]}?`;

/**
 * Did the stored reply actually ask the contradiction question? All three choices
 * (case-insensitive) plus a question mark. Any other "?" ("Want me to draft that?")
 * does not count. Pure, so it is tested without Prisma.
 */
export function replyCarriesContradictionQuestion(replyText: string): boolean {
  const t = replyText.toLowerCase();
  return t.includes("?") && CONTRADICTION_CHOICES.every((c) => t.includes(c));
}

/**
 * Promote this turn's reservation to the "asked" receipt, after the reply was
 * persisted. Only when the stored reply carries the contradiction question, and
 * only while the row is still this turn's reservation (CAS on the exact content read).
 */
export async function markContradictionAsked(claim: ContradictionClaim, messageId: string, replyText: string): Promise<boolean> {
  if (!replyCarriesContradictionQuestion(replyText)) return false;
  try {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: LOG_CATEGORY, key: claim.key } },
      select: { content: true, lastSeen: true },
    });
    if (!row) return false;
    const parsed = parseClaim(row.content);
    // The token, not the row id: a late turn must not promote a later turn's reservation of the same row.
    if (parsed.state !== "reserved" || parsed.token !== claim.token) return false;
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
export async function claimClaimGapDay(
  hit: ClaimGap,
  conversationId?: string | null,
  day: string = today(),
  token: string = randomUUID(),
): Promise<boolean> {
  return reserveDay(
    claimKey(day),
    { kind: "match", contradictionId: hit.id, category: hit.category, similarity: hit.similarity, conversationId: conversationId ?? null, token },
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
    "the claim is outdated (things moved on), or ignore it. End that line with exactly",
    `"${CONTRADICTION_QUESTION_SHAPE}" so the answer choices are unmistakable. No lecture, and`,
    "do not raise it again in this conversation.",
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
    // Every row this conversation was asked, newest first: a resolved newest one must not hide an
    // older one that is still open.
    const ids = claims
      .filter((c) => parseClaim(c.content).conversationId === conversationId && isAsked(c.content))
      .map((c) => parseClaim(c.content).contradictionId)
      .filter((id): id is string => typeof id === "string");
    if (ids.length === 0) return null;
    const open = await prisma.contradiction.findMany({
      where: { id: { in: ids }, resolved: false, deletedAt: null },
      select: ROW_SELECT,
    });
    return ids.map((id) => open.find((r) => r.id === id)).find((r) => r) ?? null;
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
  token: string = randomUUID(),
): Promise<boolean> {
  return reserveDay(
    claimKey(day),
    { kind: "daily", contradictionId: row.id, category: row.category, severity: row.severity, conversationId: conversationId ?? null, token },
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
    "is right (the claim was wrong), the claim is outdated (things moved on), or ignore it. End",
    `the question with exactly "${CONTRADICTION_QUESTION_SHAPE}". Ask it once; do not repeat it later today.`,
    ...claimGapResolveLines(row.id),
  ].join("\n");
}
