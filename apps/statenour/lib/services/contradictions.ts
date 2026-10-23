/**
 * lib/services/contradictions.ts
 *
 * The `contradictions` TABLE is the one contradiction store: the thinking
 * engine's nightly "he said X, the record shows Y" rows (claim vs record).
 * This service lists them for the /brain panel, closes them with a
 * compare-and-swap, and counts the open ones for the Home row, the ticker chip
 * and the maturity header. The old BrainMemory(category="contradiction") path
 * (detector, memory-pair resolver) held 0 rows ever and was deleted 2026-10-23.
 *
 * Keys are `tbl:<id>`. The prefix is kept (not renamed) so any stored
 * follow-up row or deep link that carries it still resolves.
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

/** Panel status vocabulary (the three answers map onto it; both_valid has no meaning for a claim vs a record). */
export type ContradictionStatus =
  | "unresolved"
  | "current_wins"
  | "old_wins"
  | "both_valid"
  | "dismissed";

/** Resolve choice · the 4 non-"unresolved" statuses. */
export type ContradictionResolveChoice = Exclude<ContradictionStatus, "unresolved">;

const TABLE_KEY_PREFIX = "tbl:";

/** The three answers Nour gives a claim-vs-record row, as stored in `resolved_how`. */
export type TableResolvedHow = "true" | "outdated" | "ignore";

/**
 * Panel choice -> resolved_how. "true" = the record is right (the claim was wrong).
 * both_valid has no meaning for claim vs record and is refused (400), never stored as another answer.
 */
const RESOLVED_HOW: Record<Exclude<ContradictionResolveChoice, "both_valid">, TableResolvedHow> = {
  current_wins: "true",
  old_wins: "outdated",
  dismissed: "ignore",
};
const STATUS_FROM_HOW: Record<string, ContradictionResolveChoice> = {
  true: "current_wins",
  outdated: "old_wins",
  ignore: "dismissed",
};

/** A claim-vs-record row in the panel's shape: claim on the left, record on the right. */
export interface TableContradiction {
  key: string;
  source: "table";
  signal: "claim_gap";
  new_excerpt: string;
  old_excerpt: string;
  days_apart: number;
  surfaced_at: string;
  createdAt: string;
  /** "expired" = closed by memory-consolidation's 30-day auto-resolve, never Nour's answer. */
  status: ContradictionStatus | "expired";
  resolution_note: string | null;
  resolved_at: string | null;
  gap: string;
  category: string;
  severity: string;
  /** Where the claim came from; "ai_detected" (the thinking engine) is an inference, not his words. */
  claim_source: string;
  /** The ET day the thinking engine recorded it. */
  recorded: string;
}
export type PanelContradiction = TableContradiction;

const TABLE_SELECT = {
  id: true,
  date: true,
  claim: true,
  reality: true,
  gap: true,
  category: true,
  severity: true,
  claimSource: true,
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
  claimSource: string;
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
    claim_source: r.claimSource,
    recorded: r.date,
    days_apart: Math.max(0, Math.round((Date.now() - r.createdAt.getTime()) / 86400_000)),
    surfaced_at: r.createdAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    // A closure that is not one of the three answers (the 30-day auto-expiry,
    // memory-consolidation.ts) is "expired", with its own words as the note: never his "ignore".
    status: r.resolved ? (answered ?? "expired") : "unresolved",
    resolution_note: r.resolved && !answered ? r.resolvedHow : null,
    resolved_at: r.resolved ? r.updatedAt.toISOString() : null,
  };
}

/** An open claim-vs-record row: the one definition the panel's list, its total and the Home/ticker chips share. */
const OPEN_WHERE = { deletedAt: null, resolved: false } as const;

/**
 * How many claim-vs-record rows are open: the panel's own open total, for the Home row and the ticker chip.
 * REJECTS on a failed read, so a chip renders "unknown" and never a 0 (empty-vs-error).
 */
export function countUnresolvedContradictions(): Promise<number> {
  return prisma.contradiction.count({ where: OPEN_WHERE });
}

/**
 * List contradictions for the /brain panel · open rows by default, or the
 * newest closures (90 days) when `includeResolved`. The route and the tRPC
 * `brain.contradictions` procedure both call this. History reads RESOLVED
 * rows directly (so the 60+ open rows cannot fill the page before the tab's
 * filter runs). A failed table read REJECTS, so the panel renders its ERROR
 * state, never an empty ledger.
 */
export async function listStoredContradictions(input: {
  includeResolved: boolean;
}): Promise<{ contradictions: PanelContradiction[]; table: { total: number; shown: number } }> {
  // Open rows: all of them (the writer adds at most 4 a night and auto-expiry closes them at 30
  // days, so ~120 is the ceiling); the 500 cap is a backstop that the total below discloses.
  // History: a page of the newest closures, with the total beside it.
  const where = input.includeResolved
    ? { deletedAt: null, resolved: true, updatedAt: { gte: new Date(Date.now() - 90 * 86400_000) } }
    : OPEN_WHERE;
  const [tableRows, total] = await Promise.all([
    prisma.contradiction.findMany({
      where,
      orderBy: input.includeResolved ? { updatedAt: "desc" } : { createdAt: "desc" },
      take: input.includeResolved ? 60 : 500,
      select: TABLE_SELECT,
    }),
    prisma.contradiction.count({ where }),
  ]);
  return {
    contradictions: tableRows.map(toPanelRow),
    table: { total, shown: tableRows.length },
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
  if (status === "both_valid") {
    throw new ServiceError("both_valid does not apply to a claim-vs-record row: the record is right, outdated, or ignore", 400);
  }
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
 * tool. Only `tbl:` keys exist; any other key is a 404. The route and the tRPC
 * `brain.resolveContradiction` procedure both call this.
 */
export async function resolveStoredContradiction(input: {
  key: string;
  status: ContradictionResolveChoice;
  note?: string;
}): Promise<{ contradiction: PanelContradiction; alreadyResolved?: boolean; resolvedHow?: string | null }> {
  if (!input.key.startsWith(TABLE_KEY_PREFIX)) {
    throw new ServiceError("contradiction not found", 404);
  }
  // The table has no note column: the answer itself is the record.
  return resolveTableContradiction(input.key.slice(TABLE_KEY_PREFIX.length), input.status);
}
