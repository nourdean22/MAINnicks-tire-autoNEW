/**
 * lib/services/schema-drift.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The 30s-cached schema-drift check. Lifted verbatim from
 * app/api/system/schema-drift/route.ts so the legacy REST endpoint AND
 * the new `system.schemaDrift` tRPC procedure call the same function
 * AND share the same cache · drift between consumers structurally
 * impossible.
 *
 * The cache lived as a module-level closure in the route handler.
 * Moving it here means the tRPC procedure and the REST route hit one
 * shared cache rather than two — repeated information_schema scans
 * during an active dashboard are still avoided either way in.
 */

import { runSchemaDriftCheck } from "@/lib/db/schema-sentinel";

let cached: {
  at: number;
  result: Awaited<ReturnType<typeof runSchemaDriftCheck>>;
} | null = null;
const CACHE_MS = 30_000;

/** Run (or serve cached) schema-drift report. `force` skips the cache. */
export async function getSchemaDrift(force = false) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return { ...cached.result, fromCache: true };
  }
  const result = await runSchemaDriftCheck();
  cached = { at: Date.now(), result };
  return { ...result, fromCache: false };
}
