/**
 * lib/services/brain-health.ts · scattered-components REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/brain/* slice).
 *
 * The per-category brain-memory health rollup · lifted verbatim from the
 * GET handler of app/api/brain/memory-health/route.ts so the legacy REST
 * endpoint AND the new `brain.memoryHealth` tRPC procedure call the SAME
 * function · drift between consumers structurally impossible.
 *
 * The rollup is a single grouped raw-SQL aggregation (fast on a 1,500+
 * row table). It returns only scalar fields projected to the explicit,
 * flat `CategoryHealth` / `MemoryHealthReport` shapes — no Prisma row or
 * Json column reaches the AppRouter (the TS2589 firewall, satisfied
 * trivially since the raw query already yields plain scalars).
 */

import { prisma } from "@/lib/prisma";
import { TELEMETRY_CATEGORIES } from "@/lib/brain/embedding-policy";

/** O(1) membership for the telemetry split below. */
const TELEMETRY_SET: ReadonlySet<string> = new Set(TELEMETRY_CATEGORIES);

/** Per-category memory-health row. */
export interface CategoryHealth {
  category: string;
  count: number;
  permanent: number;
  /** confidence < 0.2 OR source startsWith 'auto-resolved' */
  decayed: number;
  /** joined vector_embeddings count */
  vectorized: number;
  /** Rows this category has that the embed-backfill is ELIGIBLE to embed:
   *  non-telemetry is decided per category, `confidence >= 0.2` per row. */
  embeddable: number;
  /** Of `embeddable`, how many already carry an embedding. */
  embeddableVectorized: number;
  vectorizedPct: number;
  avgConfidence: number;
  /** Mean seen_count — the REAL sighting counter. avgConfidence cannot be
   *  inverted into sightings: 73% of recent seen_count=1 rows carry a
   *  writer-stamped confidence that violates the 0.5+0.1(n-1) formula
   *  (measured on prod 2026-08-19). */
  avgSeen: number;
  /** True when the category is event telemetry (embedding-policy denylist)
   *  — observability riding in the brain table, not knowledge about Nour. */
  telemetry: boolean;
  newest: string | null;
  oldest: string | null;
  /** Hours since the most-recent row was lastSeen — high values = stale */
  ageNewestHours: number | null;
}

/** The full memory-health rollup. */
export interface MemoryHealthReport {
  generatedAt: string;
  totals: {
    live: number;
    permanent: number;
    decayed: number;
    /** Every row carrying an embedding, telemetry included. */
    vectorized: number;
    /** vectorized / live. STRUCTURALLY CAPPED below 100% — see
     *  knowledgeVectorizedPct. Kept because it is the honest raw row count. */
    vectorizedPct: number;
    /** Embedded rows in categories that are ALLOWED to be embedded. */
    knowledgeVectorized: number;
    /** Denominator for knowledgeVectorizedPct — rows the embedder may take. */
    knowledgeEmbeddable: number;
    /** knowledgeVectorized / knowledge — the only coverage figure that can
     *  reach 100%, and the one the UI shows. */
    knowledgeVectorizedPct: number;
    categoryCount: number;
    /** Rows in embedding-policy TELEMETRY_CATEGORIES — logs, scores, probes. */
    telemetry: number;
    /** live − telemetry: what "the brain knows" can honestly claim. */
    knowledge: number;
  };
  categories: CategoryHealth[];
  flags: Array<{ category: string; flag: string }>;
}

/** Dedup markers — written to be counted, never to be recalled. */
const ALWAYS_SKIP_VEC = new Set(["alert_pushed"]);

/**
 * Which categories look unhealthy.
 *
 * Pure, and exported, so the canary can prove the alarm still FIRES without
 * standing up a database. That matters more than usual here, because the
 * 2026-09-02 fix below is a narrowing: the easiest way to "fix" a noisy alarm
 * is to make it silent, and this alarm guards the defect that once left 83.5%
 * of the brain unreachable by recall.
 *
 * ── 2026-09-02 · TELEMETRY IS NOT UNHEALTHY ──────────────────────────
 * `lib/brain/embedding-policy.ts` TELEMETRY_CATEGORIES is a deliberate
 * denylist: those rows are event logs, and embedding a log line puts it in the
 * same space as reasoning where it competes for a finite number of recall
 * slots. The backfill cron and the drain script both exclude them.
 *
 * This function used to flag them anyway, skipping only `alert_pushed` — so
 * the live page showed NINE red `no_vectors` flags, every one of them a
 * category being faulted for lacking exactly what policy forbids it to have.
 * `all_decayed` was the same mistake in a different coat: all 1,056
 * `memory_gateway_shadow` rows sit at confidence 0.1 because
 * memory-commit-gateway.ts writes them at 0.1 — min = max = 0.1 on prod, so
 * nothing decayed, they were born below the 0.2 threshold the flag calls decay.
 *
 * Ten of eleven flags were noise. That is worse than no panel: an operator who
 * learns the flags are meaningless stops reading them, and a REAL one arrives
 * as item twelve in a list already known to be junk.
 *
 * `dormant_30d` deliberately still applies to telemetry — a log category that
 * stopped being written means a writer died, which is real signal whatever the
 * category holds.
 */
export function computeHealthFlags(
  categories: readonly CategoryHealth[],
): Array<{ category: string; flag: string }> {
  const flags: Array<{ category: string; flag: string }> = [];
  for (const c of categories) {
    if (c.count <= 5) continue;
    if (c.vectorized === 0 && !c.telemetry && !ALWAYS_SKIP_VEC.has(c.category)) {
      flags.push({ category: c.category, flag: "no_vectors" });
    }
    if (c.decayed === c.count && !c.telemetry) {
      flags.push({ category: c.category, flag: "all_decayed" });
    }
    if (c.ageNewestHours !== null && c.ageNewestHours > 24 * 30) {
      flags.push({ category: c.category, flag: "dormant_30d" });
    }
  }
  return flags;
}

/**
 * Build the per-category brain-memory health rollup — counts, freshness,
 * confidence, vectorization coverage, and unhealthy-category flags. The
 * REST route and the `brain.memoryHealth` procedure both call this.
 */
export async function buildMemoryHealth(): Promise<MemoryHealthReport> {
  // Single grouped query — bin everything by category so the rollup is
  // one round-trip instead of N+1 per category.
  type Row = {
    category: string;
    count: number;
    permanent: number;
    decayed: number;
    vectorized: number;
    embeddable: number;
    embeddable_vectorized: number;
    avg_conf: number;
    avg_seen: number;
    newest: Date | null;
    oldest: Date | null;
  };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      bm.category::text AS category,
      COUNT(*)::int AS count,
      SUM(CASE WHEN bm.expires_at IS NULL THEN 1 ELSE 0 END)::int AS permanent,
      SUM(CASE
            WHEN bm.confidence < 0.2 THEN 1
            WHEN bm.source LIKE 'auto-resolved%' THEN 1
            ELSE 0
          END)::int AS decayed,
      COUNT(ve.id)::int AS vectorized,
      -- Rows the embed-backfill would actually pick up. Its predicate is
      -- deleted_at IS NULL AND confidence >= 0.2 AND NOT telemetry
      -- (app/api/cron/embed-backfill/route.ts). The confidence floor matters:
      -- api_token rows are written at confidence 0, so they are knowledge by
      -- category and ineligible by row — counting them in the denominator
      -- would permanently depress coverage, which is the same false-backlog
      -- defect one grain finer than the telemetry one.
      SUM(CASE WHEN bm.confidence >= 0.2 THEN 1 ELSE 0 END)::int AS embeddable,
      COUNT(ve.id) FILTER (WHERE bm.confidence >= 0.2)::int AS embeddable_vectorized,
      ROUND(AVG(bm.confidence)::numeric, 3)::float AS avg_conf,
      ROUND(AVG(bm.seen_count)::numeric, 1)::float AS avg_seen,
      MAX(bm.last_seen) AS newest,
      MIN(bm.created_at) AS oldest
    FROM brain_memories bm
    LEFT JOIN vector_embeddings ve
      ON ve."sourceId" = bm.id
     AND ve."sourceType" = 'brain_memory'
    WHERE bm.deleted_at IS NULL
    GROUP BY bm.category
    ORDER BY COUNT(*) DESC
  `;

  const now = Date.now();
  const categories: CategoryHealth[] = rows.map((r) => {
    const newestMs = r.newest ? new Date(r.newest).getTime() : null;
    const ageNewestHours =
      newestMs !== null
        ? Math.round(((now - newestMs) / 3_600_000) * 10) / 10
        : null;
    return {
      category: r.category,
      count: r.count,
      permanent: r.permanent,
      decayed: r.decayed,
      vectorized: r.vectorized,
      embeddable: r.embeddable,
      embeddableVectorized: r.embeddable_vectorized,
      vectorizedPct:
        r.count === 0 ? 0 : Math.round((r.vectorized / r.count) * 1000) / 10,
      avgConfidence: r.avg_conf ?? 0,
      avgSeen: r.avg_seen ?? 0,
      telemetry: TELEMETRY_SET.has(r.category),
      newest: r.newest?.toISOString() ?? null,
      oldest: r.oldest?.toISOString() ?? null,
      ageNewestHours,
    };
  });

  const totalLive = categories.reduce((s, c) => s + c.count, 0);
  const totalVec = categories.reduce((s, c) => s + c.vectorized, 0);
  const totalDecayed = categories.reduce((s, c) => s + c.decayed, 0);
  const totalPermanent = categories.reduce((s, c) => s + c.permanent, 0);
  // The headline "N memories" number was a lie of aggregation: on prod
  // 2026-08-19, telemetry categories (gateway shadows, XP events, critic
  // scores, probes) were ~30% of the window's writes. Split them out so
  // the UI can state what is knowledge and what is logging.
  const totalTelemetry = categories.reduce(
    (s, c) => s + (c.telemetry ? c.count : 0),
    0,
  );

  // 2026-09-02 · the VECTORIZATION bar read `vectorized / live` and was
  // therefore capped at 93.4% on prod and could never reach 100%, because
  // `live` includes the 5,169 telemetry rows that embedding-policy FORBIDS
  // embedding. A progress bar whose denominator contains rows the numerator
  // structurally excludes reports permanent incompleteness as a backlog.
  // Measured the same day: 93.40% shown, 99.967% of knowledge actually
  // covered, 24 knowledge rows genuinely missing — not 5,187.
  const totalKnowledge = totalLive - totalTelemetry;
  // Coverage is measured over rows the embedder is ELIGIBLE to take, which is
  // narrower than "not telemetry": the backfill also requires confidence >=
  // 0.2, so an api_token row written at confidence 0 is knowledge by category
  // and ineligible by row. Counting those in the denominator recreates the
  // false backlog at a finer grain than the telemetry one this replaced.
  const totalEmbeddable = categories.reduce(
    (s, c) => s + (c.telemetry ? 0 : c.embeddable),
    0,
  );
  const knowledgeVec = categories.reduce(
    (s, c) => s + (c.telemetry ? 0 : c.embeddableVectorized),
    0,
  );

  const flags = computeHealthFlags(categories);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      live: totalLive,
      permanent: totalPermanent,
      decayed: totalDecayed,
      vectorized: totalVec,
      vectorizedPct:
        totalLive === 0 ? 0 : Math.round((totalVec / totalLive) * 1000) / 10,
      knowledgeVectorized: knowledgeVec,
      knowledgeEmbeddable: totalEmbeddable,
      knowledgeVectorizedPct:
        totalEmbeddable === 0
          ? 0
          : Math.round((knowledgeVec / totalEmbeddable) * 1000) / 10,
      categoryCount: categories.length,
      telemetry: totalTelemetry,
      knowledge: totalKnowledge,
    },
    categories,
    flags,
  };
}
