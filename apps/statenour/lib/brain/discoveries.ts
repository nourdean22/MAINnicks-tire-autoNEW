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
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

/**
 * The four categories the nightly creative engines write to.
 *
 * ⚠ COUPLED TO A PARTIAL INDEX. `brain_memories_discovery_scoped_idx`
 * (migrations-pending/20260823010000) hardcodes these four literals in its
 * WHERE clause. Adding a fifth engine here WITHOUT extending that predicate
 * silently un-indexes the exact-count query below: `category = ANY(...)` would
 * no longer imply the index predicate, and the count falls back to a bitmap
 * scan over ~93k live rows. Measured fallback cost: 394 buffers / 0.976 ms
 * versus 118 / 0.243 ms. Slow rather than wrong — which is why it needs a
 * comment: nothing will fail.
 */
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
 * incorrect, and keeps it out of every correction harvest.
 *
 * 2026-08-28 · WHAT A `known` VERDICT NOW DOES (this comment used to end
 * "nothing consumes that yet", and was quoted three times as proof the loop
 * was open — it had outlived its own truth by one wave):
 *   · suppresses the whole cluster from the feed, AND the twins the nightly
 *     engines regenerate — the judged-identity join in listDiscoveries()
 *     below, which binds on cluster identity with no lastSeen floor.
 *   · removes the spot from Nick's LIVE surfaces — filterJudgedBlindSpots()
 *     in blind-spot-identity.ts, consumed by the getBlindSpots AI tool and
 *     lib/services/ultron-situation.ts.
 *   · is reported back to the operator at tap time — describeJudgeOutcome()
 *     in lib/brain/discover-feedback.ts ("suppressed N similar").
 * Receipts and the AFTER numbers: docs/LEARNING-LOOPS-2026-08-28.md.
 *
 * STILL UNCONSUMED, deliberately: the ledger's `resultRef`
 * (`discovery_verdict:known`) — the per-event novelty TRACE. The behaviour
 * above reads the verdict COLUMN / metadata, which is the durable source of
 * truth; resultRef would only be needed to analyse novelty over TIME (e.g.
 * "is the operator's already-knew rate falling?"), and nothing asks that yet.
 * Named rather than quietly deleted, so the gap stays auditable.
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
  /**
   * Every row id this card stands for, itself included. One tap rates all of
   * them — see the clustering note on listDiscoveries.
   */
  clusterIds: string[];
  /**
   * How this row got here. `engine` — a nightly creative engine wrote it.
   * `restored` — scripts/restore-orphaned-memories.ts recreated it on
   * 2026-08-16 from a surviving embedding, which means its createdAt/lastSeen
   * are RESTORE time, not discovery time. The feed's headline claim ("what the
   * nightly engines found") is false for a restored row, so the UI has to be
   * able to say which it is showing.
   */
  provenance: "engine" | "restored";
  /**
   * Prior verdicts, present only on a card that came back after escalating.
   * Empty for everything else. Written by lib/brain/blind-spot-identity.ts.
   */
  verdictHistory: Array<{ verdict: string; at: string; severityRank: number }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isVerdict(v: unknown): v is DiscoveryVerdict {
  return v === "investigate" || v === "known" || v === "noise";
}

/**
 * Column first, `metadata` as the fallback.
 *
 * The column arrived in 20260823000000_brain_memory_discovery_columns and is
 * dual-written from this wave on, but `metadata` remains the source of truth
 * and the only thing code deployed BEFORE that migration writes. Reading both
 * is what lets the old and new deployments overlap without a row judged by
 * either one reading as unjudged.
 */
function readVerdict(metadata: unknown, column?: string | null): DiscoveryVerdict | null {
  // An explicitly PRESENT metadata key wins — including an explicit `null`.
  // Column-first was wrong in one direction that matters: during a rollback or
  // a migration-first deploy window, the prior app clears
  // metadata.discoveryVerdict on a resurface without clearing the newly added
  // column, and a column-first read then lets the stale `noise` mirror win
  // permanently — the spot stays suppressed even though the source of truth
  // resurfaced it. `metadata` is the source; the column is the mirror, and a
  // mirror is only consulted where the source says nothing at all.
  const meta = asRecord(metadata);
  if ("discoveryVerdict" in meta) {
    return isVerdict(meta.discoveryVerdict) ? meta.discoveryVerdict : null;
  }
  return isVerdict(column) ? column : null;
}

/**
 * Rows recreated by scripts/restore-orphaned-memories.ts carry
 * `metadata.origin = "orphan-restore-<date>"`. Matched on the PREFIX so a
 * future recovery run is classified without editing this predicate.
 */
function readProvenance(metadata: unknown, column?: string | null): "engine" | "restored" {
  // "restored" wins from EITHER source, deliberately asymmetric. Column-first
  // in both directions would let a row already stamped `engine` ignore a later
  // `metadata.origin`, and showing a restored row as engine-found is the defect
  // this field exists to prevent — whereas withholding one extra row is
  // visible, counted and reversible by a toggle.
  const origin = asRecord(metadata).origin;
  if (typeof origin === "string" && origin.startsWith("orphan-restore")) return "restored";
  if (column === "restored") return "restored";
  return "engine";
}

function readVerdictHistory(
  metadata: unknown,
): Array<{ verdict: string; at: string; severityRank: number }> {
  const raw = asRecord(metadata).discoveryVerdictHistory;
  return Array.isArray(raw) ? (raw as Array<{ verdict: string; at: string; severityRank: number }>) : [];
}

/**
 * The severity tier encoded in a card's text, as an ordinal.
 *
 * Mirrors the ORDERING of SEVERITY_RANK in lib/brain/blind-spot-identity.ts —
 * there is no `severityRankOf` there to import, only the rank table. Kept local
 * so this module, which serves four engines of which only one writes a tier,
 * takes no dependency on the blind-spot module. Returns null for the three
 * engines that write no tier, which shouldResurface() treats as "never
 * auto-resurface".
 */
export function severityRankOf(content: string): number | null {
  const tag = content.match(/^\[([A-Z]+)\]/)?.[1];
  const rank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return tag && tag in rank ? rank[tag] : null;
}

/**
 * What makes two cards THE SAME QUESTION for the operator.
 *
 * Strips the `[SEVERITY]` prefix (the same finding can be re-emitted a tier
 * higher), then collapses a LEADING digit run ONLY.
 *
 * The leading-only restriction is load-bearing, not a detail. Collapsing every
 * digit run — as the first version did — merges `Open loop untouched: "Order 4
 * winter tires"` with `"Order 6 winter tires"`, which are different tasks. One
 * tap here rates every row behind the card, so an over-merge is silent data
 * loss: the operator never sees the second task and a single "Noise" suppresses
 * both. The moving counts that motivated normalising at all
 * (`9 decisions awaiting review`) all sit at position 0; operator prose does
 * not. Caught in adversarial review before ship.
 *
 * This is the SAME normalisation as blindSpotIdentity(), and that coupling is
 * real: a cluster that disagreed with the stable key would rate rows that then
 * diverge. tests/brain/discoveries.test.ts pins the two functions against each
 * other rather than leaving the agreement to a comment.
 */
export function clusterKey(content: string): string {
  return content
    .replace(/^\[[A-Z]+\]\s*/, "")
    .toLowerCase()
    .replace(/^\d+/, "#")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ListDiscoveriesResult {
  items: Discovery[];
  /**
   * Unrated rows in the window — drives the tab badge and the "nothing new"
   * empty state. An EXACT count, straight from the scoped SQL below (see the
   * `countRows` query and its comment), and therefore never a floor: it is
   * unaffected by where the card scan stopped.
   *
   * It used to be derived from the bounded scan, and this docstring described
   * it as a lower bound whenever `truncated` was set. That stopped being true
   * on 2026-08-22 when the count moved to SQL — and the `truncated` docstring
   * twelve lines down has said so ever since, so the two contradicted each
   * other inside the same interface. A consumer who believed this half
   * appended "+" to an exact number, which is verbatim the defect (56 rendered
   * against a true 242) this surface was rebuilt to remove.
   * `unratedClusters` and `suppressedSimilar` are the bounded ones; these two
   * are not.
   */
  unrated: number;
  /**
   * Distinct QUESTIONS behind `unrated` — the number of taps actually needed.
   * `unrated` counts rows; one tap now rates a whole cluster, so quoting rows
   * as the workload overstates it. This one IS bounded by the card scan, so it
   * is a floor whenever `truncated` is true — unlike `unrated`.
   */
  unratedClusters: number;
  /** Rows examined this call. */
  scanned: number;
  /**
   * True when the CARD scan stopped early — `items` is then a partial page.
   *
   * Scoped to `items` ONLY since 2026-08-22. `unrated` and `restoredHidden` are
   * exact SQL counts and are never floors, so a consumer that appends "+" to
   * them on this flag turns an exact 242 into "242+". The card list is the only
   * thing this bounds.
   */
  truncated: boolean;
  /**
   * Unrated rows withheld because they are restored, not engine-found. Named
   * and counted rather than silently dropped — the operator's data stays his,
   * and a hidden pile that nothing reports is how 237 rows became invisible in
   * the first place. EXACT, never a floor.
   */
  restoredHidden: number;
  /**
   * 2026-08-28 · learning-loops wave. Unrated rows withheld because a row with
   * the SAME cluster identity already carries a `known`/`noise` verdict — a
   * regenerated twin (a fresh clock key, or a row reinforced back into the
   * window after its judged sibling aged out). The judged set is fetched with
   * NO lastSeen floor and tombstones INCLUDED (a tombstone does not unmake a
   * judgement), so a verdict binds forever. Counted, never silent — an
   * invisible effect is indistinguishable from no effect. Bounded by the card
   * scan: a floor whenever `truncated` is true.
   *
   * EXCLUDES rows the recurrence policy deliberately resurfaced (non-empty
   * `verdictHistory`). Those are not regenerated twins, and counting them here
   * described an escalation as a duplicate — see the exemption in the filter.
   */
  suppressedSimilar: number;
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
 *
 * 2026-08-22 · CLUSTER-AND-ASK-ONCE, and why NOT uncertainty ranking.
 *
 * Measured on prod: 242 unrated rows in the window, 191 distinct contents, and
 * an all-time operator label count of FIVE. That is squarely the low-budget
 * regime, where Hacohen et al. (arXiv:2202.02794) found a phase transition —
 * "typical examples are best queried when the budget is low… unrepresentative
 * examples are best queried when the budget is large" (TypiClust: 93.2% on
 * CIFAR-10 from 10 labels, +39.4% over random). Ranking by uncertainty or
 * information gain is the LOSING strategy at this budget, so this deliberately
 * does not do it.
 *
 * Instead: collapse rows that ask the same question into one card, and order
 * the cards by cluster SIZE — the most representative question first — tie
 * broken by recency. Rows are still FETCHED newest-first, so the invariant
 * this module exists for (recency, never `confidence`) is untouched; typicality
 * only decides which of the surviving cards to ask about first.
 *
 * `limit` counts CARDS, not rows: the operator's budget is taps, not records.
 */
export async function listDiscoveries(
  opts: {
    limit?: number;
    includeRated?: boolean;
    withinDays?: number;
    includeRestored?: boolean;
  } = {},
): Promise<ListDiscoveriesResult> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 12));
  const withinDays = Math.max(1, Math.min(365, opts.withinDays ?? 30));
  const since = new Date(Date.now() - withinDays * 86_400_000);

  const unrated: Discovery[] = [];
  const rated: Discovery[] = [];
  let scanned = 0;
  let truncated = false;
  let restoredHidden = 0;
  let suppressedSimilar = 0;

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
        discoveryVerdict: true,
        discoveryProvenance: true,
      },
    });
    if (rows.length === 0) break;
    scanned += rows.length;

    for (const r of rows) {
      const provenance = readProvenance(r.metadata, r.discoveryProvenance);
      const verdict = readVerdict(r.metadata, r.discoveryVerdict);
      if (provenance === "restored" && !opts.includeRestored) {
        // Withheld, never deleted — it is the operator's recovered data. Only
        // UNRATED restored rows count as hidden work; a judged one is done.
        if (verdict === null) restoredHidden++;
        continue;
      }
      const d: Discovery = {
        id: r.id,
        category: r.category,
        key: r.key,
        content: r.content,
        source: r.source,
        createdAt: r.createdAt,
        lastSeen: r.lastSeen,
        verdict,
        clusterIds: [r.id],
        provenance,
        verdictHistory: readVerdictHistory(r.metadata),
      };
      (d.verdict === null ? unrated : rated).push(d);
    }

    // Ran out of rows inside the window — the counts below are exact.
    if (rows.length < PAGE) break;

    // Enough to show. Stop, but say so: `unrated` is now a floor.
    //
    // Counts CLUSTERS, not rows. Breaking at `unrated.length >= limit` would
    // stop after 12 rows that might collapse to a single card, handing the UI
    // one card when it asked for twelve — the same shortfall the paging fix
    // above exists to prevent, one level up.
    if (!opts.includeRated && countClusters(unrated) >= limit) {
      truncated = true;
      break;
    }
    // MAX_SCAN reached. Only a FULL final page means rows may lie past it —
    // a short page proved the window was exhausted and nothing was missed.
    // Asserting truncation on a complete scan makes the badge read `12+` and
    // the caption claim a floor when both numbers are exact.
    if (skip + PAGE >= MAX_SCAN && rows.length === PAGE) truncated = true;
  }

  // Judged-identity suppression (learning-loops wave 2026-08-28, gap 3):
  // an unrated row whose cluster identity already carries a known/noise
  // verdict is a regenerated twin — withheld and COUNTED, never silent.
  // The judged set is fetched with NO lastSeen floor (a verdict older than
  // the window must still bind the twin regenerated today) and no deletedAt
  // filter (a tombstone does not unmake a judgement). The column arm is
  // Prisma-filterable; the metadata arm is OVERFETCHED and re-checked with
  // readVerdict in JS, because (a) a resurface writes an EXPLICIT metadata
  // null that must override a stale column (the mirror-must-never-outrank-
  // the-source rule), and (b) Prisma JSON-path negations drop rows lacking
  // the key (the 1-of-241 trap documented above). Population is tiny — 10
  // verdicts all-time on prod — the take is a safety bound, not a page.
  // Runs AFTER the scan so the cluster-count break above is unaffected;
  // when the scan truncated, `suppressedSimilar` is a floor like the cards.
  let keptUnrated = unrated;
  if (unrated.length > 0) {
    const judgedRows = await prisma.brainMemory.findMany({
      where: {
        category: { in: [...DISCOVERY_CATEGORIES] },
        OR: [
          { discoveryVerdict: { in: ["known", "noise"] } },
          { metadata: { path: ["discoveryVerdict"], equals: "known" } },
          { metadata: { path: ["discoveryVerdict"], equals: "noise" } },
        ],
      },
      orderBy: { lastSeen: "desc" },
      take: 500,
      select: { content: true, metadata: true, discoveryVerdict: true, discoveryProvenance: true },
    });
    const suppressedIdentity = new Set<string>();
    for (const j of judgedRows ?? []) {
      const v = readVerdict(j.metadata, j.discoveryVerdict);
      if (v !== "known" && v !== "noise") continue; // explicit-null resurface, or investigate
      const prov = readProvenance(j.metadata, j.discoveryProvenance);
      suppressedIdentity.add(`${prov}|${clusterKey(j.content)}`);
    }
    if (suppressedIdentity.size > 0) {
      keptUnrated = unrated.filter((d) => {
        // A DELIBERATELY RESURFACED ROW IS EXEMPT — and this exemption is the
        // whole point of the clause.
        //
        // blind-spot-identity.ts:525-530 records the resurface-is-a-no-op
        // defect being caught once already: the escalation write cleared
        // `metadata` but not the column, every reader preferred the column,
        // and the cron reported `resurfaced: 1` over a spot nobody could see.
        // The fix there was to clear BOTH. This clause reintroduced the same
        // outcome from one layer up, and it could never be seen from inside
        // that module:
        //
        //   · rateDiscoveryCluster writes the verdict onto the head AND every
        //     sibling row (see its member loop below);
        //   · the legacy-key inheritance bridge copies a verdict onto the new
        //     stable-key row and NEVER clears the legacy row it read — and
        //     that legacy population is the real one (255 rows already written
        //     as `blindspot_<domain>_<epoch>`, per the note at its first-
        //     sighting branch);
        //   · but persistBlindSpot's escalation clears the verdict on exactly
        //     ONE row, the stable-key `findUnique({ category_key })` row.
        //
        // So the escalated row comes back unrated while a sibling or its own
        // legacy ancestor still carries `known`/`noise` under the SAME
        // `provenance|clusterKey` — clusterKey() strips the `[TIER]` prefix,
        // so the escalation is invisible to the identity — and this filter
        // then re-suppressed it. Consequence: the amber "you called this noise
        // … it is back because severity rose from X to Y" banner in
        // discover-tab could NEVER render for a spot whose verdict arrived via
        // the bridge or a multi-row cluster, and the spot was instead counted
        // under "N suppressed — regenerated copies of findings you already
        // judged", which is a false description of a revival the recurrence
        // policy deliberately performed.
        //
        // `verdictHistory` is exactly the banner's own condition (it renders
        // on `history.length > 0 && !d.verdict`), and it is written together
        // with `discoveryResurfacedAt` on BOTH resurface paths in
        // blind-spot-identity.ts. Binding the exemption to the same field the
        // UI branches on is deliberate: they cannot drift apart into a card
        // that is shown without its explanation, or an explanation with no
        // card. A row the operator has since re-judged is `rated`, so it never
        // reaches this filter at all.
        if (d.verdictHistory.length > 0) return true;
        const hit = suppressedIdentity.has(`${d.provenance}|${clusterKey(d.content)}`);
        if (hit) suppressedSimilar++;
        return !hit;
      });
    }
  }

  const unratedCards = clusterDiscoveries(keptUnrated);
  const ratedCards = clusterDiscoveries(rated);

  // "include judged" has to actually show judged cards. Concatenating and
  // slicing to `limit` sliced the rated half away entirely whenever there were
  // >= limit unrated clusters — which, at 191 unrated clusters on prod, is
  // always. The toggle changed its own label and nothing else. Reserve up to
  // half the budget for judged cards, keeping unjudged first.
  const ratedShare = opts.includeRated
    ? Math.min(ratedCards.length, Math.floor(limit / 2))
    : 0;
  const items = [
    ...unratedCards.slice(0, limit - ratedShare),
    ...ratedCards.slice(0, ratedShare),
  ];

  // EXACT counts, straight from SQL. Until 2026-08-22 these were derived from
  // whatever the bounded scan happened to reach, so `unrated` was a documented
  // FLOOR — on prod it rendered 56 against a true 242, the defect the whole
  // surface was judged on.
  //
  // Raw SQL, not a Prisma predicate, for one reason: the count has to honour
  // the SAME metadata fallback readVerdict() does. A row judged by the old
  // deployment after the backfill but before this code is live has
  // metadata.discoveryVerdict set and the column NULL — readVerdict correctly
  // treats it as judged and drops its card, but a column-only count still
  // reports it unrated, so the badge sits nonzero with no card behind it
  // indefinitely. `metadata->>'discoveryVerdict' IS NULL` is well-defined for
  // both an absent key and a JSON null, and carries none of the NULL-comparison
  // hazard that `NOT (... = 'x')` does.
  const sinceIso = since.toISOString();
  const cats = [...DISCOVERY_CATEGORIES];
  const countRows = await prisma.$queryRaw<Array<{ unrated: bigint; restored: bigint }>>`
    SELECT
      count(*) FILTER (
        WHERE ${opts.includeRestored ? Prisma.sql`TRUE` : Prisma.sql`(
          discovery_provenance IS DISTINCT FROM 'restored'
          AND coalesce(metadata->>'origin', '') NOT LIKE 'orphan-restore%'
        )`}
      ) AS unrated,
      count(*) FILTER (
        WHERE discovery_provenance = 'restored'
           OR coalesce(metadata->>'origin', '') LIKE 'orphan-restore%'
      ) AS restored
    FROM brain_memories
    WHERE category = ANY(${cats})
      AND deleted_at IS NULL
      AND last_seen >= ${sinceIso}::timestamp
      AND discovery_verdict IS NULL
      AND metadata->>'discoveryVerdict' IS NULL
  `;
  const exactUnrated = Number(countRows[0]?.unrated ?? 0);
  const exactRestoredHidden = opts.includeRestored ? 0 : Number(countRows[0]?.restored ?? 0);

  return {
    items,
    unrated: exactUnrated,
    unratedClusters: unratedCards.length,
    scanned,
    truncated,
    restoredHidden: exactRestoredHidden,
    suppressedSimilar,
  };
}

/**
 * Cluster identity = provenance + question.
 *
 * Provenance is part of the key, not decoration. Clustering on content alone
 * lets a fresh engine row (newest lastSeen, so always the head) absorb 237
 * restored rows behind it — the card then renders as engine-found, drops the
 * RESTORED line entirely, and one tap writes verdicts onto the whole recovery
 * pile. Caught in adversarial review.
 */
function clusterIdentity(d: Discovery): string {
  return `${d.provenance}|${clusterKey(d.content)}`;
}

function countClusters(rows: Discovery[]): number {
  return new Set(rows.map(clusterIdentity)).size;
}

/**
 * Collapse rows asking the same question into one card, most representative
 * first (Hacohen's low-budget typicality — see listDiscoveries).
 *
 * The surviving row is the NEWEST member, so the card shows the freshest
 * wording and the freshest `lastSeen`; `clusterIds` carries the rest so one
 * tap rates all of them. Input arrives newest-first, so the first row seen for
 * a key is already the newest — no re-sort needed inside a cluster.
 */
function clusterDiscoveries(rows: Discovery[]): Discovery[] {
  const byKey = new Map<string, Discovery>();
  for (const d of rows) {
    const key = clusterIdentity(d);
    const head = byKey.get(key);
    if (head) head.clusterIds.push(d.id);
    else byKey.set(key, { ...d, clusterIds: [d.id] });
  }
  return [...byKey.values()].sort(
    (a, b) =>
      b.clusterIds.length - a.clusterIds.length ||
      b.lastSeen.getTime() - a.lastSeen.getTime(),
  );
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

  const previousVerdict = asRecord(row.metadata).discoveryVerdict;

  await prisma.brainMemory.update({
    where: { id },
    data: {
      metadata: {
        ...asRecord(row.metadata),
        discoveryVerdict: verdict,
        discoveryRatedAt: new Date().toISOString(),
        // 2026-08-22 · the tier this verdict was given AT. The recurrence
        // policy in lib/brain/blind-spot-identity.ts clears a `noise` verdict
        // only when the spot later re-emits ABOVE this rank, so without it
        // every suppression would be permanent — which is the failure mode
        // that policy exists to avoid. Parsed from the card text because the
        // severity lives in the content string, not a column.
        discoveryVerdictSeverityRank: severityRankOf(row.content),
      } as never,
      // 2026-08-22 · dual-write. `metadata` stays the source of truth; the
      // columns are the SQL-queryable mirror added by
      // 20260823000000_brain_memory_discovery_columns, which is what makes the
      // feed's counts exact instead of the documented floor that rendered 56
      // against a true 242.
      discoveryVerdict: verdict,
      discoveryRatedAt: new Date(),
      // A JUDGED row must never be garbage collected. Engine rows are created
      // with a 24h probationary `expiresAt` that the commit gateway can never
      // clear (see lib/brain/blind-spot-identity.ts), and pruneNoise +
      // data-cleanup both sweep on it with no category filter. Without this,
      // the operator's verdict is destroyed within a day and the ledger row it
      // decided on points at nothing — measured on prod 2026-08-22, all three
      // engine rows carrying verdicts were already past due.
      expiresAt: null,
    },
  });

  try {
    const { recordShown, recordDecision, recordOutcome } = await import("@/lib/services/outcome-ledger");
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
      // 2026-08-19 · outcome-loop wave · `noise` is an operator usefulness
      // verdict, not just a dismissal — it is the first real writer of the
      // outcomeUseful column (0 callers since the ledger shipped). ONLY
      // noise: `known` is a NOVELTY defect and must stay out of the
      // accuracy-correction harvest (see VERDICT_TO_DECISION's rationale),
      // and `investigate` leaves usefulness honestly OPEN until the
      // investigation lands somewhere measurable.
      if (verdict === "noise") {
        await recordOutcome({
          id: ledgerId,
          useful: false,
          resultRef: `discovery_verdict:${verdict}`,
        });
      }
    }
  } catch (err) {
    logError("brain.discoveries", err, { stage: "ledger", id, verdict }, "warn");
  }

  // 2026-08-19 · outcome-loop wave round-3 · "investigate" SPAWNS the
  // follow-up task, titled VERBATIM with the ledgered content. This is what
  // makes checkTask's recordOutcomeByContent title-hash bridge matchable at
  // all: the end-to-end audit proved no other surface creates a task from a
  // recordShown-ledgered string, so without this the bridge returned false
  // on 100% of invocations. Completing this task with a rating lands the
  // real-world outcome on THIS discovery's ledger row (outcomeContentHash
  // normalizes case/whitespace, so the verbatim title survives the join).
  // First-flip only — re-rating "investigate" doesn't duplicate the task —
  // and best-effort: a spawn failure never breaks the verdict.
  if (verdict === "investigate" && previousVerdict !== "investigate") {
    try {
      const [{ createTask }, { resolveInboxMissionId }] = await Promise.all([
        import("@/lib/services/tasks"),
        import("@/lib/services/missions"),
      ]);
      const missionId = await resolveInboxMissionId();
      await createTask({
        title: row.content,
        missionId,
        status: "READY",
        originSource: "discovery:investigate",
      });
    } catch (err) {
      logError("brain.discoveries", err, { stage: "investigate-task", id }, "warn");
    }
  }

  return { ok: true };
}

/**
 * Rate a whole cluster in one tap.
 *
 * Why a batch entry point rather than the client looping rateDiscovery: the
 * loop would fire one ledger write and one "investigate" task PER ROW, so
 * clearing a 12-row cluster would create twelve identical Inbox tasks. Here ONE
 * row carries the ledger + task side effects — the card the operator actually
 * read — and the rest are metadata-only suppressions.
 *
 * TWO REVIEW FIXES, both of which produced a clean-looking success:
 *
 *  1. THE HEAD CAN BE GONE. Every side effect lives inside rateDiscovery(), so
 *     when `ids[0]` had been soft-deleted between render and tap — routine, the
 *     consolidate cron does it nightly — the function fell through to the
 *     sibling loop and returned `{ ok: true, rated: 11, failed: 1 }` having
 *     written NO ledger row and spawned NO task. The operator saw "saved 11 of
 *     12" and reasonably expected the Inbox task that never appeared. A live
 *     head is now elected from the candidates instead of assumed — and elected
 *     in the CALLER'S order, because the candidate query has no `orderBy`; see
 *     the election itself for why a sibling's text is not interchangeable.
 *
 *  2. THE CLIENT ONLY KNOWS THE ROWS THE SCAN REACHED. `clusterIds` is built
 *     from rows inside the paging window, which stops early. A cluster
 *     straddling that boundary rendered "x18 identical", rated 18, reported a
 *     clean sweep — and the other 22 rows came back as an unjudged card on the
 *     next fetch, which is verbatim the defect this wave exists to close. The
 *     server now re-derives full membership from the head's cluster identity
 *     using the SAME clusterKey() the feed used, in JS rather than SQL so there
 *     is exactly one definition and it cannot drift.
 *
 * Partial success is reported, never swallowed.
 */
export async function rateDiscoveryCluster(
  ids: string[],
  verdict: DiscoveryVerdict,
): Promise<{ ok: boolean; rated: number; failed: number }> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ok: false, rated: 0, failed: 0 };

  // NOTE the absence of an `orderBy`: `IN (...)` has no defined row order in
  // Postgres, so this list must NOT be treated as ranked. The head is elected
  // from `unique` below instead.
  const candidates = await prisma.brainMemory.findMany({
    where: { id: { in: unique } },
    select: {
      id: true, content: true, category: true, metadata: true, deletedAt: true,
      discoveryVerdict: true, discoveryProvenance: true,
    },
  });

  const live = candidates.filter(
    (r) => !r.deletedAt && DISCOVERY_CATEGORIES.includes(r.category),
  );
  // Counted as a SET DIFFERENCE, not `unique.length - live.length`. Subtracting
  // lengths assumes the query returned a subset of what was asked for; when
  // that assumption slips the count goes negative and the caller renders
  // "saved 60 of 3".
  const liveIds = new Set(live.map((r) => r.id));
  const failedUpFront = unique.filter((id) => !liveIds.has(id)).length;

  // Elect a live head IN THE CALLER'S ORDER, not the query's.
  //
  // `live[0]` was `candidates[0]` filtered — and `candidates` comes from a
  // `findMany({ where: { id: { in: unique } } })` with NO `orderBy`, so its
  // order is whatever the plan produced (index scan order, not the IN-list).
  // The client sends `d.clusterIds`, whose [0] IS the row the operator read
  // (clusterDiscoveries seeds `clusterIds: [d.id]` with the head first), and
  // that ordering was being thrown away.
  //
  // It matters because cluster members share a NORMALISED key, not identical
  // text: clusterKey() collapses a LEADING digit run to `#`, which this file
  // documents as live for `${pendingDecisions} decisions awaiting review`. So
  // the head's `content` — used VERBATIM as the ledger `summary` and as the
  // spawned task `title` in rateDiscovery — could be a sibling's wording. The
  // operator taps "9 decisions awaiting review" and gets an Inbox task titled
  // "14 decisions awaiting review"; the ledger records a claim he never saw,
  // and the title-hash bridge in checkTask joins on the wrong string.
  //
  // Scanning `unique` and taking the first LIVE match keeps review fix #1
  // intact — a soft-deleted ids[0] still falls through to the next candidate
  // instead of stranding the side effects — while making the ordinary case
  // deterministic and equal to what was on screen.
  const liveById = new Map(live.map((r) => [r.id, r]));
  const head = unique.flatMap((id) => liveById.get(id) ?? []).at(0);
  if (!head) return { ok: false, rated: 0, failed: unique.length };
  const identity = `${readProvenance(head.metadata, head.discoveryProvenance)}|${clusterKey(head.content)}`;

  // Re-derive full membership. Bounded by MAX_SCAN for the same reason the feed
  // is: an unbounded rate-everything would be a different, riskier operation
  // than the one the operator tapped.
  const windowRows = await prisma.brainMemory.findMany({
    where: {
      category: { in: [...DISCOVERY_CATEGORIES] },
      deletedAt: null,
      lastSeen: { gte: new Date(Date.now() - 30 * 86_400_000) },
    },
    orderBy: { lastSeen: "desc" },
    take: MAX_SCAN,
    select: {
      id: true, content: true, category: true, metadata: true,
      discoveryVerdict: true, discoveryProvenance: true,
    },
  });

  const members = new Map<string, (typeof windowRows)[number]>();
  for (const r of windowRows) {
    if (`${readProvenance(r.metadata, r.discoveryProvenance)}|${clusterKey(r.content)}` !== identity)
      continue;
    if (readVerdict(r.metadata, r.discoveryVerdict) !== null) continue; // judged on its own
    members.set(r.id, r);
  }
  for (const r of live) members.set(r.id, r);
  members.delete(head.id);

  const headResult = await rateDiscovery(head.id, verdict);
  let rated = headResult.ok ? 1 : 0;
  let failed = failedUpFront + (headResult.ok ? 0 : 1);

  for (const row of members.values()) {
    try {
      await prisma.brainMemory.update({
        where: { id: row.id },
        data: {
          metadata: {
            ...asRecord(row.metadata),
            discoveryVerdict: verdict,
            discoveryRatedAt: new Date().toISOString(),
            discoveryVerdictSeverityRank: severityRankOf(row.content),
            // Marks this row as suppressed BY a sibling's verdict rather than
            // judged on its own. Keeps the corpus honest: the operator read one
            // card, so the ledger must claim one judgement, not twelve.
            discoveryVerdictVia: head.id,
          } as never,
          discoveryVerdict: verdict,
          discoveryRatedAt: new Date(),
          // Same reason as rateDiscovery: a judged row must outlive the 24h
          // probationary TTL, or the suppression evaporates overnight.
          expiresAt: null,
        },
      });
      rated++;
    } catch {
      failed++;
    }
  }

  return { ok: rated > 0, rated, failed };
}
