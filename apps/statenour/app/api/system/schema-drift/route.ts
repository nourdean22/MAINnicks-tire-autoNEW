/**
 * GET /api/system/schema-drift · v8.1 Phase 2C · Apr 29.
 *
 * On-demand schema-drift check. Compares EXPECTATIONS in
 * lib/db/schema-sentinel.ts against the live DB and returns a
 * structured drift report.
 *
 * Read-only. Safe to expose: /system/health and the future weekly-
 * review cron both consume it. Cached at the function level for 30s
 * to avoid repeated information_schema scans during active dashboards.
 */

import { apiHandler } from "@/lib/utils/http";
import { runSchemaDriftCheck } from "@/lib/db/schema-sentinel";

let cached: { at: number; result: Awaited<ReturnType<typeof runSchemaDriftCheck>> } | null = null;
const CACHE_MS = 30_000;

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return { ...cached.result, fromCache: true };
  }

  const result = await runSchemaDriftCheck();
  cached = { at: Date.now(), result };
  return { ...result, fromCache: false };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts