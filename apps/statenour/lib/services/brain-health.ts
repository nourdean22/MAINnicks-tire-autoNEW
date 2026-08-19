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
    vectorized: number;
    vectorizedPct: number;
    categoryCount: number;
    /** Rows in embedding-policy TELEMETRY_CATEGORIES — logs, scores, probes. */
    telemetry: number;
    /** live − telemetry: what "the brain knows" can honestly claim. */
    knowledge: number;
  };
  categories: CategoryHealth[];
  flags: Array<{ category: string; flag: string }>;
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

  // Find categories that look unhealthy:
  //   · >0 rows but 0% vectorized AND not in the always-skip list
  //   · all rows decayed (auto-resolved cleanup ran on everything)
  //   · newest row >30 days old (category is dormant)
  const ALWAYS_SKIP_VEC = new Set(["alert_pushed"]); // dedup markers — never embed
  const flags: Array<{ category: string; flag: string }> = [];
  categories.forEach((c) => {
    if (c.count > 5 && c.vectorized === 0 && !ALWAYS_SKIP_VEC.has(c.category)) {
      flags.push({ category: c.category, flag: "no_vectors" });
    }
    if (c.count > 5 && c.decayed === c.count) {
      flags.push({ category: c.category, flag: "all_decayed" });
    }
    if (c.ageNewestHours !== null && c.ageNewestHours > 24 * 30 && c.count > 5) {
      flags.push({ category: c.category, flag: "dormant_30d" });
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      live: totalLive,
      permanent: totalPermanent,
      decayed: totalDecayed,
      vectorized: totalVec,
      vectorizedPct:
        totalLive === 0 ? 0 : Math.round((totalVec / totalLive) * 1000) / 10,
      categoryCount: categories.length,
      telemetry: totalTelemetry,
      knowledge: totalLive - totalTelemetry,
    },
    categories,
    flags,
  };
}
