/**
 * lib/brain/wisdom-suggest.ts · v10.0.526 · Arc B Feature 2 ·
 * At-Write-Time Wisdom Suggestion · ranking + recall.
 *
 * Purpose. While the operator is composing a chat draft or journal
 * entry, surface 1-2 wisdom snippets most relevant to what they're
 * about to send · BEFORE they hit send. The suggestion sits faded
 * ABOVE the composer (NOT a popup, NOT an after-response card · the
 * killed ProactiveInsightCard was both of those · this is a different
 * surface).
 *
 * No new persistence. All inputs already exist:
 *   · BrainMemory(category="wisdom")           the wisdom rows
 *   · vector_embeddings(sourceType="brain_memory")  their embeddings
 *
 * Ranking. cosine(draft, wisdom)
 *                × source-trust weight
 *                × not-recently-shown boost (BrainMemory category=
 *                  "wisdom_shown" rows in the last 24h are dimmed)
 *                × wisdom freshness (auto-distilled cold entries decay)
 *                × dismissedIds penalty (post-dismiss: contributes 0)
 *
 * Why these weights. Buffett / Naval / Munger / Bezos are operator-
 * curated principle-grade entries · they out-rank paraphrased Satori
 * dumps. Greene gets a small favorite-persona bump matching the
 * v10.0.397 contextual-recall convention. The "not shown in 24h" rule
 * exists so the same Munger line doesn't follow the operator around
 * for every keystroke of a long-tail conversation.
 *
 * The recall is a thin, fast layer over the v10.0.361 embedding stack:
 * we re-use cosineSimilarity + vector_embeddings rows · we DO NOT call
 * the heavier contextual-recall.ts pipeline (RRF + CoALA + Cohere
 * rerank) because that's tuned for system-prompt blocks · here we want
 * sub-200ms wire time so the pill never feels laggy as the operator
 * types.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("brain/wisdom-suggest");

export interface WisdomSuggestion {
  id: string;
  text: string;
  source: string;
  similarity: number;
}

// ── source-trust weights ────────────────────────────────────────────
//
// Aligned with contextual-recall.ts (v10.0.354) but TIGHTER · this is
// an attention-stealing surface · we want curated principle-grade
// entries to clearly win.
const SOURCE_TRUST_WEIGHT: Record<string, number> = {
  skill_ingestion: 1.50,
  manual: 1.40,
  user: 1.40,
  consolidation: 1.15,
  output_critic: 1.10,
  wisdom_ingest: 1.10,
  distillation: 1.00,
  "wisdom-distiller": 0.95,
  conversation_analysis: 0.80,
  history_ingestion: 0.80,
  wisdom_sync_cron: 0.65,
  device_analysis: 0.70,
};

function sourceTrustWeight(source: string | null | undefined): number {
  if (!source) return 1.0;
  return SOURCE_TRUST_WEIGHT[source] ?? 1.0;
}

// ── persona signal-keyword boost ────────────────────────────────────
//
// Wisdoms include high-signal personas keyed as `wisdom_<persona>_<n>`.
// We bias toward operator-favored sources: Buffett, Naval, Munger,
// Bezos for principle-grade clarity · Jobs / Greene for tactical
// situations · Satori (paraphrased) gets a small demotion to reflect
// its lower trust. Matches the wider library's tone hierarchy.
function personaBoost(key: string): number {
  if (key.startsWith("wisdom_buffett_")) return 1.20;
  if (key.startsWith("wisdom_naval_")) return 1.20;
  if (key.startsWith("wisdom_munger_")) return 1.18;
  if (key.startsWith("wisdom_bezos_")) return 1.15;
  if (key.startsWith("wisdom_jobs_")) return 1.10;
  if (key.startsWith("wisdom_greene_")) return 1.10;
  if (key.startsWith("wisdom_gates_")) return 1.05;
  if (key.startsWith("wisdom_musk_")) return 1.05;
  if (key.startsWith("wisdom_satori_")) return 0.85;
  return 1.0;
}

// ── recently-shown demotion ─────────────────────────────────────────
//
// BrainMemory(category="wisdom_shown", key=`shown:<wisdomId>`) is
// written by the pill UI when the operator KEEPS the suggestion (i.e.
// doesn't dismiss it · either accepts OR sends the message with it
// still visible). If the same wisdom appears here in the last 24h we
// dim its score so we don't loop the same idea. v10.0.396 in
// contextual-recall calls this "freshness" · we use the same axis but
// keyed at the pill-show level so dismissed wisdoms aren't penalized
// for future drafts.
async function fetchRecentlyShownIds(): Promise<Set<string>> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.WISDOM_SHOWN, updatedAt: { gte: since } },
      select: { key: true },
      take: 200,
    });
    const ids = new Set<string>();
    for (const r of rows) {
      // Stored as "shown:<wisdomId>"
      const m = r.key.match(/^shown:(.+)$/);
      if (m) ids.add(m[1]);
    }
    return ids;
  } catch (err) {
    log.warn("recently_shown_fetch_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return new Set();
  }
}

function recentlyShownPenalty(isRecent: boolean): number {
  // 0.55 strong demotion so a 0.78 cosine sib edges out a 0.85 sib
  // that was already shown today. Operator gets variety.
  return isRecent ? 0.55 : 1.0;
}

// ── main recall ─────────────────────────────────────────────────────

/**
 * Find the top-N wisdom rows most semantically aligned with `draft`.
 * Returns at most `limit` matches above the cosine floor. If the
 * embedding provider is unavailable, the brain has no wisdom rows, or
 * no embeddings exist for them, returns [].
 *
 * Caller is responsible for slicing to 1-2 surface slots · this helper
 * returns up to 5 so the API can filter dismissed ids and still have a
 * fallback.
 */
export async function findRelatedWisdom(
  draft: string,
  limit: number = 5,
): Promise<WisdomSuggestion[]> {
  const trimmed = draft.trim();
  if (trimmed.length < 25) return [];

  const queryVec = await getEmbedding(trimmed.slice(0, 1500));
  if (!Array.isArray(queryVec) || queryVec.length === 0) return [];

  const rawWisdoms = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.WISDOM,
      deletedAt: null,
      confidence: { gte: 0.3 },
    },
    select: {
      id: true,
      key: true,
      content: true,
      source: true,
      confidence: true,
      createdAt: true,
      seenCount: true,
    },
    take: 800, // raised from 600 because the filter below drops noise
  });
  // H.3.2 · filter system-promoted noise. Pre-fix, "[PROMOTED TO WISDOM]
  // Nick advice (2026-04-11): System health: Green ..." was matching as
  // genuine wisdom because category=wisdom is set by both curated
  // ingestion AND a system cron that promotes old Nick replies. Filter
  // by both key prefix and source field · keeps human-curated +
  // distilled wisdom, drops auto-promoted system entries.
  const wisdoms = rawWisdoms.filter((w) => {
    if (!w.content || w.content.length < 20) return false;
    // Reject the visible "[PROMOTED TO WISDOM]" marker
    if (/^\s*\[PROMOTED TO WISDOM\]/i.test(w.content)) return false;
    if (/^\s*\[nick advice\]/i.test(w.content)) return false;
    // Reject system-cron sources that auto-write wisdom rows
    const noisySources = new Set([
      "wisdom_sync_cron",
      "device_analysis",
      "conversation_analysis",
      "history_ingestion",
    ]);
    if (w.source && noisySources.has(w.source)) return false;
    // Reject the nick_advice key prefix · these are operator chat
    // replies promoted into the wisdom corpus by a v9 cron.
    if (w.key && /^(nick_?advice|nickadvice|chat_reply)_/i.test(w.key)) return false;
    return true;
  });
  if (wisdoms.length === 0) return [];

  const ids = wisdoms.map((w) => w.id);
  const embeddingRows = await prisma.vectorEmbedding.findMany({
    where: { sourceType: "brain_memory", sourceId: { in: ids } },
    select: { sourceId: true, embedding: true },
  });
  if (embeddingRows.length < 3) return [];

  // Build id → similarity map. Cosine floor 0.30 matches the
  // skill-recall convention; below that the alignment is noise.
  const SIM_FLOOR = 0.30;
  const simBy = new Map<string, number>();
  for (const r of embeddingRows) {
    try {
      const vec = JSON.parse(r.embedding) as number[];
      if (vec.length !== queryVec.length) continue;
      const sim = cosineSimilarity(queryVec, vec);
      if (sim < SIM_FLOOR) continue;
      simBy.set(r.sourceId, sim);
    } catch (err) {
      logError("brain.wisdom-suggest", err, { fn: "findRelatedWisdom.parseVec", sourceId: r.sourceId });
    }
  }
  if (simBy.size === 0) return [];

  const shownRecently = await fetchRecentlyShownIds();

  const TRUSTED_SOURCES_NO_DECAY = new Set(["skill_ingestion", "manual", "user"]);
  const now = Date.now();

  const scored: WisdomSuggestion[] = [];
  for (const w of wisdoms) {
    const sim = simBy.get(w.id);
    if (sim === undefined) continue;

    // Wisdom freshness · auto-distilled stuff > 90d old with low seen-
    // count gets a soft demotion. Trusted sources are exempt · timeless
    // principles shouldn't decay just because they sat unused.
    let freshness = 1.0;
    if (!TRUSTED_SOURCES_NO_DECAY.has(w.source)) {
      const ageDays = Math.max(0, (now - new Date(w.createdAt).getTime()) / 86_400_000);
      const seenCount = w.seenCount ?? 0;
      if (ageDays > 90 && seenCount < 5) {
        freshness = Math.max(0.7, 1 - (ageDays - 90) * 0.004);
      }
    }

    const trust = sourceTrustWeight(w.source);
    const persona = personaBoost(w.key);
    const recent = recentlyShownPenalty(shownRecently.has(w.id));

    // Final ranking. The cosine carries the heavy lift · everything
    // else is a multiplier in [0.55, 1.50]. A 0.40 cosine entry with
    // perfect trust * persona (~1.80x) still loses to a 0.65 cosine
    // entry with neutral multipliers · we don't want trust to override
    // semantic alignment.
    const rank = sim * trust * persona * freshness * recent;

    scored.push({
      id: w.id,
      text: w.content,
      source: sourceLabel(w.source, w.key),
      similarity: Math.round(rank * 1000) / 1000,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, Math.max(1, Math.min(10, limit)));
}

// Map raw `source` + `key` to a short human label for the pill UI.
function sourceLabel(source: string | null | undefined, key: string): string {
  // Persona keys carry the most useful attribution.
  const m = key.match(/^wisdom_([a-z]+)_/);
  if (m) {
    const persona = m[1];
    // Title-case · single word
    return persona.charAt(0).toUpperCase() + persona.slice(1);
  }
  if (!source) return "wisdom";
  if (source === "skill_ingestion") return "principle";
  if (source === "manual" || source === "user") return "you";
  if (source === "consolidation") return "pattern";
  if (source === "wisdom-distiller") return "distilled";
  return "wisdom";
}

/**
 * Side-effect: mark a wisdom as "shown" so it gets a 24h cooldown on
 * the pill. Called from the API once a suggestion is returned (not
 * when dismissed · dismissal is per-draft and lives client-side via
 * dismissedIds + localStorage).
 *
 * Fire-and-forget · we never let a write error block the pill render.
 */
export async function markWisdomShown(wisdomId: string): Promise<void> {
  try {
    await prisma.brainMemory.upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.WISDOM_SHOWN, key: `shown:${wisdomId}` },
      },
      create: {
        category: BRAIN_CATEGORIES.WISDOM_SHOWN,
        key: `shown:${wisdomId}`,
        content: `pill suggestion shown for wisdom ${wisdomId}`,
        confidence: 0.5,
        source: "wisdom_suggest",
        createdBy: "system",
      },
      update: {
        seenCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    log.warn("mark_shown_failed", {
      wisdomId,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }
}
