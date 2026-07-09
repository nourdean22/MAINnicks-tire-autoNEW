/**
 * Objection Injector · AG-30 (2026-07-09)
 *
 * Mirrors lib/brain/contradiction-injector.ts for adversarial-critic
 * objections. The critic (lib/ai/adversarial-critic.ts) has stored a
 * counter-view per recommendation since v10.0.369 — but the objections
 * were effectively WRITE-ONLY: readable only by long-pressing a message
 * to open the reasoning-trace modal. A severity-3 "the recommender is
 * probably wrong" finding never re-entered the conversation.
 *
 * This module is the READ path: on each turn, surface the most recent
 * STRONG objection (severity ≥ 2, foundFlaw) raised in THIS
 * conversation within the last 24h, at most once per conversation —
 * so Nick raises his own unaddressed counter-view instead of letting
 * it rot in a modal.
 *
 * Design (mirrors the contradiction injector's choices):
 *   · Best-effort throughout — any failure returns null, never throws;
 *     the chat route calls this without a try/catch.
 *   · NO PARALLEL TABLE — dedup markers live in BrainMemory under
 *     "objection_injection_log" (key = `${convId}:${objectionKey}`),
 *     with a 7-day expiresAt so the decay cron prunes them.
 *   · Once per conversation EVER (not per-day): re-raising the same
 *     counter-view twice in one conversation is a trust-killer; a new
 *     stronger objection (different key) can still surface.
 *   · No embeddings needed — relevance is structural (same
 *     conversation), unlike contradictions which cosine-match content.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

const LOOKBACK_HOURS = 24;

export interface RelevantObjection {
  key: string;
  objection: string;
  severity: number;
  createdAt: string;
}

/**
 * Most recent strong (severity ≥ 2 + foundFlaw) objection stored for
 * THIS conversation in the last 24h, unless one was already surfaced
 * for it. Null on no-hit or any failure.
 */
export async function findRelevantObjections(ctx: {
  conversationId?: string | null;
}): Promise<RelevantObjection | null> {
  const { conversationId } = ctx;
  if (!conversationId) return null;

  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600_000);
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: "adversarial_objection",
        deletedAt: null,
        createdAt: { gte: since },
        metadata: { path: ["conversationId"], equals: conversationId },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { key: true, content: true, createdAt: true, metadata: true },
    });
    if (rows.length === 0) return null;

    const strong = rows.find((r) => {
      const meta = (r.metadata ?? {}) as { severity?: number; foundFlaw?: boolean };
      return (meta.severity ?? 0) >= 2 && meta.foundFlaw === true;
    });
    if (!strong) return null;

    // Once-per-conversation dedup. Marker written BEFORE returning so
    // two concurrent turns can't both fire; write failure degrades to
    // returning the hit anyway (non-broken, mirrors the contradiction
    // injector's choice).
    const dedupKey = `${conversationId}:${strong.key}`;
    const already = await prisma.brainMemory.findUnique({
      where: {
        category_key: { category: "objection_injection_log", key: dedupKey },
      },
      select: { id: true },
    });
    if (already) return null;

    await prisma.brainMemory
      .create({
        data: {
          category: "objection_injection_log",
          key: dedupKey,
          content: JSON.stringify({
            conversationId,
            objectionKey: strong.key,
            surfacedAt: new Date().toISOString(),
          }),
          confidence: 1,
          source: "objection_injector",
          expiresAt: new Date(Date.now() + 7 * 86400_000),
        },
      })
      .catch((err) => {
        logError("brain.objection-injector", err, { fn: "findRelevantObjections.createLog" });
      });

    const meta = (strong.metadata ?? {}) as { severity?: number };
    return {
      key: strong.key,
      // content is "[Sev N · flaw] <objection>" — strip the prefix tag.
      objection: strong.content.replace(/^\[Sev \d(?: · flaw)?\]\s*/, "").slice(0, 320),
      severity: meta.severity ?? 2,
      createdAt: strong.createdAt.toISOString(),
    };
  } catch (err) {
    logError("brain.objection-injector", err, { fn: "findRelevantObjections" });
    return null;
  }
}

/**
 * Prompt block for the chat route. Exported so tests can lock the
 * wording without re-importing the route.
 */
export function buildObjectionBlock(hit: RelevantObjection): string {
  return [
    "## OPEN COUNTER-VIEW (you raised this earlier · Nour has not addressed it)",
    `"${hit.objection}"`,
    "",
    "If the current turn touches the same decision, raise it ONCE, briefly,",
    "woven into your answer — not as a lecture. If the turn is about",
    "something else entirely, stay silent about it.",
  ].join("\n");
}

/** Test helper · clears dedup markers for a conversation. */
export async function clearObjectionLog(conversationId: string): Promise<number> {
  const res = await prisma.brainMemory
    .deleteMany({
      where: {
        category: "objection_injection_log",
        key: { startsWith: `${conversationId}:` },
      },
    })
    .catch(() => ({ count: 0 }));
  return res.count;
}
