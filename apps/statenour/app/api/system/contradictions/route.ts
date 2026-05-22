/**
 * Arc B Feature 5 · Proactive Contradiction Surfacing · v10.0.526
 *
 * GET /api/system/contradictions
 *   Returns OPEN (unresolved) contradictions from the last N days for
 *   the future Ultron tile + /brain dashboard surface. Resolution and
 *   detection live elsewhere — this is read-only.
 *
 * Storage: BrainMemory(category="contradiction"). Format matches what
 * contradiction-surfacer.ts writes. The injector reads the same rows
 * to decide whether to inject mid-chat. No parallel table.
 *
 * Query params:
 *   days       — lookback window in days (default 30, max 180)
 *   includeResolved — "true" to include resolved/dismissed rows
 *
 * Auth: owner-only (read-only personal data).
 */

import { apiHandler } from "@/lib/utils/http";
import { z } from "zod";
// Phase B.6c · the read assembly moved to a shared service so the
// legacy REST route AND the tRPC `system.contradictions` procedure call
// the same function · drift impossible.
import { listContradictions } from "@/lib/services/contradictions";

const QuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(180).default(30),
  includeResolved: z.coerce.boolean().default(false),
});

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
    includeResolved: url.searchParams.get("includeResolved") ?? undefined,
  });
  if (!parsed.success) {
    throw Object.assign(new Error("invalid_query"), {
      status: 400,
      code: "INVALID_QUERY",
    });
  }
  const { days, includeResolved } = parsed.data;

  return listContradictions({ days, includeResolved });
}, { auth: "owner" });
