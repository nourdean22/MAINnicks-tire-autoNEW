/**
 * GET /api/system/schema-history · v10 Track B.4 · Apr 30.
 *
 * Operator-facing endpoint for /system/schema-history. Returns:
 *   - summary stats (total, applied 24h/7d, pending, failed, destructive 30d)
 *   - recent ledger entries with full detail
 *
 * Owner-gated. Read-only.
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the stats + ledger-entry assembly moved to the shared
 * `lib/services/system-pages-b.buildSchemaHistory` service · this route
 * AND the new `trpc.system.schemaHistory` procedure call the same
 * function · drift impossible. The route stays mounted as the rollback
 * path.
 */

import { apiHandler } from "@/lib/utils/http";
import { type ChangeEnvironment } from "@/lib/db/schema-ledger";
import { buildSchemaHistory } from "@/lib/services/system-pages-b";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 50;
    const envFilter = url.searchParams.get("env");
    const environment =
      envFilter === "local" ||
      envFilter === "preview" ||
      envFilter === "production"
        ? (envFilter as ChangeEnvironment)
        : undefined;

    return buildSchemaHistory({ limit, environment });
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate compliance
);
