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

import { prisma } from "@/lib/prisma";
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
  signal: "negation" | "reversal" | "antonym" | "compound" | "near_duplicate";
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

// 2026-10-23 · the thinking engine's `contradictions` TABLE ("he said X, the
// record shows Y") is where the real rows live: 631 ever, 0 closed by Nour,
// because this panel read only the BrainMemory set (0 rows ever). Table rows
// ride the same list and the same resolve call, keyed `tbl:<id>`.
// Audit: docs/research/2026-10-22-insight-engines-audit.md.

const TABLE_KEY_PREFIX = "tbl:";

/** The three answers Nour gives a claim-vs-record row, as stored in `resolved_how`. */
export type TableResolvedHow = "true" | "outdated" | "ignore";

/** Panel choice -> resolved_how. "true" = the record is right (the claim was wrong). */
const RESOLVED_HOW: Record<ContradictionResolveChoice, TableResolvedHow> = {
  current_wins: "true",
  old_wins: "outdated",
  both_valid: "outdated",
  dismissed: "ignore",
};
const STATUS_FROM_HOW: Record<string, ContradictionResolveChoice> = {
  true: "current_wins",
  outdated: "old_wins",
  ignore: "dismissed",
};

/** A claim-vs-record row in the panel's shape: claim on the left, record on the right. */
export interface TableContradiction
  extends Omit<StoredContradiction, "signal" | "similarity" | "new_memory_id" | "old_memory_id"> {
  source: "table";
  signal: "claim_gap";
  gap: string;
  category: string;
  severity: string;
  /** The ET day the thinking engine recorded it. */
  recorded: string;
}
export type PanelContradiction = (StoredContradiction & { source: "memory" }) | TableContradiction;

const TABLE_SELECT = {
  id: true,
  date: true,
  claim: true,
  reality: true,
  gap: true,
  category: true,
  severity: true,
  resolved: true,
  resolvedHow: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface TableRow {
  id: string;
  date: string;
  claim: string;
  reality: string;
  gap: string;
  category: string;
  severity: string;
  resolved: boolean;
  resolvedHow: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toPanelRow(r: TableRow): TableContradiction {
  const answered = r.resolvedHow ? STATUS_FROM_HOW[r.resolvedHow] : undefined;
  return {
    key: `${TABLE_KEY_PREFIX}${r.id}`,
    source: "table",
    signal: "claim_gap",
    new_excerpt: r.claim,
    old_excerpt: r.reality,
    gap: r.gap,
    category: r.category,
    severity: r.severity,
    recorded: r.date,
    days_apart: Math.max(0, Math.round((Date.now() - r.createdAt.getTime()) / 86400_000)),
    surfaced_at: r.createdAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    // A closure that is not one of the three answers (the 30-day auto-expiry) still reads as
    // closed, with its own words as the note, so it is never counted as Nour's answer.
    status: r.resolved ? (answered ?? "dismissed") : "unresolved",
    resolution_note: r.resolved && !answered ? r.resolvedHow : null,
    resolved_at: r.resolved ? r.updatedAt.toISOString() : null,
  };
}

/**
 * List contradictions for the /brain panel · unresolved-only by
 * default, or the full 90-day history when `includeResolved`. Lifted
 * verbatim from GET /api/contradictions — the route and the tRPC
 * `brain.contradictions` procedure both call this. Table rows come first
 * (unresolved first). A failed table read REJECTS, so the panel renders its
 * ERROR state instead of an empty ledger.
 */
export async function listStoredContradictions(input: {
  includeResolved: boolean;
}): Promise<{ contradictions: PanelContradiction[] }> {
  const [memoryRows, tableRows] = await Promise.all([
    input.includeResolved ? loadAllContradictions(90) : loadRecentContradictions(14, false),
    prisma.contradiction.findMany({
      where: input.includeResolved
        ? { deletedAt: null, createdAt: { gte: new Date(Date.now() - 90 * 86400_000) } }
        : { deletedAt: null, resolved: false },
      orderBy: [{ resolved: "asc" }, { createdAt: "desc" }],
      take: 60,
      select: TABLE_SELECT,
    }),
  ]);
  return {
    contradictions: [
      ...tableRows.map(toPanelRow),
      ...memoryRows.map((m) => ({ ...m, source: "memory" as const })),
    ],
  };
}

/**
 * Close a claim-vs-record row. claim-before-act: the write is a compare-and-swap
 * on resolved=false, so two racing answers cannot both write; the loser gets the
 * row back with `alreadyResolved`. A missing or deleted row is a 404.
 */
async function resolveTableContradiction(
  id: string,
  status: ContradictionResolveChoice,
): Promise<{ contradiction: TableContradiction; alreadyResolved: boolean; resolvedHow: string | null }> {
  const won = await prisma.contradiction.updateMany({
    where: { id, resolved: false, deletedAt: null },
    data: { resolved: true, resolvedHow: RESOLVED_HOW[status] },
  });
  const row = await prisma.contradiction.findFirst({ where: { id, deletedAt: null }, select: TABLE_SELECT });
  if (!row) throw new ServiceError("contradiction not found", 404);
  return { contradiction: toPanelRow(row), alreadyResolved: won.count === 0, resolvedHow: row.resolvedHow };
}

/**
 * Resolve a contradiction from the /brain panel or Nick's resolveContradiction
 * tool. A `tbl:` key closes the thinking engine's table row; any other key is a
 * BrainMemory row (lifted verbatim from PATCH /api/contradictions):
 * `resolveContradiction` returns null when the row is missing OR its content
 * JSON is corrupt, so both throw ServiceError(404). The route and the tRPC
 * `brain.resolveContradiction` procedure both call this.
 */
export async function resolveStoredContradiction(input: {
  key: string;
  status: ContradictionResolveChoice;
  note?: string;
}): Promise<{ contradiction: PanelContradiction; alreadyResolved?: boolean; resolvedHow?: string | null }> {
  if (input.key.startsWith(TABLE_KEY_PREFIX)) {
    // The table has no note column: the answer itself is the record.
    return resolveTableContradiction(input.key.slice(TABLE_KEY_PREFIX.length), input.status);
  }
  const resolved = await resolveContradiction(
    input.key,
    input.status,
    input.note,
  );
  if (!resolved) {
    throw new ServiceError("contradiction not found", 404);
  }
  return { contradiction: { ...resolved, source: "memory" } };
}
