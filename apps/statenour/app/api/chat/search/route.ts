import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

/**
 * GET /api/chat/search?q=<query>&limit=20
 *
 * Full-text search across ALL chat messages.
 *
 * v7.6 · C10 · Apr 29 · ChatMessage Batch A — REWRITTEN to use the
 * Postgres tsvector + GIN index added by the C1 migration. Search
 * latency drops from O(N) LIKE scan to O(log N) GIN traversal.
 *
 * Strategy:
 *   1. Use `searchable_tsv @@ plainto_tsquery('english', $q)` for the
 *      relevance match (ranks by `ts_rank`)
 *   2. Fall back to ILIKE on `content` if no FTS hits — covers single
 *      words / partial words / Unicode that tsquery doesn't tokenize
 *      well, AND covers legacy rows where searchable_content hasn't
 *      been backfilled yet
 *   3. Group by conversationId, return snippets + match counts
 *
 * Response shape unchanged for back-compat with the existing UI:
 *   { query, results, totalMessages }
 */
// v10.0.44 — auth: "owner". Pre-fix the chat full-text search was
// unauthed; any caller could query the entire ChatMessage corpus.
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);

  if (q.length < 2) {
    return { query: q, results: [], totalMessages: 0 };
  }

  type Hit = {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    created_at: Date;
    rank?: number;
  };

  // ── Primary: tsvector match. plainto_tsquery handles multi-word
  // phrases, stemming, and stop words. ts_rank gives relevance score.
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

  // ── Fallback: ILIKE on content for legacy rows / partial-word terms.
  // Only fires when FTS returned 0 hits → preserves legacy behavior on
  // niche queries while making the common case fast.
  // (ChatMessage uses fork-truncation rather than soft-delete; no
  // deletedAt filter applies here.)
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

    // Snippet centered on the match. tsvector wins lose exact char
    // positions, so we still locate via lower-case substring scan.
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

  // ── Build results: rank-then-recency sort ──
  const results = Array.from(grouped.values())
    .sort((a, b) => {
      // FTS hits: relevance-first
      if (a.bestRank !== b.bestRank) return b.bestRank - a.bestRank;
      // Tie-breaker: most recent
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
    /** v7.6 · indicates whether GIN-FTS or ILIKE-fallback served the request */
    engine: messages.some((m) => (m.rank ?? 0) > 0) ? "fts" : "ilike",
  };
}, { auth: "owner" });
