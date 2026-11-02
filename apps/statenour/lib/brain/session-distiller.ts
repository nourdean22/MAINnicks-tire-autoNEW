/**
 * Session Distiller — at the end of each chat, fold the exchange into
 * a single "what Nour learned / decided / surfaced" summary and
 * persist it as a BrainMemory row. Apr 18.
 *
 * The bet: raw ChatMessage is great for verbatim recall but terrible
 * for quick "what have I been working on" context. Distilled summaries
 * are 1/50th the volume and 10× the retrieval usefulness. Nick reads
 * the distills in future system prompts — they become the lived memory
 * of past sessions.
 *
 * Trigger logic:
 *   • Any conversation that has ≥ 4 messages AND
 *   • has been idle ≥ 30 minutes (no new message) AND
 *   • has no existing distill OR the latest message is newer than
 *     the distill's updatedAt (session continued after last distill)
 *   • Caps at 10 conversations per run so we don't hammer the AI API.
 *
 * Distill shape — stored as BrainMemory (category="chat_summary",
 * key=<conversationId>):
 *   {
 *     conversationId,
 *     messageCount,
 *     timespanHours,
 *     firstAt, lastAt,
 *     summary: 2-4 sentences,
 *     decisions: string[],
 *     commitments: string[],
 *     questions_still_open: string[],
 *     emotional_tone: string,     // "frustrated / energized / steady / ..."
 *     next_follow_up: string | null,
 *   }
 *
 * The output is vector-embedded into VectorEmbedding (sourceType =
 * "brain_memory") by the nightly embed-backfill cron, so distills
 * become discoverable via contextual-recall.
 */

import { prisma } from "@/lib/prisma";
import { admitMemory } from "@/lib/brain/memory-admission";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
// 90 s, not the fast lane's 45 s: 37 of 70 calls aborted AT 45.0 s and ok p99 was 44.5 s (Langfuse, 7 d to
// 2026-11-01). Runs only in the 05:00Z off-peak phase (mega-fanout megaBrainOffpeak), never in a chat turn.
const aiChat = makeTracedAiChat("session-distiller", "brain", { timeoutMs: 90_000 });
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// v10.0.35 — structured logger; the v10.0.21 sweep missed this file.
const log = rootLogger.withSurface("brain/session-distiller");

export interface SessionDistill {
  conversationId: string;
  messageCount: number;
  timespanHours: number;
  firstAt: string;
  lastAt: string;
  summary: string;
  decisions: string[];
  commitments: string[];
  questions_still_open: string[];
  emotional_tone: string;
  next_follow_up: string | null;
}

interface ConversationSnapshot {
  id: string;
  title: string | null;
  messages: Array<{ role: string; content: string; createdAt: Date }>;
}

/** A chat idle longer than this is backlog: served after recent chats, and kept out of current concerns. */
const RECENT_MS = 30 * 86400_000;
const CONCERNS_MAX_AGE_MS = 14 * 86400_000;

/**
 * Find conversations eligible for distillation: a queue, not a window. Returns up to `limit`
 * ids, chats idle within the last 30 days first, then the older backlog, oldest first in each.
 *
 * 2026-10-30 (brain backfill W1): this used to read only chats touched in the last 30 days and
 * never archived ones. The cron was down 05-28..08-06, so 107 chats from May 5 - Jul 13 aged out
 * before it came back and could never be distilled. Any undistilled chat is now reachable,
 * archived ones included; an archived chat with a live distill is done.
 */
export async function findEligibleConversations(limit = 10): Promise<string[]> {
  const idleCutoff = new Date(Date.now() - 30 * 60_000);

  // shortcut: scans every idle conversation (381 on 2026-10-30, ~50 a month); move the
  // anti-join into SQL if this passes ~10k rows.
  const candidates = await prisma.chatConversation.findMany({
    where: { updatedAt: { lt: idleCutoff } },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      updatedAt: true,
      archivedAt: true,
      _count: { select: { messages: true } },
    },
  });

  const withEnough = candidates.filter((c) => c._count.messages >= 4);
  if (withEnough.length === 0) return [];

  // Every chat_summary row counts, soft-deleted ones included. A tombstone is not a gap: remember()
  // reinforces a deleted row without reviving it, so "redistilling" it wrote into the trash and the
  // same chats came back every night (PR 3379 review). Someone's delete stands, as in conversation-memory.
  const ids = withEnough.map((c) => c.id);
  const existing = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.CHAT_SUMMARY, key: { in: ids } },
    select: { key: true, updatedAt: true, deletedAt: true },
  });
  const distilled = new Map(existing.map((e) => [e.key, e]));
  const parked = await parkedConversations(ids);

  const recentFrom = Date.now() - RECENT_MS;
  const isRecent = (c: { updatedAt: Date }) => c.updatedAt.getTime() > recentFrom;
  const due = withEnough.filter((c) => {
    if (parked.has(c.id)) return false;
    const row = distilled.get(c.id);
    if (!row) return true;
    if (row.deletedAt) return false;
    // Redistill after new activity only for a recent, unarchived chat. A backlog chat that already has
    // a distill is done: an updated_at bump from a later writer is not a new conversation.
    return !c.archivedAt && isRecent(c) && c.updatedAt.getTime() > row.updatedAt.getTime();
  });
  const recent = due.filter(isRecent);
  const backlog = due.filter((c) => !isRecent(c));
  return [...recent, ...backlog].slice(0, limit).map((c) => c.id);
}

/**
 * Failed distills, one distill_attempt row per failure keyed `<conversationId>:<n>`. remember() cannot
 * count (a repeat is a gateway noop, a changed text skips the seenCount bump), so each attempt is its
 * own row; MAX_ATTEMPTS parks the chat. Read without a deletedAt filter: the nightly prune soft-deletes
 * these probation rows, and a parked chat must stay parked.
 */
const MAX_ATTEMPTS = 2;

async function parkedConversations(ids: string[]): Promise<Set<string>> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.DISTILL_ATTEMPT, key: { in: ids.map((id) => `${id}:${MAX_ATTEMPTS}`) } },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key.slice(0, -`:${MAX_ATTEMPTS}`.length)));
}

async function recordDistillFailure(conversationId: string, reason: string): Promise<void> {
  log.warn("distill_unusable_reply", { conversationId, reason });
  try {
    const prior = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.DISTILL_ATTEMPT, key: { in: [`${conversationId}:1`] } },
      select: { key: true },
    });
    const n = prior.length > 0 ? MAX_ATTEMPTS : 1;
    const { brainMemory } = await import("@/lib/brain/memory-manager");
    await brainMemory.remember(
      BRAIN_CATEGORIES.DISTILL_ATTEMPT,
      `${conversationId}:${n}`,
      `Session distill attempt ${n} failed: ${reason}.`,
      "session_distiller",
    );
  } catch (err) {
    logError("brain.session-distiller", err, { fn: "recordDistillFailure", conversationId });
  }
}

async function loadConversation(conversationId: string): Promise<ConversationSnapshot | null> {
  const convo = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      title: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, createdAt: true },
      },
    },
  });
  if (!convo || convo.messages.length < 4) return null;
  return convo;
}

/**
 * Distill one conversation. Returns null if the conversation is too
 * short or AI extraction fails. Non-destructive — raw ChatMessage
 * rows are untouched; compression is done via the separate
 * compressConversation path when it fires.
 */
export async function distillConversation(
  conversationId: string,
): Promise<SessionDistill | null> {
  const convo = await loadConversation(conversationId);
  if (!convo) return null;

  const firstAt = convo.messages[0].createdAt;
  const lastAt = convo.messages[convo.messages.length - 1].createdAt;
  const timespanHours =
    Math.round(((lastAt.getTime() - firstAt.getTime()) / 3600_000) * 10) / 10;

  // Keep the transcript lean — cap each message to 400 chars + skip
  // system messages. Most distills only need the gist.
  const transcript = convo.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Nour" : "Nick"}: ${m.content.slice(0, 400).replace(/\s+/g, " ")}`)
    .join("\n");

  const aiResult = await aiChat(
    [
      {
        role: "system",
        content: `You are the session distiller inside NOUR OS. You read chat transcripts between Nour (user) and Nick (his AI). Extract only what deserves to persist into permanent memory for future Nick to reference. Return STRICT JSON matching this schema — no commentary, no markdown fences:

{
  "summary": "2-4 sentences, third person about Nour, what he was working on / thinking / deciding",
  "decisions": ["any choices Nour made during the chat — short phrases"],
  "commitments": ["promises Nour made, with who/when if stated"],
  "questions_still_open": ["anything Nour is stuck on or hasn't resolved"],
  "emotional_tone": "one of: energized / steady / frustrated / reflective / stressed / tired / excited / focused",
  "next_follow_up": "if Nour should check back on something, one sentence; else null"
}

If a field has nothing to record, use [] or null. Never invent content. Be terse.`,
      },
      { role: "user", content: transcript.slice(0, 24000) }, // hard cap for prompt budget
    ],
    "fast",
  ).catch((err) => {
    logError("brain.session-distiller", err, { fn: "distillConversation.aiChat" });
    return null;
  });

  // A provider outage (aiChat's sentinel) is transient and says nothing about this chat: retry it
  // tomorrow without counting. Only an unusable reply from a working provider counts as an attempt.
  if (!aiResult || aiResult.provider === "none" || aiResult.provider === "emergency") {
    log.warn("distill_provider_outage", { conversationId, provider: aiResult?.provider ?? "threw" });
    return null;
  }
  if (!aiResult.content) {
    await recordDistillFailure(conversationId, "empty model reply");
    return null;
  }

  // v10.0.229 · extractJsonObject with repair pass
  const extracted = extractJsonObject<Partial<SessionDistill>>(aiResult.content);
  if (!extracted.ok) {
    await recordDistillFailure(conversationId, "model reply was not the expected JSON");
    return null;
  }
  const parsed: Partial<SessionDistill> = extracted.value;

  const distill: SessionDistill = {
    conversationId,
    messageCount: convo.messages.length,
    timespanHours,
    firstAt: firstAt.toISOString(),
    lastAt: lastAt.toISOString(),
    summary: String(parsed.summary ?? "").slice(0, 600),
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.slice(0, 10).map(String) : [],
    commitments: Array.isArray(parsed.commitments) ? parsed.commitments.slice(0, 10).map(String) : [],
    questions_still_open: Array.isArray(parsed.questions_still_open)
      ? parsed.questions_still_open.slice(0, 10).map(String)
      : [],
    emotional_tone: String(parsed.emotional_tone ?? "steady").slice(0, 40),
    next_follow_up: parsed.next_follow_up
      ? String(parsed.next_follow_up).slice(0, 200)
      : null,
  };

  // Persist through the semantic admission gateway. The summary is model-made,
  // so its trust tier is AGENT_INFERRED even though it summarizes operator text.
  const admittedSummary = await admitMemory({
    category: BRAIN_CATEGORIES.CHAT_SUMMARY,
    key: conversationId,
    content: JSON.stringify(distill),
    source: "session_distiller",
    memoryKind: "derived",
    extractionMethod: "llm_extract",
    confidence: 0.75,
    effectiveFrom: lastAt,
    evidenceRefs: [`conversation:${conversationId}`],
  });

  // v10.0.529.106 · Wave 60 · CROSS-SESSION NICK STATE.
  // After every distill, merge the open questions + next follow-up
  // into a rolling "Nick's current concerns" aggregate. Pre-Wave-60
  // every new chat session started cold · Nick had to re-derive what
  // was unresolved by reverse-searching past distills. Now: one upsert
  // row at category="nick_current_concerns", key="current" that holds
  // the top-5 most-recent open threads sorted by recency.
  // A backlog chat (last message over 14 days old) is archive, not a current concern.
  if (Date.now() - lastAt.getTime() <= CONCERNS_MAX_AGE_MS) {
    void updateNickCurrentConcerns(distill, admittedSummary.id).catch((err) => {
      logError("brain.session-distiller", err, { fn: "distillConversation.updateConcerns" });
    });
  }

  return distill;
}

/**
 * v10.0.529.106 · Wave 60 · the rolling "Nick's current concerns"
 * aggregate. Pulls the prior row, merges in the new distill's open
 * threads, sorts by recency, caps at 5, writes back. Designed to be
 * injected into the chat system prompt so Nick opens every session
 * knowing what was left unresolved from prior sessions.
 *
 * Shape of the content JSON:
 * {
 *   updatedAt: ISO,
 *   threads: [
 *     { text, sourceConversationId, sourceLastAt, kind: "open" | "followup" }
 *   ]
 * }
 */
async function updateNickCurrentConcerns(distill: SessionDistill, summaryMemoryId: string): Promise<void> {
  const MAX_THREADS = 5;
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.NICK_CURRENT_CONCERNS, key: "current" } },
    select: { content: true },
  }).catch((err) => {
    logError("brain.session-distiller", err, { fn: "updateNickCurrentConcerns.findExisting" });
    return null;
  });

  interface ConcernThread {
    text: string;
    sourceConversationId: string;
    sourceLastAt: string;
    kind: "open" | "followup";
  }

  let prior: ConcernThread[] = [];
  if (existing?.content) {
    try {
      const parsed = JSON.parse(existing.content) as { threads?: ConcernThread[] };
      if (Array.isArray(parsed.threads)) prior = parsed.threads;
    } catch (err) {
      // Corrupt JSON · start fresh.
      logError("brain.session-distiller", err, { fn: "updateNickCurrentConcerns.parse" });
    }
  }

  // Drop any prior threads from THIS conversation (the new distill is
  // the freshest signal · stale open questions from the same chat are
  // already encoded in the new distill).
  prior = prior.filter((t) => t.sourceConversationId !== distill.conversationId);

  // Add new threads from this distill.
  const newThreads: ConcernThread[] = [];
  for (const q of distill.questions_still_open.slice(0, 3)) {
    newThreads.push({
      text: q,
      sourceConversationId: distill.conversationId,
      sourceLastAt: distill.lastAt,
      kind: "open",
    });
  }
  if (distill.next_follow_up) {
    newThreads.push({
      text: distill.next_follow_up,
      sourceConversationId: distill.conversationId,
      sourceLastAt: distill.lastAt,
      kind: "followup",
    });
  }

  // Merge · sort by recency desc · cap at MAX_THREADS.
  const merged = [...newThreads, ...prior]
    .sort((a, b) => new Date(b.sourceLastAt).getTime() - new Date(a.sourceLastAt).getTime())
    .slice(0, MAX_THREADS);

  await admitMemory({
    category: BRAIN_CATEGORIES.NICK_CURRENT_CONCERNS,
    key: "current",
    content: JSON.stringify({ updatedAt: new Date().toISOString(), threads: merged }),
    source: "session_distiller",
    memoryKind: "derived",
    extractionMethod: "llm_extract",
    confidence: 0.9,
    derivedFrom: [summaryMemoryId],
    evidenceRefs: [`conversation:${distill.conversationId}`],
  });
}

/**
 * v10.0.529.106 · Wave 60 · public reader for the rolling concerns
 * aggregate. Returns null when no concerns exist yet (cold install).
 * The chat system-prompt builder injects this so Nick opens every
 * session with the operator's open threads in context.
 */
export async function getNickCurrentConcerns(): Promise<{
  updatedAt: string;
  threads: Array<{ text: string; kind: "open" | "followup"; sourceLastAt: string; sourceConversationId?: string }>;
} | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.NICK_CURRENT_CONCERNS, key: "current" } },
    select: { content: true },
  }).catch((err) => {
    logError("brain.session-distiller", err, { fn: "getNickCurrentConcerns.findExisting" });
    return null;
  });
  if (!row?.content) return null;
  try {
    const parsed = JSON.parse(row.content);
    if (!Array.isArray(parsed.threads)) return null;
    return {
      updatedAt: String(parsed.updatedAt ?? new Date().toISOString()),
      threads: parsed.threads.map((t: { text: string; kind: string; sourceLastAt: string; sourceConversationId?: string }) => ({
        text: String(t.text),
        kind: t.kind === "followup" ? "followup" : "open",
        sourceLastAt: String(t.sourceLastAt),
        sourceConversationId: t.sourceConversationId ? String(t.sourceConversationId) : undefined,
      })),
    };
  } catch (err) {
    logError("brain.session-distiller", err, { fn: "getNickCurrentConcerns.parse" });
    return null;
  }
}

/**
 * v10.0.529.106 · Wave 62 · system-prompt block for the cross-session
 * concerns aggregate. Returns an empty string when no concerns exist
 * (no-op append in the chat prompt builder). Renders as a compact
 * block formatted in the same shape as buildIdentityContextBlock /
 * buildSkillsContextBlock so it slots into the existing context-block
 * rerank pipeline (lib/services/chat/brain-context.ts).
 */
export async function buildConcernsContextBlock(): Promise<string> {
  const data = await getNickCurrentConcerns();
  if (!data || data.threads.length === 0) return "";
  const threads: string[] = [];
  for (const t of data.threads) {
    const ageH = Math.round((Date.now() - new Date(t.sourceLastAt).getTime()) / 3600_000);
    const ageStr = ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
    const mark = t.kind === "followup" ? "→" : "?";
    threads.push(`${mark} ${t.text} (${ageStr})`);
  }
  // Fenced as curated_memory (2026-09-02): distilled from prior sessions.
  return [
    "## Nour's open threads (carry-over from past sessions)",
    fenceContent("openThreads", "curated_memory", threads.join("\n"), { maxChars: 20_000 }),
  ].join("\n");
}

/**
 * Process a batch of eligible conversations. Runs sequentially with a
 * small delay so we don't burst the AI provider.
 */
export async function distillIdleSessions(batchSize = 10): Promise<{
  eligible: number;
  distilled: number;
  skipped: number;
  failures: number;
}> {
  const ids = await findEligibleConversations(batchSize);
  let distilled = 0;
  let skipped = 0;
  let failures = 0;

  for (const id of ids) {
    try {
      const result = await distillConversation(id);
      // The queue only serves chats with >=4 messages, so a null here is a failed distill (outage or an
      // unusable reply, both logged in distillConversation), never a skip: an outage must not read "skipped:10".
      if (result) distilled++;
      else failures++;
    } catch (err) {
      failures++;
      logError("brain.session-distiller", err, { fn: "distillIdleSessions", conversationId: id });
    }
    // Tiny pause to play nice with the AI provider
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    eligible: ids.length,
    distilled,
    skipped,
    failures,
  };
}
