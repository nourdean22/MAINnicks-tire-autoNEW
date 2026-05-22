import { apiHandler } from "@/lib/utils/http";
import { buildDiagnostics } from "@/lib/services/system-pages";

/**
 * GET /api/system/diagnostics — composite system diagnostics.
 *
 * Phase B.7a (2026-05-22) · the rollup logic moved to the shared
 * `system-pages.buildDiagnostics` service so the legacy REST consumer
 * AND the new `system.diagnostics` tRPC procedure can't drift. This
 * route stays mounted as the coexistence / rollback path.
 */
export const GET = apiHandler(async () => buildDiagnostics(), {
  auth: "owner",
}); // v9.1.17 · added by add-get-route-auth.ts
