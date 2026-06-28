/**
 * dark-psychology-matcher · 2026-06-20.
 *
 * Mirror of greene-message-matcher.ts for the dark-psychology corpus
 * (cognitive biases, manipulation techniques, social engineering patterns,
 * negotiation tactics, competitive intel). For a given user message, picks
 * the TOP 1-3 tactics whose trigger phrases best match what the operator
 * is asking about.
 *
 * Design choices (identical to greene-message-matcher):
 *   · DETERMINISTIC · no AI roundtrip. Keyword match on triggers[] arrays.
 *   · MODULE-CACHED · 10-minute TTL in-memory cache.
 *   · SELF-GATED · returns [] when nothing matches. Zero cost on casual turns.
 *   · BUDGETED OUTPUT · capped at 3 entries · each ~150 chars in the block.
 *
 * Failure mode · returns [] on any error. Silent degradation.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/dark-psychology-matcher");

export interface DarkPsychologyMatch {
  key: string;
  title: string;
  summary: string;
  sourceBook: string;
  score: number;
  hits: string[];
}

interface CorpusEntry {
  key: string;
  title: string;
  summary: string;
  sourceBook: string;
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
      where: {
        category: BRAIN_CATEGORIES.DARK_PSYCHOLOGY,
        deletedAt: null,
      },
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
          sourceBook: String(meta.sourceBook ?? ""),
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
    corpusCache = { rows: [], loadedAt: now };
    return [];
  }
}

/** Allow tests + manual operator commands to drop the cache. */
export function _resetDarkPsychologyCorpusCache(): void {
  corpusCache = null;
}

/**
 * Score the message against the dark-psychology corpus. Returns top 1-3
 * entries whose match count meets the threshold. Empty array if nothing
 * meaningful matches.
 */
export async function pickDarkPsychologyForMessage(
  userMessage: string,
  opts: { maxResults?: number; minScore?: number } = {},
): Promise<DarkPsychologyMatch[]> {
  const maxResults = Math.max(1, Math.min(opts.maxResults ?? 3, 5));
  const minScore = Math.max(1, opts.minScore ?? 2);

  const msg = userMessage.toLowerCase().trim();
  if (msg.length < 12) return [];

  const corpus = await loadCorpus();
  if (corpus.length === 0) return [];

  const scored: DarkPsychologyMatch[] = [];
  for (const entry of corpus) {
    const hits = entry.triggers.filter((t) => msg.includes(t));
    if (hits.length === 0) continue;
    scored.push({
      key: entry.key,
      title: entry.title,
      summary: entry.summary.slice(0, 220),
      sourceBook: entry.sourceBook,
      score: hits.length,
      hits: hits.slice(0, 5),
    });
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (top.score < minScore) return [];

  const picks = scored.slice(0, maxResults);
  void recordDarkPsychologyFire(picks).catch(() => undefined);
  return picks;
}

/**
 * Per-day aggregate write · upserts into BrainMemory(dark_psychology_fire_rate,
 * key=YYYY-MM-DD). Fire-and-forget observability.
 */
async function recordDarkPsychologyFire(
  picks: DarkPsychologyMatch[],
): Promise<void> {
  if (picks.length === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const titles = picks.map((p) => p.title);
  const existing = await prisma.brainMemory.findFirst({
    where: { category: "dark_psychology_fire_rate", key: today },
    select: { id: true, metadata: true },
  });
  if (existing) {
    const meta = (existing.metadata as Record<string, unknown> | null) ?? {};
    const prevCount =
      typeof meta.count === "number" ? (meta.count as number) : 0;
    const prevTopTactics = Array.isArray(meta.topTactics)
      ? (meta.topTactics as string[])
      : [];
    await prisma.brainMemory.update({
      where: { id: existing.id },
      data: {
        content: `${prevCount + 1} fires on ${today}`,
        lastSeen: new Date(),
        metadata: {
          count: prevCount + 1,
          topTactics: [...prevTopTactics, ...titles].slice(-20),
          lastFiredAt: new Date().toISOString(),
        } as never,
      },
    });
  } else {
    await prisma.brainMemory.create({
      data: {
        category: "dark_psychology_fire_rate",
        key: today,
        content: `1 fires on ${today}`,
        confidence: 1,
        source: "lib/ai/dark-psychology-matcher",
        metadata: {
          count: 1,
          topTactics: titles,
          lastFiredAt: new Date().toISOString(),
        } as never,
      },
    });
  }
}

/**
 * Render a compact prompt block from the matches. Returns "" when empty
 * so the caller can safely push the result.
 */
export function renderDarkPsychologyBlock(
  picks: DarkPsychologyMatch[],
): string {
  if (picks.length === 0) return "";
  const lines: string[] = [
    "## TACTICAL FRAME · Dark psychology & influence tactics (contextual picks)",
    "",
    "The operator's message triggers these tactical patterns. Read them as a frame · do NOT lecture the operator · weave the insight in when it changes the answer.",
    "",
  ];
  for (const p of picks) {
    const tagBook = p.sourceBook ? ` · ${p.sourceBook}` : "";
    lines.push(`- **${p.title}**${tagBook} — ${p.summary}`);
  }
  lines.push("");
  lines.push(
    "If the operator asks explicitly, cite the tactic by name. Otherwise, let it shape your tactical emphasis silently.",
  );
  return lines.join("\n");
}
