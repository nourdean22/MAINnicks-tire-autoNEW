// 2026-05-18 · Railway BuildKit snapshot was stuck on a stale
// xlcz1rbthtyc9xz5avtbuesdd ref · 8 consecutive deploys failed at
// COPY package.json step despite no real changes · forced a watched-
// file source change (this comment) to trigger fresh context upload.
import { NextResponse } from "next/server";
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
export const GET = apiHandler(async () => {
  const health = await buildSystemHealth();
  // Reflect degradation in the HTTP status, not just the JSON body. A bare
  // 200-when-degraded lets Railway's healthcheck keep a DB-severed instance
  // in rotation; returning 503 lets the platform evict/restart it. (apiHandler
  // passes a raw Response through and still stamps X-Request-Id.)
  const httpStatus = health.status === "healthy" ? 200 : 503;
  return NextResponse.json(health, { status: httpStatus });
}, { auth: "owner" });
// truth-substrate audit P0 (2026-07-21) · route-level owner gate added.
// buildSystemHealth() exposes internal operational intelligence (task /
// commitment / device / radar counts, morning-brief readiness, Inngest +
// Braintrust visibility, last autonomic run + error text). Previously the
// route carried NO auth wrapper and was reachable anonymously via the
// middleware PUBLIC_EXACT entry (now also removed). Owner-gated at BOTH
// layers, matching /api/system/health. External monitors use
// /api/system/heartbeat (Railway healthcheckPath — deploys unaffected).
