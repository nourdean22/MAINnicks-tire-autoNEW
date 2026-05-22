// 2026-05-18 · Railway BuildKit snapshot was stuck on a stale
// xlcz1rbthtyc9xz5avtbuesdd ref · 8 consecutive deploys failed at
// COPY package.json step despite no real changes · forced a watched-
// file source change (this comment) to trigger fresh context upload.
import { apiHandler } from "@/lib/utils/http";
import { buildSystemHealth } from "@/lib/services/system-pages";

/**
 * GET /api/health — composite health probe.
 *
 * Phase B.7a (2026-05-22) · the full probe assembly (DB health + task /
 * commitment / device / radar counts + morning-brief readiness +
 * Inngest + Braintrust visibility) moved to the shared
 * `system-pages.buildSystemHealth` service so the legacy REST consumer
 * AND the new `system.healthSummary` tRPC procedure can't drift. The
 * 30s outer cache (v10.0.514 · keeps warm-cache hits sub-50ms) now
 * lives inside the service. This route stays mounted as the
 * coexistence / rollback path.
 */
export const GET = apiHandler(async () => buildSystemHealth());
