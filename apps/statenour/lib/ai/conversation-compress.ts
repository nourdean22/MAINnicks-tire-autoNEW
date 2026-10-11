/**
 * Conversation Compression — rolling summary for long chats.
 *
 * Problem: as a conversation goes past ~10 messages, sending the
 * full history to Venice on every turn wastes tokens and slows
 * first-token latency. But dropping old messages loses continuity.
 *
 * Solution: when messages.length > THRESHOLD, take the older half,
 * have Venice summarize them into a dense context block, then send
 * only [system, summary_block, last 4 messages] to the model. The
 * summary is cached per-conversation in BrainMemory with key
 * "conv_summary_<conversationId>" so subsequent turns reuse it.
 *
 * Idempotent: re-compressing with the same message count returns
 * the cached summary instantly. Only rebuilds when the count crosses
 * the next compression threshold (every +8 messages).
 *
 * Budget cut: typical 20-message conversation goes from ~15K user
 * tokens → ~4K. Venice first-token latency drops proportionally.
 */

import { convertToModelMessages } from "ai";
import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { aiChat, isAiSentinel } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/conversation-compress");

// Compression kicks in past this many messages.
// Apr 19 · Threshold raised 12 → 20 so the compression AI call
// doesn't fire on every medium-length conversation. Venice's 128K
// context window can easily hold 20 recent turns verbatim without
// compression. Only LONG histories compress.
const COMPRESSION_THRESHOLD = 20;
// Keep the last N messages as-is (fresh context).
const KEEP_RECENT = 4;
// Rebuild the summary every time count grows by this much past the threshold.
const REBUILD_INCREMENT = 8;

// v9.1.22 · per-conversation in-memory lock to prevent the compression
// AI call from bypassing the v9.1.19 chat-route rate limit. Two rapid
// chat turns on the same conversation could fire compression in
// parallel — both would call Venice, both would hit the same cache
// row, only one win. The chat-route AI rate limit only counts the
// outer call, not this internal one. This Set short-circuits the
// second concurrent compression to use the most-recent cached summary.
const inFlightCompressions = new Set<string>();

interface CompactMessage {
  role: string;
  /** string for the summary block; recent turns keep their model-message
   *  parts (file/image/tool) when the AI SDK can convert them. */
  content: string | unknown[];
}

interface CompressionResult {
  /** Whether compression was applied (false if under threshold) */
  compressed: boolean;
  /** The final message list to send to the model */
  messages: CompactMessage[];
  /** Summary text if compression happened, else null */
  summary: string | null;
  /** How many original messages were compressed into the summary */
  compressedCount: number;
}

/**
 * Extract plain text from a UIMessage-format part array or string content.
 */
function extractText(msg: Record<string, unknown>): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.parts)) {
    const parts = msg.parts as Array<{ type?: string; text?: string }>;
    return parts
      .filter((p) => p?.type === "text" && typeof p?.text === "string")
      .map((p) => p.text as string)
      .join(" ");
  }
  if (msg.content != null) return JSON.stringify(msg.content);
  return "";
}

const SUMMARIZER_SYSTEM = `You are a conversation summarizer for Nick's Chief of Staff AI. Compress the following chat transcript into a dense context block that preserves:
- Every decision made
- Every task or commitment discussed
- Every topic/person/project referenced (with specific names)
- Emotional state + mood shifts
- Anything Nour specifically asked Nick to remember

Format: bulleted notes under headers. Max 400 words. Skip filler. Keep specific numbers, dates, names. If something was unresolved, mark it [UNRESOLVED].`;

/**
 * Summarize a chunk of messages into a dense context block.
 *
 * Wave 59 · routed through aiChat() (taskType "summary") instead of a
 * raw Venice fetch. aiChat handles provider selection + fallback chain
 * + circuit breaker + budget cap — the old raw fetch hardcoded the
 * Venice model behind a VENICE_API_KEY guard and bypassed all of that
 * (returned null with no fallback when the key was unset or Venice was
 * down). Returns null on empty/failed output so the caller falls
 * through to uncompressed messages.
 */
async function summarizeMessages(
  messages: Array<{ role: string; content: string }>,
  /** A previous summary to fold in (whole, not clipped like a message). */
  previousSummary?: string,
): Promise<string | null> {
  const turns = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join("\n\n");
  const transcript = previousSummary
    ? `PREVIOUS SUMMARY (of the earlier messages):\n${previousSummary}\n\nLATER MESSAGES:\n${turns}`
    : turns;

  try {
    const reply = await aiChat(
      [
        { role: "system", content: SUMMARIZER_SYSTEM },
        { role: "user", content: transcript },
      ],
      "summary",
    );
    // aiChat RETURNS the outage apology instead of throwing. Caching it would
    // replay "I'm having trouble connecting..." as this conversation's history.
    if (isAiSentinel(reply)) {
      log.warn("summarizer_provider_unavailable", { provider: reply?.provider ?? null });
      return null;
    }
    const text =
      (reply?.content ?? "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<\/?think>/gi, "")
        .trim() || null;
    if (!text) {
      log.warn("summarizer_empty_content");
      return null;
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("summarizer_error", { error: msg.slice(0, 200) });
    return null;
  }
}

interface SummaryRow {
  summary: string;
  /** Absolute position the summary covers up to (exclusive). */
  coveredCount: number;
  /** Absolute position it covers from: > 0 when earlier messages were never summarized. */
  coveredFrom: number;
}

/**
 * Read the stored summary row for a conversation, reusable or not.
 */
async function getSummaryRow(conversationId: string): Promise<SummaryRow | null> {
  const mem = await prisma.brainMemory
    .findFirst({
      where: {
        category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
        key: `conv_summary_${conversationId}`,
      },
    })
    .catch(() => null);
  if (!mem?.metadata) return null;

  const meta = mem.metadata as Record<string, unknown>;
  // 2026-10-10 · coveredCount is now the number of messages the summary
  // actually covers (the cutoff). Rows written before that stored
  // rawMessages.length (KEEP_RECENT too many) and may hold a cached outage
  // sentinel, so an unmarked row is rebuilt rather than trusted.
  if (meta.coverage !== "cutoff") return null;
  const coveredCount = typeof meta.coveredCount === "number" ? meta.coveredCount : 0;
  if (coveredCount <= 0) return null;
  const coveredFrom = typeof meta.coveredFrom === "number" ? meta.coveredFrom : 0;
  return { summary: mem.content, coveredCount, coveredFrom };
}

/**
 * Whether a stored summary is still valid for the current message count.
 */
function isReusable({ coveredCount }: SummaryRow, currentCount: number): boolean {
  // History shrank (edit / regenerate) below what the summary covers: the
  // verbatim tail would lose the current turn. Rebuild.
  if (coveredCount > currentCount - KEEP_RECENT) return false;
  // Rebuild once REBUILD_INCREMENT new messages arrived past the old tail
  // (same cadence as before coveredCount meant the cutoff).
  return currentCount - coveredCount < REBUILD_INCREMENT + KEEP_RECENT;
}

/**
 * Store a fresh summary in BrainMemory for future reuse.
 */
async function storeSummary(
  conversationId: string,
  summary: string,
  coveredCount: number,
  coveredFrom: number,
): Promise<void> {
  const key = `conv_summary_${conversationId}`;
  const metadata = { coveredCount, coveredFrom, coverage: "cutoff", compressedAt: new Date().toISOString() };
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY, key } },
      create: {
        category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
        key,
        content: summary,
        confidence: 0.8,
        source: "conversation_compress",
        metadata,
      },
      update: {
        content: summary,
        confidence: 0.8,
        metadata,
      },
    })
    .catch((err) => recordError("ai:compression", err, { conversationId, op: "storeSummary" }));
}

/**
 * The verbatim tail keeps its original parts: the compressed path skips the
 * route's convertToModelMessages, so flattening to text here dropped every
 * image / file attached in the last turns. Falls back to text when the AI SDK
 * cannot convert the shape (e.g. legacy { role, content: string } rows).
 */
async function recentAsModelMessages(recent: Array<Record<string, unknown>>): Promise<CompactMessage[]> {
  try {
    const converted = await convertToModelMessages(
      recent as unknown as Parameters<typeof convertToModelMessages>[0],
    );
    return converted.map((m) => ({ role: m.role, content: m.content as string | unknown[] }));
  } catch {
    return recent.map((m) => ({ role: m.role as string, content: extractText(m) }));
  }
}

/**
 * Main entry point — takes the raw message array from the client
 * and returns a possibly-compressed version ready for streamText.
 *
 * Rules:
 *   - messages.length <= THRESHOLD → return as-is
 *   - otherwise → older messages get summarized, return
 *     [summary_as_system_msg, ...lastN]
 *
 * Never mutates the input array.
 */
export async function compressConversation(
  rawMessages: Array<Record<string, unknown>>,
  conversationId: string | undefined,
  /** How many older messages the client left out of `rawMessages` (it sends
   *  a window, audit 04-F15). The cached summary counts absolute positions. */
  historyOffset = 0,
): Promise<CompressionResult> {
  // Short conversation — no compression
  if (rawMessages.length <= COMPRESSION_THRESHOLD) {
    return {
      compressed: false,
      messages: rawMessages.map((m) => ({
        role: m.role as string,
        content: extractText(m),
      })),
      summary: null,
      compressedCount: 0,
    };
  }

  let cutoff = rawMessages.length - KEEP_RECENT;
  let summary: string | null = null;
  let coveredFrom = 0;
  let previous: SummaryRow | null = null;

  // Try to reuse a cached summary for this conversation. Its coveredCount is
  // where the verbatim tail must start, or the messages between the old
  // cutoff and the new one land in neither the summary nor the tail.
  if (conversationId) {
    previous = await getSummaryRow(conversationId);
    if (previous && isReusable(previous, historyOffset + rawMessages.length)) {
      const cached = previous;
      summary = cached.summary;
      coveredFrom = cached.coveredFrom;
      // Reuse only happens within REBUILD_INCREMENT + KEEP_RECENT of the
      // end, so this is past the window start whenever compression runs.
      cutoff = cached.coveredCount - historyOffset;
    }
  }

  const toCompress = rawMessages.slice(0, cutoff);
  const recent = rawMessages.slice(cutoff);

  // Build a fresh summary if none cached.
  // v9.1.22 · concurrency guard. The chat route's AI rate limit
  // only catches the outer chat call, not this internal Venice
  // request. Two rapid turns can both fire compression here in
  // parallel — wasting Venice tokens AND racing to write the same
  // summary cache row. If a compression is already in flight for
  // this conversation, skip and fall back to the uncompressed
  // path; the next turn will pick up the freshly-cached summary.
  if (!summary && conversationId) {
    if (inFlightCompressions.has(conversationId)) {
      // Concurrent compression is already running — fall back to
      // uncompressed messages for THIS turn. Next turn will see
      // the cache row the in-flight call writes.
      summary = null;
    } else {
      inFlightCompressions.add(conversationId);
      try {
        // A windowed rebuild cannot see abs[0..historyOffset): fold the previous summary
        // in when it reaches the window, else record that gap as coveredFrom.
        const fold =
          historyOffset > 0 &&
          previous &&
          previous.coveredCount >= historyOffset &&
          previous.coveredCount <= historyOffset + cutoff
            ? previous
            : null;
        coveredFrom = fold ? fold.coveredFrom : historyOffset;
        const flat = toCompress.slice(fold ? fold.coveredCount - historyOffset : 0).map((m) => ({
          role: m.role as string,
          content: extractText(m),
        }));
        summary = await summarizeMessages(flat, fold?.summary);
        if (summary) {
          storeSummary(conversationId, summary, historyOffset + cutoff, coveredFrom).catch((err) =>
            recordError("ai:compression", err, { conversationId, op: "storeSummary-async" }),
          );
        }
      } finally {
        inFlightCompressions.delete(conversationId);
      }
    }
  } else if (!summary) {
    // No conversationId — concurrency-safe by definition (no shared
    // key). Run as before.
    coveredFrom = historyOffset;
    const flat = toCompress.map((m) => ({
      role: m.role as string,
      content: extractText(m),
    }));
    summary = await summarizeMessages(flat);
  }

  if (!summary) {
    // Compression failed — fall back to uncompressed
    return {
      compressed: false,
      messages: rawMessages.map((m) => ({
        role: m.role as string,
        content: extractText(m),
      })),
      summary: null,
      compressedCount: 0,
    };
  }

  // Build the compressed message list:
  //   [system: the summary]
  //   [every message after the summary's coverage, verbatim]
  const compressed: CompactMessage[] = [
    {
      role: "system",
      // 04-X4: the summary is an older snapshot; Nour's newer words win.
      content: `# CONVERSATION SUMMARY (${toCompress.length} earlier messages compressed)\n\n${coveredFrom > 0 ? `(The first ${coveredFrom} messages of this conversation are not in this summary.)\n\n` : ""}${summary}\n\nWhere this summary conflicts with the recent messages, the recent messages are current.\n\n# RECENT MESSAGES (verbatim, most recent)`,
    },
    ...(await recentAsModelMessages(recent)),
  ];

  return {
    compressed: true,
    messages: compressed,
    summary,
    compressedCount: toCompress.length,
  };
}
