/**
 * GET /api/system/schema-history · v10 Track B.4 · Apr 30.
 *
 * Operator-facing endpoint for /system/schema-history. Returns:
 *   - summary stats (total, applied 24h/7d, pending, failed, destructive 30d)
 *   - recent ledger entries with full detail
 *
 * Owner-gated. Read-only.
 */

import { apiHandler } from "@/lib/utils/http";
import {
  listRecentSchemaChanges,
  getSchemaLedgerStats,
  type ChangeEnvironment,
} from "@/lib/db/schema-ledger";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 200))
      : 50;
    const envFilter = url.searchParams.get("env");
    const environment =
      envFilter === "local" || envFilter === "preview" || envFilter === "production"
        ? (envFilter as ChangeEnvironment)
        : undefined;

    const [stats, entries] = await Promise.all([
      getSchemaLedgerStats(),
      listRecentSchemaChanges({ limit, environment }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      stats,
      entries: entries.map((e) => ({
        ...e,
        appliedAt: e.appliedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate compliance
);
