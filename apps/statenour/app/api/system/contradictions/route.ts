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
import {
  loadRecentContradictions,
  loadAllContradictions,
  countUnresolved,
} from "@/lib/brain/contradiction-surfacer";

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

  const items = includeResolved
    ? await loadAllContradictions(days)
    : await loadRecentContradictions(days, false);

  // Group by status so the Ultron tile can show "X unresolved · Y
  // resolved" without re-walking the list client-side.
  const counts = items.reduce(
    (acc, c) => {
      const status = c.status ?? "unresolved";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  // unresolved-only count for the tile badge (cheap separate query
  // when the caller asked for everything, so we don't double-count
  // resolved rows toward the alert).
  const unresolvedCount = includeResolved
    ? (counts.unresolved ?? 0)
    : items.length;

  return {
    items: items.map((c) => ({
      key: c.key,
      newExcerpt: c.new_excerpt,
      oldExcerpt: c.old_excerpt,
      daysApart: c.days_apart,
      signal: c.signal,
      similarity: Number(c.similarity.toFixed(3)),
      status: c.status ?? "unresolved",
      resolutionNote: c.resolution_note ?? null,
      resolvedAt: c.resolved_at ?? null,
      surfacedAt: c.surfaced_at,
      createdAt: c.createdAt,
    })),
    summary: {
      total: items.length,
      unresolved: unresolvedCount,
      window: { days, includeResolved },
      byStatus: counts,
      // Fast path for the tile badge — single COUNT roundtrip in the
      // common case where the caller only wants "is there anything I
      // should look at?"
      unresolvedLast14: await countUnresolved(14),
    },
  };
}, { auth: "owner" });
