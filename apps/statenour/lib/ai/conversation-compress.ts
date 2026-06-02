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

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { aiChat } from "@/lib/ai/provider";

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
  content: string;
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
async function summarizeMessages(messages: CompactMessage[]): Promise<string | null> {
  const transcript = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 800)}`)
    .join("\n\n");

  try {
    const reply = await aiChat(
      [
        { role: "system", content: SUMMARIZER_SYSTEM },
        { role: "user", content: transcript },
      ],
      "summary",
    );
    const text =
      (reply?.content ?? "")
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<\/?think>/gi, "")
        .trim() || null;
    if (!text) {
      console.warn("[conversation-compress] summarizer returned empty content");
      return null;
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[conversation-compress] summarizer error · ${msg}`);
    return null;
  }
}

/**
 * Get the cached summary for a conversation, if still valid for the
 * current message count.
 */
async function getCachedSummary(
  conversationId: string,
  currentCount: number
): Promise<{ summary: string; coveredCount: number } | null> {
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
  const coveredCount = typeof meta.coveredCount === "number" ? meta.coveredCount : 0;

  // Rebuild if we've added enough new messages since the last summary
  if (currentCount - coveredCount >= REBUILD_INCREMENT) return null;

  return {
    summary: mem.content,
    coveredCount,
  };
}

/**
 * Store a fresh summary in BrainMemory for future reuse.
 */
async function storeSummary(
  conversationId: string,
  summary: string,
  coveredCount: number
): Promise<void> {
  const key = `conv_summary_${conversationId}`;
  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY, key } },
      create: {
        category: BRAIN_CATEGORIES.CONVERSATION_SUMMARY,
        key,
        content: summary,
        confidence: 0.8,
        source: "conversation_compress",
        metadata: { coveredCount, compressedAt: new Date().toISOString() },
      },
      update: {
        content: summary,
        confidence: 0.8,
        metadata: { coveredCount, compressedAt: new Date().toISOString() },
      },
    })
    .catch((err) => recordError("ai:compression", err, { conversationId, op: "storeSummary" }));
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
  conversationId: string | undefined
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

  const cutoff = rawMessages.length - KEEP_RECENT;
  const toCompress = rawMessages.slice(0, cutoff);
  const recent = rawMessages.slice(cutoff);

  let summary: string | null = null;

  // Try to reuse a cached summary for this conversation
  if (conversationId) {
    const cached = await getCachedSummary(conversationId, rawMessages.length);
    if (cached) {
      summary = cached.summary;
    }
  }

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
        const flat = toCompress.map((m) => ({
          role: m.role as string,
          content: extractText(m),
        }));
        summary = await summarizeMessages(flat);
        if (summary) {
          storeSummary(conversationId, summary, rawMessages.length).catch((err) =>
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
  //   [last KEEP_RECENT messages verbatim]
  const compressed: CompactMessage[] = [
    {
      role: "system",
      content: `# CONVERSATION SUMMARY (${toCompress.length} earlier messages compressed)\n\n${summary}\n\n# RECENT MESSAGES (verbatim, most recent)`,
    },
    ...recent.map((m) => ({
      role: m.role as string,
      content: extractText(m),
    })),
  ];

  return {
    compressed: true,
    messages: compressed,
    summary,
    compressedCount: toCompress.length,
  };
}
