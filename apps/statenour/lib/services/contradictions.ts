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
  resolveContradiction,
  type ContradictionStatus,
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

  const counts = items.reduce(
    (acc, c) => {
      const status = c.status ?? "unresolved";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

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
      unresolvedLast14: await countUnresolved(14),
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
