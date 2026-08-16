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

/**
 * Ledger decisions these map to (OutcomeDecision in outcome-ledger.ts).
 *
 * `known` is deliberately NOT "dismissed" (review fix, 2026-08-16). Every
 * harvester selects correction cases with
 * `OR: [{ decision: "dismissed" }, { outcomeUseful: false }]` —
 * outcomesNeedingReview(), recall-corpus-builder.ts:197 and
 * export-eval-datasets.ts:35 — and NONE of them reads `resultRef`. Mapping
 * "already knew" to dismissed would therefore harvest a claim the operator
 * confirmed TRUE as though it had been wrong, poisoning the accuracy corpus
 * with the one signal that is not about accuracy at all.
 *
 * "already knew" is a NOVELTY defect, not an accuracy defect. `ignored`
 * records that it was surfaced and not acted on without asserting it was
 * incorrect, and keeps it out of every correction harvest. The novelty signal
 * itself lives in `resultRef` (`discovery_verdict:known`). Nothing consumes
 * that yet, and that is the honest state: this wave built the measurement,
 * not a consumer for it.
 */
const VERDICT_TO_DECISION: Record<DiscoveryVerdict, "accepted" | "dismissed" | "ignored"> = {
  investigate: "accepted",
  known: "ignored",
  noise: "dismissed",
};

export interface Discovery {
  id: string;
  category: string;
  key: string;
  content: string;
  source: string;
  createdAt: Date;
  /** When an engine last wrote this row. The recency axis — see listDiscoveries. */
  lastSeen: Date;
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
  /**
   * Unrated count among the rows actually scanned — drives the tab badge and
   * the "nothing new" empty state. When `truncated` is true this is a FLOOR,
   * not a total: the scan stopped at MAX_SCAN or once `limit` unrated rows
   * were in hand. Reported rather than silently capped.
   */
  unrated: number;
  /** Rows examined this call. */
  scanned: number;
  /** True when the scan stopped early — `unrated` is then a lower bound. */
  truncated: boolean;
}

/** Hard ceiling on rows scanned per call. Surfaced in the result, never silent. */
const MAX_SCAN = 300;
const PAGE = 60;

/**
 * Recent discoveries, newest first, unrated ones first within that.
 *
 * `deletedAt: null` matters here — but NOT for the reason first written. The
 * original note claimed these rows were the population most exposed to
 * confidence-based GC because they are "born at 0.5 and never reinforced".
 * Both halves were wrong: pruneNoise gates on confidence < 0.1, well below
 * 0.5, and two of the four engines DO reinforce (stable keys, see below). The
 * real soft-delete producer is the nightly consolidate cron's merge stage —
 * none of the four discovery categories is in CONSOLIDATION_EXCLUDE_CATEGORIES,
 * so a merged duplicate loses every non-keeper row.
 */
export async function listDiscoveries(
  opts: { limit?: number; includeRated?: boolean; withinDays?: number } = {},
): Promise<ListDiscoveriesResult> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 12));
  const withinDays = Math.max(1, Math.min(365, opts.withinDays ?? 30));
  const since = new Date(Date.now() - withinDays * 86_400_000);

  const unrated: Discovery[] = [];
  const rated: Discovery[] = [];
  let scanned = 0;
  let truncated = false;

  // Page rather than taking `limit * 3` once (review fix, 2026-08-16). The
  // verdict lives in a jsonb blob, so it cannot be filtered in the query
  // without brittle path-null semantics — and filtering AFTER a single fixed
  // take meant that once `limit * 3` NEWER discoveries had been judged, every
  // older unjudged one fell outside the window. The feed would report
  // `items: []` and `unrated: 0` — rendering "Nothing new to judge" — while
  // pending work sat just past the cut.
  for (let skip = 0; skip < MAX_SCAN; skip += PAGE) {
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: { in: [...DISCOVERY_CATEGORIES] },
        deletedAt: null,
        // lastSeen, NOT createdAt (review fix). correlation-finder writes the
        // stable key `corr_<a>_<b>` and teaching-moments a stable domain/topic
        // key, so a re-run goes through remember() -> reinforce(), which
        // refreshes content and lastSeen but NEVER createdAt. Filtering on
        // createdAt permanently hid those two engines once their original row
        // aged past the window, however fresh the finding was.
        lastSeen: { gte: since },
      },
      // Recency, NOT confidence — see the module header. Ordering by
      // confidence would reproduce the exact bias this surface exists to undo.
      orderBy: { lastSeen: "desc" },
      skip,
      take: PAGE,
      select: {
        id: true,
        category: true,
        key: true,
        content: true,
        source: true,
        createdAt: true,
        lastSeen: true,
        metadata: true,
      },
    });
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const r of rows) {
      const d: Discovery = {
        id: r.id,
        category: r.category,
        key: r.key,
        content: r.content,
        source: r.source,
        createdAt: r.createdAt,
        lastSeen: r.lastSeen,
        verdict: readVerdict(r.metadata),
      };
      (d.verdict === null ? unrated : rated).push(d);
    }

    // Ran out of rows inside the window — the counts below are exact.
    if (rows.length < PAGE) break;

    // Enough to show. Stop, but say so: `unrated` is now a floor.
    if (!opts.includeRated && unrated.length >= limit) {
      truncated = true;
      break;
    }
    if (skip + PAGE >= MAX_SCAN) truncated = true;
  }

  const items = opts.includeRated
    ? [...unrated, ...rated].slice(0, limit)
    : unrated.slice(0, limit);

  return { items, unrated: unrated.length, scanned, truncated };
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
