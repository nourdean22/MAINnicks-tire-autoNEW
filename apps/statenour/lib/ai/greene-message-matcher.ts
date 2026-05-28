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
}

interface CorpusEntry {
  key: string;
  title: string;
  summary: string;
  book: string;
  /** Lowercased trigger phrases for fast match. */
  triggers: string[];
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
        const triggers = Array.isArray(meta.triggers)
          ? (meta.triggers as unknown[])
              .filter((t): t is string => typeof t === "string" && t.length > 0)
              .map((t) => t.toLowerCase())
          : [];
        return {
          key: r.key,
          title: String(meta.title ?? r.key),
          summary: String(meta.summary ?? ""),
          book: String(meta.book ?? ""),
          triggers,
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
  opts: { maxLaws?: number; minScore?: number } = {},
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
    });
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top.score < minScore) return [];

  return scored.slice(0, maxLaws);
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
  }
  lines.push("");
  lines.push(
    "If the operator asks for a Greene-shaped answer explicitly, cite the law by name. Otherwise, let it shape your strategic emphasis silently.",
  );
  return lines.join("\n");
}
