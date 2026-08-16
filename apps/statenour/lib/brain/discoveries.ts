/**
 * Discoveries — the delivery half of the creative engines (2026-08-16).
 *
 * The engines were never the problem. `counter-intuitive`, `correlation-finder`,
 * `blind-spot-detector` and `teaching-moments` all run nightly via
 * /api/cron/brain-intelligence and all persist their findings correctly. What
 * was missing is that their output landed in the SAME undifferentiated
 * BrainMemory pool, ranked by `confidence` — which is a re-sighting count
 * (0.5 + 0.1/sighting), not a certainty. Surprise is by definition
 * low-frequency, so a one-off surprising correlation sits at 0.5 forever while
 * a mundane fact re-observed nightly climbs to 1.0 and outranks it. The
 * machine generated the interesting thing and then sorted it below the fold.
 *
 * This module reads those four categories DIRECTLY, on their own terms:
 * ordered by recency (a discovery is news, and news decays), never by the
 * frequency score that structurally penalizes them.
 *
 * It is also where the outcome loop finally closes. Every discovery shown is
 * ledgered via recordShown(); every rating writes recordDecision(). "Already
 * knew" is the single most valuable signal in the system — it is the only
 * measurement of the exact complaint ("it tells me what I already know"), and
 * without it no novelty tuning can ever be justified. See
 * lib/services/outcome-ledger.ts and lib/brain/recall-eval.ts.
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

/** The four categories the nightly creative engines write to. */
export const DISCOVERY_CATEGORIES: readonly string[] = [
  BRAIN_CATEGORIES.COUNTER_INTUITIVE,
  BRAIN_CATEGORIES.HIDDEN_CORRELATION,
  BRAIN_CATEGORIES.BLIND_SPOT,
  BRAIN_CATEGORIES.TEACHING_MOMENT,
];

/**
 * Operator verdicts. Deliberately three, not a thumbs up/down:
 *  · `investigate` — useful AND new. The outcome we are optimizing for.
 *  · `known`       — true, but he already knew it. NOT a defect of accuracy;
 *                    a defect of novelty. This is the signal the novelty axis
 *                    needs and the one nothing in the system could measure.
 *  · `noise`       — not useful. An accuracy/relevance defect.
 * Collapsing `known` and `noise` into one "dismiss" would destroy exactly the
 * distinction that tells us whether to tune ranking or tune generation.
 */
export type DiscoveryVerdict = "investigate" | "known" | "noise";

/** Ledger decisions these map to (OutcomeDecision in outcome-ledger.ts). */
const VERDICT_TO_DECISION: Record<DiscoveryVerdict, "accepted" | "dismissed"> = {
  investigate: "accepted",
  known: "dismissed",
  noise: "dismissed",
};

export interface Discovery {
  id: string;
  category: string;
  key: string;
  content: string;
  source: string;
  createdAt: Date;
  /** Set once the operator has judged it; unrated discoveries surface first. */
  verdict: DiscoveryVerdict | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readVerdict(metadata: unknown): DiscoveryVerdict | null {
  const v = asRecord(metadata).discoveryVerdict;
  return v === "investigate" || v === "known" || v === "noise" ? v : null;
}

export interface ListDiscoveriesResult {
  items: Discovery[];
  /** Unrated count — drives the tab badge and the "nothing new" empty state. */
  unrated: number;
}

/**
 * Recent discoveries, newest first, unrated ones first within that.
 *
 * `deletedAt: null` matters here: the nightly data-cleanup soft-deletes
 * low-confidence rows, and every discovery is born at 0.5 and never reinforced
 * (nothing re-sights a one-off correlation), so this pool is exactly the
 * population most exposed to confidence-based GC.
 */
export async function listDiscoveries(
  opts: { limit?: number; includeRated?: boolean; withinDays?: number } = {},
): Promise<ListDiscoveriesResult> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 12));
  const withinDays = Math.max(1, Math.min(365, opts.withinDays ?? 30));
  const since = new Date(Date.now() - withinDays * 86_400_000);

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: { in: [...DISCOVERY_CATEGORIES] },
      deletedAt: null,
      createdAt: { gte: since },
    },
    // Recency, NOT confidence — see the module header. Ordering these by
    // confidence would reproduce the exact bias this surface exists to undo.
    orderBy: { createdAt: "desc" },
    take: limit * 3,
    select: {
      id: true,
      category: true,
      key: true,
      content: true,
      source: true,
      createdAt: true,
      metadata: true,
    },
  });

  const all: Discovery[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    key: r.key,
    content: r.content,
    source: r.source,
    createdAt: r.createdAt,
    verdict: readVerdict(r.metadata),
  }));

  const unrated = all.filter((d) => d.verdict === null);
  const items = opts.includeRated
    ? [...unrated, ...all.filter((d) => d.verdict !== null)].slice(0, limit)
    : unrated.slice(0, limit);

  return { items, unrated: unrated.length };
}

/**
 * Record the operator's verdict on a discovery.
 *
 * Writes in two places on purpose:
 *  1. The row's own metadata, so a judged discovery stops resurfacing.
 *  2. The IntelligenceOutcome ledger, so the judgement becomes a real
 *     correction case. `outcomesNeedingReview()` harvests dismissed rows into
 *     recall-eval fixtures — that query returned zero rows for the table's
 *     entire life because nothing ever set `decision`.
 *
 * The ledger write is best-effort: a judgement the operator made must never
 * be lost because a bookkeeping row failed.
 */
export async function rateDiscovery(
  id: string,
  verdict: DiscoveryVerdict,
): Promise<{ ok: boolean }> {
  const row = await prisma.brainMemory.findUnique({
    where: { id },
    select: { id: true, content: true, category: true, metadata: true, deletedAt: true },
  });
  if (!row || row.deletedAt) return { ok: false };
  if (!DISCOVERY_CATEGORIES.includes(row.category)) return { ok: false };

  await prisma.brainMemory.update({
    where: { id },
    data: {
      metadata: {
        ...asRecord(row.metadata),
        discoveryVerdict: verdict,
        discoveryRatedAt: new Date().toISOString(),
      } as never,
    },
  });

  try {
    const { recordShown, recordDecision } = await import("@/lib/services/outcome-ledger");
    // recordShown is idempotent within 24h on the content hash, so this is
    // safe whether or not the list view already ledgered it — and it
    // guarantees a row exists to decide on even if the operator rated from a
    // surface that never listed it.
    const ledgerId = await recordShown({
      kind: "suggestion",
      sourceEngine: `discovery:${row.category}`,
      summary: row.content,
      shownSurface: "brain-discover",
    });
    if (ledgerId) {
      await recordDecision({
        id: ledgerId,
        decision: VERDICT_TO_DECISION[verdict],
        resultRef: `discovery_verdict:${verdict}`,
      });
    }
  } catch (err) {
    logError("brain.discoveries", err, { stage: "ledger", id, verdict }, "warn");
  }

  return { ok: true };
}
