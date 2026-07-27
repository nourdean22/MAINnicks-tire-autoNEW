/**
 * greene-message-matcher · Wave AH Phase 1 · 2026-05-28.
 *
 * The bridge between the Wave Z corpus (~144 Robert Greene entries
 * seeded into BrainMemory(category=greene_law)) and the chat system
 * prompt. For a given user message, picks the TOP 1-3 laws whose
 * trigger phrases best match what the operator is asking about.
 *
 * Sam audit identified this as one of the 6 underused assets: the
 * full 48 Laws + Mastery + Laws of Human Nature + Art of Seduction +
 * 33 Strategies are sitting in BrainMemory but only consumed by the
 * /relationships per-person sidebar. Every chat turn about strategy,
 * power dynamics, decisions, leverage, or relationships SHOULD have
 * Nick reaching into the corpus · this wire makes that real.
 *
 * Design choices ·
 *   · DETERMINISTIC · no AI roundtrip on the chat hot path. Keyword
 *     match on the metadata.triggers[] arrays. Sub-millisecond once
 *     the corpus is loaded.
 *   · MODULE-CACHED · the corpus rarely changes (seeded once, refreshed
 *     manually) · keep an in-memory cache with a 10-minute TTL.
 *   · SELF-GATED · returns [] when no candidate scores above threshold.
 *     The caller (system-prompt orchestrator) appends nothing when
 *     the matcher returns empty · zero cost for casual chat turns.
 *   · BUDGETED OUTPUT · capped at 3 laws · each ~150 chars in the
 *     rendered block. Total injection < 600 chars · negligible vs
 *     the prompt's ~30K baseline.
 *
 * Failure mode · returns [] on any error. Telegram alert / brain
 * memory write of the failure is the caller's responsibility (we want
 * silent degradation, not noisy retries).
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/greene-message-matcher");

export interface GreeneMatch {
  key: string;
  title: string;
  summary: string;
  book: string;
  score: number;
  /** The specific trigger phrases that matched. Operator-grade debug. */
  hits: string[];
  /** AG-14 · concrete moves from the corpus metadata.actions[] — the
   *  render block turns these into "→ move:" lines so the frame is
   *  directive counsel, not just contemplative context. Optional:
   *  the picker always populates it, external constructors may not. */
  actions?: string[];
  /** AG-31 · how the pick was found. 'trigger' = deterministic keyword
   *  hit (default); 'vector' = cosine fallback for paraphrases that no
   *  literal trigger matched. */
  source?: "trigger" | "vector";
}

interface CorpusEntry {
  key: string;
  title: string;
  summary: string;
  book: string;
  /** Lowercased phrases for fast match · `metadata.matchPhrases` when the
   *  entry carries them, else `metadata.triggers` (see loadCorpus). */
  triggers: string[];
  /** Concrete next moves (verbatim corpus text · rendered, not matched). */
  actions: string[];
}

const TEN_MIN_MS = 10 * 60 * 1000;
let corpusCache: { rows: CorpusEntry[]; loadedAt: number } | null = null;

async function loadCorpus(): Promise<CorpusEntry[]> {
  const now = Date.now();
  if (corpusCache && now - corpusCache.loadedAt < TEN_MIN_MS) {
    return corpusCache.rows;
  }
  try {
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.GREENE_LAW, deletedAt: null },
      select: { key: true, metadata: true },
      take: 250,
    });
    const entries: CorpusEntry[] = rows
      .map((r) => {
        const meta = (r.metadata as Record<string, unknown> | null) ?? {};
        // 2026-07-27 · prefer `matchPhrases` over `triggers` for the
        // literal-substring scoring below. `triggers` are analyst-facing
        // condition sentences authored for the digest cron's AI
        // applicability check ("person.power_balance > +0.4 (operator
        // weaker)") — scoring `msg.includes(t)` against them can only hit
        // by accident, so entries without matchPhrases have always fallen
        // through to the AG-31 vector path regardless of relevance.
        // Entries that carry matchPhrases score on real operator language.
        // Fallback keeps the 144 legacy entries byte-identical in behavior.
        const rawPhrases = Array.isArray(meta.matchPhrases)
          ? (meta.matchPhrases as unknown[])
          : Array.isArray(meta.triggers)
            ? (meta.triggers as unknown[])
            : [];
        const triggers = rawPhrases
          .filter((t): t is string => typeof t === "string" && t.length > 0)
          .map((t) => t.toLowerCase());
        const actions = Array.isArray(meta.actions)
          ? (meta.actions as unknown[]).filter(
              (a): a is string => typeof a === "string" && a.length > 0,
            )
          : [];
        return {
          key: r.key,
          title: String(meta.title ?? r.key),
          summary: String(meta.summary ?? ""),
          book: String(meta.book ?? ""),
          triggers,
          actions,
        };
      })
      .filter((e) => e.triggers.length > 0);
    corpusCache = { rows: entries, loadedAt: now };
    return entries;
  } catch (err) {
    log.warn("corpus_load_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    // Empty cache for the failed load · prevents thrash. TTL still
    // applies so the next attempt waits 10min.
    corpusCache = { rows: [], loadedAt: now };
    return [];
  }
}

/**
 * Allow tests + manual operator commands to drop the cache.
 */
export function _resetGreeneCorpusCache(): void {
  corpusCache = null;
}

/**
 * Score the message against the corpus. Returns top 1-3 entries
 * whose match count meets the threshold. Empty array if nothing
 * meaningful matches · the caller appends NOTHING to the prompt.
 *
 * Scoring · count distinct triggers that appear as substrings in the
 * lowercased message. A multi-word trigger counts as 1 hit (we don't
 * weight by length · short triggers like "power" are common enough
 * that a 2-trigger overlap is usually meaningful).
 */
export async function pickContextualLawsForMessage(
  userMessage: string,
  opts: { maxLaws?: number; minScore?: number; userEmbedding?: number[] } = {},
): Promise<GreeneMatch[]> {
  const maxLaws = Math.max(1, Math.min(opts.maxLaws ?? 3, 5));
  const minScore = Math.max(1, opts.minScore ?? 2);

  const msg = userMessage.toLowerCase().trim();
  if (msg.length < 12) return []; // too short to meaningfully match · skip

  const corpus = await loadCorpus();
  if (corpus.length === 0) return [];

  const scored: GreeneMatch[] = [];
  for (const entry of corpus) {
    const hits = entry.triggers.filter((t) => msg.includes(t));
    if (hits.length === 0) continue;
    scored.push({
      key: entry.key,
      title: entry.title,
      summary: entry.summary.slice(0, 220),
      book: entry.book,
      score: hits.length,
      hits: hits.slice(0, 5),
      actions: entry.actions.slice(0, 2),
      source: "trigger",
    });
  }

  const triggerMiss = scored.length === 0 || scored.toSorted((a, b) => b.score - a.score)[0].score < minScore;

  // AG-31 · vector fallback. Trigger matching misses paraphrase ("he
  // keeps one-upping me" won't hit "outshine") and minScore 2 means most
  // strategy turns retrieve nothing from the actions-bearing corpus. When
  // the caller passes a precomputed userEmbedding (brain-context has one
  // for free) and triggers miss, cosine the greene_law embeddings
  // (populated by the embed-backfill cron) — deterministic path stays
  // primary; vector fires only on the miss path.
  if (triggerMiss && (opts.userEmbedding?.length ?? 0) > 0) {
    const vectorPicks = await vectorFallback(opts.userEmbedding as number[], corpus, maxLaws);
    if (vectorPicks.length > 0) {
      void recordGreeneFire(vectorPicks).catch(() => undefined);
      return vectorPicks;
    }
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top.score < minScore) return [];

  const picks = scored.slice(0, maxLaws);
  // Wave AK · 2026-05-28 · observability · per-day fire-rate aggregate.
  // Operator audit caught: "Wave AH Greene wire has ZERO operator-visible
  // signal · could be broken, could be working, can't tell." This records
  // a daily fire count + the top laws so /system/calibration (or a SQL
  // query) can confirm the corpus is actually firing across real chat
  // turns. Fire-and-forget · matcher failure path stays silent.
  void recordGreeneFire(picks).catch(() => undefined);
  return picks;
}

const VECTOR_SIMILARITY_FLOOR = 0.3;

/** AG-31 · cosine the user's embedding against the greene_law vector
 *  namespace and map hits back to corpus entries. Empty on any failure
 *  or when no embeddings exist yet (the backfill cron populates them). */
async function vectorFallback(
  userVec: number[],
  corpus: CorpusEntry[],
  maxLaws: number,
): Promise<GreeneMatch[]> {
  try {
    const rows = await prisma.vectorEmbedding.findMany({
      where: { sourceType: "greene_law" },
      select: { sourceId: true, embedding: true },
    });
    if (rows.length === 0) return [];
    const { cosineSimilarity } = await import("@/lib/brain/embedding-utils");
    const byKey = new Map(corpus.map((c) => [c.key, c]));
    const scored: Array<{ entry: CorpusEntry; sim: number }> = [];
    for (const r of rows) {
      const entry = byKey.get(r.sourceId);
      if (!entry) continue;
      try {
        const vec = JSON.parse(r.embedding) as number[];
        if (vec.length !== userVec.length) continue;
        const sim = cosineSimilarity(userVec, vec);
        if (sim < VECTOR_SIMILARITY_FLOOR) continue;
        scored.push({ entry, sim });
      } catch {
        // malformed row — skip
      }
    }
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, maxLaws).map(({ entry, sim }) => ({
      key: entry.key,
      title: entry.title,
      summary: entry.summary.slice(0, 220),
      book: entry.book,
      score: Math.round(sim * 100) / 100,
      hits: [],
      actions: entry.actions.slice(0, 2),
      source: "vector" as const,
    }));
  } catch (err) {
    log.warn("vector_fallback_failed", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return [];
  }
}

/**
 * Per-day aggregate write · upserts into BrainMemory(GREENE_FIRE_RATE,
 * key=YYYY-MM-DD). Increments count + appends top-law titles. Cheap
 * enough to fire from the chat hot path (one upsert per matched turn).
 * Failure is silent · this is observability, not correctness.
 */
async function recordGreeneFire(picks: GreeneMatch[]): Promise<void> {
  if (picks.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const titles = picks.map((p) => p.title);
  const existing = await prisma.brainMemory.findFirst({
    where: { category: "greene_fire_rate", key: today },
    select: { id: true, metadata: true },
  });
  if (existing) {
    const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
    const prevCount =
      typeof meta.count === "number" ? (meta.count as number) : 0;
    const prevTopLaws = Array.isArray(meta.topLaws)
      ? (meta.topLaws as string[])
      : [];
    await prisma.brainMemory.update({
      where: { id: existing.id },
      data: {
        content: `${prevCount + 1} fires on ${today}`,
        lastSeen: new Date(),
        metadata: {
          count: prevCount + 1,
          topLaws: [...prevTopLaws, ...titles].slice(-20),
          lastFiredAt: new Date().toISOString(),
        } as never,
      },
    });
  } else {
    await prisma.brainMemory.create({
      data: {
        category: "greene_fire_rate",
        key: today,
        content: `1 fires on ${today}`,
        confidence: 1,
        source: "lib/ai/greene-message-matcher",
        metadata: {
          count: 1,
          topLaws: titles,
          lastFiredAt: new Date().toISOString(),
        } as never,
      },
    });
  }
}

/**
 * Render a compact prompt block from the matches. Returns "" when
 * picks is empty so the caller can safely `p.push(renderGreeneBlock(...))`.
 *
 * The block is tagged + gold-edged in language so the model uses it
 * as a strategy frame, not a generic content quote.
 */
export function renderGreeneBlock(picks: GreeneMatch[]): string {
  if (picks.length === 0) return "";
  const lines: string[] = [
    "## STRATEGY FRAME · Robert Greene corpus (contextual picks)",
    "",
    "The operator's message triggers these laws/strategies from the corpus. Read them as a frame · do NOT lecture the operator about them · weave the insight in when it changes the answer.",
    "",
  ];
  for (const p of picks) {
    const tagBook = p.book ? ` · ${p.book}` : "";
    lines.push(`- **${p.title}**${tagBook} — ${p.summary}`);
    // AG-14 · the corpus carries machine-usable actions[] that the old
    // render dropped — the frame was contemplative, never directive.
    // Defensive ?? [] — older callers construct matches without actions.
    for (const move of p.actions ?? []) {
      lines.push(`  → move: ${move}`);
    }
  }
  lines.push("");
  lines.push(
    "If the operator asks for a Greene-shaped answer explicitly, cite the law by name. Otherwise, let it shape your strategic emphasis silently. When a '→ move' fits the situation, offer it as the concrete next step.",
  );
  return lines.join("\n");
}
