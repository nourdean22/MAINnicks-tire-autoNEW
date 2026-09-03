/**
 * lib/services/contradictions.ts · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The contradiction read/resolve assembly · lifted verbatim from
 * app/api/system/contradictions/route.ts (the GET's status-grouping +
 * unresolved-count composer) and
 * app/api/system/contradictions/[key]/resolve/route.ts (the resolve
 * wrapper) so the legacy REST endpoints AND the new
 * `system.contradictions` / `system.resolveContradiction` tRPC
 * procedures call the SAME functions · drift between consumers
 * structurally impossible.
 *
 * `listContradictions` returns the explicit, shallow `ContradictionsView`
 * shape — `loadAllContradictions` returns plain `StoredContradiction`
 * objects (parsed from a JSON content column, no Prisma Json type), so
 * there is no recursive type to firewall; the explicit interface keeps
 * the public procedure type pinned regardless.
 */

import { ServiceError } from "@/lib/utils/service-error";
import {
  loadRecentContradictions,
  loadAllContradictions,
  countUnresolved,
  countContradictionsByStatus,
  resolveContradiction,
  type ContradictionStatus,
  type StoredContradiction,
} from "@/lib/brain/contradiction-surfacer";

/** One contradiction row · camelCase, the shape the card renders. */
export interface ContradictionRow {
  key: string;
  newExcerpt: string;
  oldExcerpt: string;
  daysApart: number;
  signal: "negation" | "reversal" | "antonym" | "compound";
  similarity: number;
  status: ContradictionStatus;
  resolutionNote: string | null;
  resolvedAt: string | null;
  surfacedAt: string;
  createdAt: string;
}

/** Shallow, explicit shape for the contradictions GET view. */
export interface ContradictionsView {
  items: ContradictionRow[];
  summary: {
    total: number;
    unresolved: number;
    window: { days: number; includeResolved: boolean };
    byStatus: Record<string, number>;
    unresolvedLast14: number;
    /** True when `items` is a capped sample. The summary counts are NOT
     *  capped — they come from an uncapped SQL count — so a consumer can say
     *  "showing 40 of N" instead of presenting the sample size as the total. */
    itemsTruncated: boolean;
  };
}

/** Resolve choice · the 4 non-"unresolved" statuses. */
export type ContradictionResolveChoice = Exclude<
  ContradictionStatus,
  "unresolved"
>;

/** Shallow, explicit shape for a contradiction resolve result. */
export interface ContradictionResolveResult {
  ok: true;
  key: string;
  status: ContradictionResolveChoice;
  resolvedAt: string | null;
}

/**
 * Load contradictions for the resolution card · unresolved (+ resolved
 * when `includeResolved`), grouped by status with an unresolved-count
 * for the badge. The route and the tRPC `system.contradictions`
 * procedure both call this.
 */
export async function listContradictions(input: {
  days: number;
  includeResolved: boolean;
}): Promise<ContradictionsView> {
  const { days, includeResolved } = input;
  const items = includeResolved
    ? await loadAllContradictions(days)
    : await loadRecentContradictions(days, false);

  // 2026-09-02 self-audit · `counts`, `total` and `unresolved` were all
  // derived from `items`, which loadRecentContradictions caps at 40 BEFORE
  // filtering by status. So a window with 250 contradictions reported a total
  // of 40 and a byStatus histogram of whichever 40 were newest — the sample
  // size presented as the population, which is the same wrong-population
  // defect the maturity rollup was fixed for one layer up. The list stays
  // capped (40 rows is a reasonable page); the SUMMARY now comes from the
  // uncapped SQL count, and `itemsTruncated` lets a consumer say "showing 40
  // of N" rather than silently claiming N is 40.
  const windowCounts = await countContradictionsByStatus(days);

  const counts = items.reduce(
    (acc, c) => {
      const status = c.status ?? "unresolved";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  // byStatus keeps its per-status detail from the sample, but the two headline
  // numbers do not come from it.
  const totalCount = includeResolved ? windowCounts.classified : windowCounts.unresolved;
  const unresolvedCount = windowCounts.unresolved;

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
      total: totalCount,
      unresolved: unresolvedCount,
      window: { days, includeResolved },
      byStatus: counts,
      unresolvedLast14: await countUnresolved(14),
      itemsTruncated: items.length < totalCount,
    },
  };
}

/**
 * Resolve a contradiction (current_wins · old_wins · both_valid ·
 * dismissed). `resolveContradiction` returns null when the row is
 * missing OR its content JSON is corrupt — the route mapped both to
 * 404; this throws ServiceError(404) so both transports reject
 * identically. The route and the tRPC `system.resolveContradiction`
 * procedure both call this.
 */
export async function resolveContradictionEntry(input: {
  key: string;
  status: ContradictionResolveChoice;
  note?: string;
}): Promise<ContradictionResolveResult> {
  const trimmedNote = input.note?.trim() || undefined;
  const result = await resolveContradiction(
    input.key,
    input.status,
    trimmedNote,
  );
  if (!result) {
    throw new ServiceError("not_found", 404);
  }
  return {
    ok: true,
    key: input.key,
    status: input.status,
    resolvedAt: result.resolved_at ?? null,
  };
}

// ──────────────── /api/contradictions (brain-domain panel) ────────────────
//
// The /brain ContradictionResolutionPanel reads the RAW snake_case
// `StoredContradiction` shape (`new_excerpt` · `old_excerpt` ·
// `days_apart` · …) — distinct from the camelCase `ContradictionsView`
// the ultron ContradictionsCard above renders. `StoredContradiction` is
// a flat plain object parsed from a JSON content column (no Prisma Json
// type), so there is no recursive type to firewall.

/**
 * List contradictions for the /brain panel · unresolved-only by
 * default, or the full 90-day history when `includeResolved`. Lifted
 * verbatim from GET /api/contradictions — the route and the tRPC
 * `brain.contradictions` procedure both call this.
 */
export async function listStoredContradictions(input: {
  includeResolved: boolean;
}): Promise<{ contradictions: StoredContradiction[] }> {
  const rows = input.includeResolved
    ? await loadAllContradictions(90)
    : await loadRecentContradictions(14, false);
  return { contradictions: rows };
}

/**
 * Resolve a contradiction from the /brain panel. Lifted verbatim from
 * PATCH /api/contradictions — `resolveContradiction` returns null when
 * the row is missing OR its content JSON is corrupt; the route mapped
 * both to 404, so this throws ServiceError(404). The route and the
 * tRPC `brain.resolveContradiction` procedure both call this.
 */
export async function resolveStoredContradiction(input: {
  key: string;
  status: ContradictionResolveChoice;
  note?: string;
}): Promise<{ contradiction: StoredContradiction }> {
  const resolved = await resolveContradiction(
    input.key,
    input.status,
    input.note,
  );
  if (!resolved) {
    throw new ServiceError("contradiction not found", 404);
  }
  return { contradiction: resolved };
}
