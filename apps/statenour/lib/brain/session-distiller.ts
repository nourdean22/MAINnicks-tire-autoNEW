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
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("session-distiller");
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

/**
 * Find conversations eligible for distillation. Returns up to `limit`
 * conversation IDs ordered oldest-idle-first so we chip away at the
 * oldest backlog on each run.
 */
export async function findEligibleConversations(limit = 10): Promise<string[]> {
  const idleCutoff = new Date(Date.now() - 30 * 60_000);

  // Conversations touched recently enough to matter (30d), idle enough
  // to be "done", with ≥4 messages.
  // P7 · v8.30 · session-distiller skips archived convos — once
  // archived, no point distilling further (the auto-archive cron
  // sets archivedAt on idle convos; distiller should see those as
  // "already handled").
  const candidates = await prisma.chatConversation.findMany({
    where: {
      archivedAt: null,
      updatedAt: {
        lt: idleCutoff,
        gt: new Date(Date.now() - 30 * 86400_000),
      },
    },
    orderBy: { updatedAt: "asc" },
    take: limit * 3, // oversample so we can filter
    select: {
      id: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  const withEnough = candidates.filter((c) => c._count.messages >= 4).slice(0, limit * 2);
  if (withEnough.length === 0) return [];

  // Skip any that already have a fresh distill
  const existing = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.CHAT_SUMMARY,
      key: { in: withEnough.map((c) => c.id) },
      deletedAt: null, // v10.0.66 · soft-deleted distill = redistill
    },
    select: { key: true, updatedAt: true },
  });
  const distilled = new Map(existing.map((e) => [e.key, e.updatedAt]));

  return withEnough
    .filter((c) => {
      const existingAt = distilled.get(c.id);
      if (!existingAt) return true;
      // Redistill if the convo had activity after the last distill
      return c.updatedAt.getTime() > existingAt.getTime();
    })
    .slice(0, limit)
    .map((c) => c.id);
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

  if (!aiResult || !aiResult.content) return null;

  // v10.0.229 · extractJsonObject with repair pass
  const extracted = extractJsonObject<Partial<SessionDistill>>(aiResult.content);
  if (!extracted.ok) return null;
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

  // Persist as a BrainMemory row. The embed-backfill cron will index
  // it for vector search overnight.
  await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.CHAT_SUMMARY, key: conversationId } },
    create: {
      category: BRAIN_CATEGORIES.CHAT_SUMMARY,
      key: conversationId,
      content: JSON.stringify(distill),
      confidence: 0.75,
      source: "session_distiller",
    },
    update: {
      content: JSON.stringify(distill),
      confidence: 0.75,
      lastSeen: new Date(),
      seenCount: { increment: 1 },
    },
  });

  // v10.0.529.106 · Wave 60 · CROSS-SESSION NICK STATE.
  // After every distill, merge the open questions + next follow-up
  // into a rolling "Nick's current concerns" aggregate. Pre-Wave-60
  // every new chat session started cold · Nick had to re-derive what
  // was unresolved by reverse-searching past distills. Now: one upsert
  // row at category="nick_current_concerns", key="current" that holds
  // the top-5 most-recent open threads sorted by recency.
  void updateNickCurrentConcerns(distill).catch((err) => {
    logError("brain.session-distiller", err, { fn: "distillConversation.updateConcerns" });
  });

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
async function updateNickCurrentConcerns(distill: SessionDistill): Promise<void> {
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

  await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.NICK_CURRENT_CONCERNS, key: "current" } },
    create: {
      category: BRAIN_CATEGORIES.NICK_CURRENT_CONCERNS,
      key: "current",
      content: JSON.stringify({ updatedAt: new Date().toISOString(), threads: merged }),
      confidence: 0.9,
      source: "session_distiller",
    },
    update: {
      content: JSON.stringify({ updatedAt: new Date().toISOString(), threads: merged }),
      lastSeen: new Date(),
      seenCount: { increment: 1 },
    },
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
  const lines: string[] = [
    "## Nour's open threads (carry-over from past sessions)",
  ];
  for (const t of data.threads) {
    const ageH = Math.round((Date.now() - new Date(t.sourceLastAt).getTime()) / 3600_000);
    const ageStr = ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
    const mark = t.kind === "followup" ? "→" : "?";
    lines.push(`${mark} ${t.text} (${ageStr})`);
  }
  return lines.join("\n");
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
      if (result) distilled++;
      else skipped++;
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
