import { apiHandler } from "@/lib/utils/http";
import { buildCronCommandDeck } from "@/lib/services/system-pages";

/**
 * GET /api/system/crons — the composite health feed for /system/crons.
 *
 * Returns manifest + live stats per cron, plus a top-strip summary
 * suitable for the page header. Auth: owner-only (matches the sibling
 * run + toggle sub-routes hardened in v10.0.120).
 *
 * Phase B.7a (2026-05-22) · the manifest + per-job-stats + drift +
 * next-run assembly moved to the shared `system-pages.buildCronCommandDeck`
 * service so the legacy REST consumer AND the new `system.cronDeck` tRPC
 * procedure can't drift. This route stays mounted as the coexistence /
 * rollback path.
 */
export const GET = apiHandler(async () => buildCronCommandDeck(), {
  auth: "owner",
}); // v9.1.17 · added by add-get-route-auth.ts
