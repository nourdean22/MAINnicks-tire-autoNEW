import { apiHandler } from "@/lib/utils/http";
import { buildHealthReport, type HealthRange } from "@/lib/services/system-health";

/**
 * GET /api/system/health-report
 *
 * Re-runnable system audit — the JSON form of scripts/system-audit.ts.
 * Compact health snapshot the UI renders as a dashboard. Owner-only.
 *
 * Query ?range=24h|7d|30d (default 7d)
 *
 * Phase S.2 (2026-05-18 PM) · the heavy lifting now lives in
 * `lib/services/system-health.ts` so the new tRPC procedure
 * `trpc.system.healthReport` calls the same function · drift between
 * the two consumers is structurally impossible. This endpoint stays
 * mounted for back-compat with any non-tRPC consumer (cron jobs,
 * external probes, ad-hoc curl).
 */

// May 02 · Next 16 prerender fix · auth-gated route would throw
// "Authentication unavailable" at build time without force-dynamic.
export const dynamic = "force-dynamic";

function parseRange(raw: string | null): HealthRange {
  if (raw === "24h" || raw === "30d") return raw;
  return "7d";
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const range = parseRange(url.searchParams.get("range"));
    return buildHealthReport({ range });
  },
  { auth: "owner" },
);
