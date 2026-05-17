/**
 * GET /api/system/schema-coverage · v10.0.24 · Apr 30 (Horizon 5).
 *
 * Owner-gated index-coverage audit. Returns model-level row counts
 * (from pg_stat_user_tables.n_live_tup) + index counts (from
 * pg_indexes) + a flag for under-indexed hot tables.
 *
 * Cross-references with the slow-query tracker so any model whose
 * name appears in a recent slow query is automatically marked
 * "appears in slow queries" — operator can connect the dots between
 * a slow query and an under-indexed table without grep-the-schema.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildSchemaCoverageReport } from "@/lib/db/schema-coverage";
import { getTopSlowQueries } from "@/lib/db/slow-query-tracker";

export const GET = apiHandler(
  async () => {
    const slowQueryShapes = getTopSlowQueries(20).map((q) => q.shape);
    const report = await buildSchemaCoverageReport({ slowQueryShapes });
    return report;
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate
);
