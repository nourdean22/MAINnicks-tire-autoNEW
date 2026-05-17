/**
 * Chat Recall — pull relevant past chat exchanges by vector similarity.
 *
 * contextual-recall already pulls a single chat_message hit into the
 * "Deeper Context" block. This module is different: it's the dedicated
 * chat-open recall, tuned for "pick up where we left off" rather than
 * mid-conversation semantic match.
 *
 * Key differences:
 *   • Hydrates the MATCH + the exchange around it (user prompt that
 *     preceded, assistant reply that followed). Seeing just one side
 *     of a conversation is useless — Nick needs the turn pair.
 *   • Higher volume (up to 5 exchanges) to give the model real memory
 *     breadth without bloating the prompt beyond ~1500 tokens.
 *   • Blends recency + similarity: if a 3-day-old chat matches at
 *     sim=0.6 and a 90-day-old one matches at sim=0.8, we surface
 *     both but weight the recent one higher in the ranked return.
 *
 * Usage: buildChatRecallBlock(queryText) → string block for the
 * system prompt, or "" when there's nothing to surface.
 */

import { prisma } from "@/lib/prisma";
import { semanticSearch } from "@/lib/brain/embedding-utils";

interface ChatTurn {
  role: string;
  content: string;
  createdAt: Date;
  conversationId: string;
}

interface ExchangeHit {
  conversationId: string;
  conversationTitle: string | null;
  similarity: number;
  ageDays: number;
  /** The matched message (usually assistant reply). */
  matched: ChatTurn;
  /** User message immediately before the match (context). */
  precedingUser?: ChatTurn | null;
  /** Assistant reply after the user message, if the match was a user turn. */
  followingAssistant?: ChatTurn | null;
}

/**
 * Find exchange pairs from past chats that match the query, hydrated
 * with the turn before/after so the full context surfaces.
 *
 * Apr 18: the embed-backfill cron indexes assistant replies ≥60 chars;
 * we expand outward from those hits. If the match IS a user message
 * (some embeddings include user content), we pull the assistant reply
 * that followed instead.
 */
export async function getRelevantExchanges(
  queryText: string,
  limit: number = 5,
): Promise<ExchangeHit[]> {
  if (!queryText || queryText.trim().length < 4) return [];

  // Wider net — search returns 20, we'll filter + hydrate down.
  const matches = await semanticSearch(queryText, 20, ["chat_message"]);
  const strong = matches.filter((m) => m.similarity >= 0.42);
  if (strong.length === 0) return [];

  const messageIds = strong.map((m) => m.sourceId);
  const messages = await prisma.chatMessage.findMany({
    where: { id: { in: messageIds } },
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      conversationId: true,
      conversation: { select: { title: true } },
    },
  });

  // Hydrate turn-pairs. For each matched message, pull the surrounding
  // turn on the right side of the conversation.
  //
  // v10.0.46 — fixed N+1. Pre-fix this issued one `findFirst` per
  // matched message (up to 20 sequential round-trips per chat turn
  // that triggers semantic recall). The comment even claimed
  // "Batch one query…rather than one-per-match" but the code did
  // exactly the latter. Now: collect conversation-IDs + timestamp
  // boundaries, do ONE findMany with an OR clause across all
  // conversations, then match in-memory.
  const pairLookups = messages.map((m) => ({
    messageId: m.id,
    conversationId: m.conversationId,
    createdAt: m.createdAt,
    isAssistant: m.role === "assistant",
  }));

  // Build a single query covering both before-anchors (assistant
  // matches needing prior user) and after-anchors (user matches
  // needing next assistant). One round-trip total.
  type PairWhere = {
    conversationId: string;
    role: string;
    createdAt: { lt: Date } | { gt: Date };
  };
  const orClauses: PairWhere[] = pairLookups.map((l) =>
    l.isAssistant
      ? {
          conversationId: l.conversationId,
          role: "user",
          createdAt: { lt: l.createdAt },
        }
      : {
          conversationId: l.conversationId,
          role: "assistant",
          createdAt: { gt: l.createdAt },
        },
  );
  const candidateRows =
    pairLookups.length > 0
      ? await prisma.chatMessage.findMany({
          where: { OR: orClauses },
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true, createdAt: true, conversationId: true },
        })
      : [];

  // For each anchor, pick the closest neighbour from candidateRows.
  const pairs = pairLookups.map((lookup) => {
    if (lookup.isAssistant) {
      // Closest user message strictly before the anchor.
      let best: typeof candidateRows[number] | null = null;
      for (const r of candidateRows) {
        if (
          r.conversationId === lookup.conversationId &&
          r.role === "user" &&
          r.createdAt < lookup.createdAt &&
          (!best || r.createdAt > best.createdAt)
        ) {
          best = r;
        }
      }
      return { before: best, after: null };
    } else {
      // Closest assistant message strictly after the anchor.
      let best: typeof candidateRows[number] | null = null;
      for (const r of candidateRows) {
        if (
          r.conversationId === lookup.conversationId &&
          r.role === "assistant" &&
          r.createdAt > lookup.createdAt &&
          (!best || r.createdAt < best.createdAt)
        ) {
          best = r;
        }
      }
      return { before: null, after: best };
    }
  });

  const now = Date.now();
  const hits: ExchangeHit[] = messages
    .map((m, i) => {
      const score = strong.find((s) => s.sourceId === m.id);
      const pair = pairs[i];
      const matched: ChatTurn = {
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        conversationId: m.conversationId,
      };
      return {
        conversationId: m.conversationId,
        conversationTitle: m.conversation?.title ?? null,
        similarity: score?.similarity ?? 0,
        ageDays: Math.max(0, Math.round((now - m.createdAt.getTime()) / 86400000)),
        matched,
        precedingUser: pair.before,
        followingAssistant: pair.after,
      };
    })
    // De-dup so we don't show two matches from the same conversation
    .reduce<ExchangeHit[]>((acc, hit) => {
      if (acc.some((h) => h.conversationId === hit.conversationId)) return acc;
      acc.push(hit);
      return acc;
    }, [])
    // Hybrid rank: similarity (80%) + recency (20%)
    .sort((a, b) => {
      const rankA = a.similarity * 0.8 + recencyScore(a.ageDays) * 0.2;
      const rankB = b.similarity * 0.8 + recencyScore(b.ageDays) * 0.2;
      return rankB - rankA;
    })
    .slice(0, limit);

  return hits;
}

/** 0-1 score: last-7d = 1.0, decays to 0 at 90d. */
function recencyScore(ageDays: number): number {
  if (ageDays <= 7) return 1.0;
  if (ageDays >= 90) return 0;
  return 1 - (ageDays - 7) / 83;
}

/**
 * Build a compact system-prompt block. Returns "" when there's nothing
 * worth surfacing. Max ~6 exchanges, each clipped to 180 chars per
 * side, so total block ≈ 1.5KB.
 */
export async function buildChatRecallBlock(queryText: string, limit = 5): Promise<string> {
  const hits = await getRelevantExchanges(queryText, limit).catch(() => []);
  if (hits.length === 0) return "";

  const lines: string[] = [];
  lines.push(`## From past chats (vector-matched, ${hits.length} exchange${hits.length > 1 ? "s" : ""})`);
  lines.push(
    "Reference these if the current topic overlaps — don't re-explain what Nour already covered here.",
  );
  lines.push("");

  for (const h of hits) {
    const title = h.conversationTitle ? `"${h.conversationTitle}"` : `#${h.conversationId.slice(0, 6)}`;
    lines.push(`— ${title} · ${h.ageDays}d ago · sim ${Math.round(h.similarity * 100)}%`);
    if (h.precedingUser) {
      lines.push(`  Nour: ${h.precedingUser.content.slice(0, 180).replace(/\s+/g, " ")}`);
      lines.push(`  Nick: ${h.matched.content.slice(0, 180).replace(/\s+/g, " ")}`);
    } else if (h.followingAssistant) {
      lines.push(`  Nour: ${h.matched.content.slice(0, 180).replace(/\s+/g, " ")}`);
      lines.push(`  Nick: ${h.followingAssistant.content.slice(0, 180).replace(/\s+/g, " ")}`);
    } else {
      lines.push(`  ${h.matched.role}: ${h.matched.content.slice(0, 220).replace(/\s+/g, " ")}`);
    }
  }

  return lines.join("\n");
}

/**
 * "Last week you were working on X" — a lighter-touch fallback that
 * runs even when the current query has no strong semantic match.
 * Picks the 2 most-recent conversations and returns their titles +
 * the first user message of each. Used at chat open when Nour hasn't
 * typed anything yet.
 */
export async function buildChatContinuityBlock(): Promise<string> {
  // P7 · v8.30 · skip archived convos — Nour archived for a reason;
  // re-injecting them into the system prompt undoes that signal.
  const recent = await prisma.chatConversation.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 4,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { content: true },
      },
    },
  });

  const withContent = recent
    .filter((c) => c.messages[0]?.content)
    .slice(0, 3);
  if (withContent.length === 0) return "";

  const now = Date.now();
  const lines: string[] = [];
  lines.push("## Recent chat threads");
  lines.push("Continuation cues — what Nour was last talking to you about:");
  lines.push("");
  for (const c of withContent) {
    const ageH = Math.round((now - c.updatedAt.getTime()) / 3600_000);
    const ageLabel = ageH < 24 ? `${ageH}h ago` : `${Math.round(ageH / 24)}d ago`;
    const title = c.title ?? c.messages[0]!.content.slice(0, 60);
    lines.push(`— ${title} (${ageLabel})`);
  }
  return lines.join("\n");
}
