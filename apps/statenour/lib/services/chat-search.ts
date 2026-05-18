/**
 * lib/services/chat-search.ts · Phase Z (2026-05-18 PM)
 *
 * Full-text + ILIKE-fallback search across ALL ChatMessage rows.
 * Extracted from `app/api/chat/search/route.ts` so the legacy REST
 * endpoint AND the new `trpc.chat.search` procedure both call this
 * single function · drift between the two consumers is structurally
 * impossible.
 *
 * Search strategy (unchanged from v7.6 · C10 · 2026-04-29):
 *   1. Primary · tsvector @@ plainto_tsquery via the C1 GIN index ·
 *      O(log N) traversal · ranks by ts_rank
 *   2. Fallback · ILIKE on content when FTS returns 0 hits · covers
 *      partial words / Unicode / legacy un-backfilled rows
 *   3. Group by conversationId · build snippets · fetch titles
 *
 * Response shape unchanged for back-compat with the chat-history-search
 * component and any other legacy consumer.
 */

import { prisma } from "@/lib/prisma";

export interface ChatSearchSnippet {
  messageId: string;
  role: string;
  snippet: string;
  createdAt: string;
}

export interface ChatSearchGroup {
  conversationId: string;
  conversationTitle: string;
  lastMatchAt: string;
  totalMatches: number;
  relevance: number;
  snippets: ChatSearchSnippet[];
}

export interface ChatSearchResult {
  query: string;
  results: ChatSearchGroup[];
  totalMessages: number;
  /** v7.6 · "fts" when the GIN index served the query · "ilike"
   *  when the fallback path served it · empty string when q < 2 chars. */
  engine: "fts" | "ilike" | "";
}

interface ChatSearchOptions {
  q: string;
  /** Cap on returned groups · default 20 · max 100. */
  limit?: number;
}

export async function searchChat(options: ChatSearchOptions): Promise<ChatSearchResult> {
  const q = options.q.trim();
  const limit = Math.min(options.limit ?? 20, 100);

  if (q.length < 2) {
    return { query: q, results: [], totalMessages: 0, engine: "" };
  }

  type Hit = {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: Date;
    rank?: number;
  };

  // ── Primary · tsvector match ──
  let messages: Hit[] = await prisma.$queryRaw<Hit[]>`
    SELECT id,
           conversation_id,
           role,
           content,
           created_at,
           ts_rank("searchable_tsv", plainto_tsquery('english', ${q})) AS rank
      FROM chat_messages
     WHERE "searchable_tsv" @@ plainto_tsquery('english', ${q})
       AND role IN ('user', 'assistant')
     ORDER BY rank DESC, created_at DESC
     LIMIT ${limit * 4}
  `.catch(() => [] as Hit[]);

  // ── Fallback · ILIKE for legacy / partial-word terms ──
  if (messages.length === 0) {
    const fallback = await prisma.chatMessage.findMany({
      where: {
        content: { contains: q, mode: "insensitive" },
        role: { in: ["user", "assistant"] },
      },
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit * 4,
    });
    messages = fallback.map((m) => ({
      id: m.id,
      conversation_id: m.conversationId,
      role: m.role,
      content: m.content,
      created_at: m.createdAt,
    }));
  }

  // ── Group by conversation, build snippets ──
  const grouped = new Map<
    string,
    {
      conversationId: string;
      lastMatchAt: Date;
      bestRank: number;
      snippets: Array<{
        messageId: string;
        role: string;
        snippet: string;
        createdAt: Date;
        rank: number;
      }>;
    }
  >();

  const qLower = q.toLowerCase();
  for (const m of messages) {
    if (!m.conversation_id) continue;
    const g = grouped.get(m.conversation_id) || {
      conversationId: m.conversation_id,
      lastMatchAt: m.created_at,
      bestRank: 0,
      snippets: [],
    };

    const lower = (m.content || "").toLowerCase();
    const idx = lower.indexOf(qLower);
    const safeIdx = idx >= 0 ? idx : 0;
    const start = Math.max(0, safeIdx - 60);
    const end = Math.min((m.content || "").length, safeIdx + q.length + 140);
    const snippet =
      (start > 0 ? "…" : "") +
      (m.content || "").slice(start, end).trim() +
      (end < (m.content || "").length ? "…" : "");

    const rank = m.rank ?? 0;
    g.snippets.push({
      messageId: m.id,
      role: m.role,
      snippet,
      createdAt: m.created_at,
      rank,
    });
    if (m.created_at > g.lastMatchAt) g.lastMatchAt = m.created_at;
    if (rank > g.bestRank) g.bestRank = rank;
    grouped.set(m.conversation_id, g);
  }

  // ── Fetch conversation titles ──
  const convIds = Array.from(grouped.keys());
  const conversations =
    convIds.length > 0
      ? await prisma.chatConversation.findMany({
          where: { id: { in: convIds } },
          select: { id: true, title: true },
        })
      : [];
  const titleById = new Map(conversations.map((c) => [c.id, c.title || "Untitled chat"]));

  // ── Build results · rank-then-recency sort ──
  const results: ChatSearchGroup[] = Array.from(grouped.values())
    .sort((a, b) => {
      if (a.bestRank !== b.bestRank) return b.bestRank - a.bestRank;
      return b.lastMatchAt.getTime() - a.lastMatchAt.getTime();
    })
    .slice(0, limit)
    .map((g) => ({
      conversationId: g.conversationId,
      conversationTitle: titleById.get(g.conversationId) || "Untitled chat",
      lastMatchAt: g.lastMatchAt.toISOString(),
      totalMatches: g.snippets.length,
      relevance: Math.round(g.bestRank * 1000) / 1000,
      snippets: g.snippets
        .sort((a, b) => b.rank - a.rank || b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 3)
        .map((s) => ({
          messageId: s.messageId,
          role: s.role,
          snippet: s.snippet,
          createdAt: s.createdAt.toISOString(),
        })),
    }));

  return {
    query: q,
    results,
    totalMessages: messages.length,
    engine: messages.some((m) => (m.rank ?? 0) > 0) ? "fts" : "ilike",
  };
}
