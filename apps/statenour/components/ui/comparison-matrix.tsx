"use client";

/**
 * ComparisonMatrix · v10.0.553 · color-coded options × criteria grid.
 *
 * The "faster screen reading" primitive — drop in a list of options
 * and a list of criteria, get back a dense HTML table where every
 * cell is tinted relative to the OTHER options on the same criterion
 * (per-column normalization). Top 30% emerald, middle amber, bottom
 * 30% rose. Null cells are untinted.
 *
 * Use cases:
 *   · Decision detail · siblings × {grade, recency, review status}
 *   · Vendor comparison · vendor × {price, lead-time, MOQ}
 *   · Model bake-off · model × {pass-rate, p50, $/turn}
 *   · Skill bench · skill × {usage, recency, mastery}
 *
 * Design system rules baked in:
 *   · Editorial typography (ui-monospace headers, tabular-nums cells)
 *   · Gold accent for active-sort indicator
 *   · Glass-card host (border-soft + bg-card)
 *   · Sticky option-label column (left) + sticky header row (top)
 *   · No purple gradients · gold-on-dark only
 *   · Horizontal scroll on mobile (dense grid stays a grid · no card stacks)
 *
 * Accessibility:
 *   · <th scope="col"> for headers, <th scope="row"> for option labels
 *   · aria-sort on the active-sort header
 *   · cell `title` attribute exposes raw value to screen readers
 *   · headers are keyboard-focusable (tabIndex=0); Enter/Space toggles sort
 */

import { useMemo, useState, useCallback } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

// ── Public types ────────────────────────────────────────────────────────

export interface MatrixOption {
  id: string;
  label: string;
  [k: string]: unknown;
}

export interface MatrixCriterion {
  id: string;
  label: string;
  /** Optional weight (informational only · matrix doesn't roll up totals). */
  weight?: number;
  /** Default true · higher score = better · controls top/bottom 30% tinting. */
  higherIsBetter?: boolean;
}

export interface MatrixCell {
  /** The raw value to display (or null for "n/a"). */
  value: number | string | null;
  /** 0..1 normalized score. If omitted, value-based ranking is used. */
  score?: number;
  /** Optional display override (e.g. "$1,200" instead of 1200). */
  display?: string;
}

export interface ComparisonMatrixProps {
  options: ReadonlyArray<MatrixOption>;
  criteria: ReadonlyArray<MatrixCriterion>;
  cells: (option: MatrixOption, criterion: MatrixCriterion) => MatrixCell;
  title?: string;
  caption?: string;
  /** Initial sort column id · defaults to the first criterion. */
  defaultSortCriterion?: string;
  /** Optional className passthrough for outer host. */
  className?: string;
}

// ── Internal helpers ────────────────────────────────────────────────────

type Tint = "emerald" | "amber" | "rose" | "neutral";

/**
 * Per-column tint resolver · ranks all option scores within ONE
 * criterion and tints by quantile.
 *
 *   top 30% (or top 1 if ≤3 options) → emerald
 *   bottom 30% (or bottom 1)         → rose
 *   middle band                       → amber
 *   null/non-comparable               → neutral
 *
 * When `higherIsBetter === false`, the ranking inverts (lowest is best).
 */
function buildTintMap(
  options: ReadonlyArray<MatrixOption>,
  criterion: MatrixCriterion,
  resolveCell: (o: MatrixOption, c: MatrixCriterion) => MatrixCell,
): Map<string, Tint> {
  const map = new Map<string, Tint>();
  const scored: Array<{ id: string; key: number }> = [];

  for (const opt of options) {
    const cell = resolveCell(opt, criterion);
    if (cell.value === null) {
      map.set(opt.id, "neutral");
      continue;
    }
    // Prefer explicit score; else use the value if numeric; else neutral.
    let key: number | null = null;
    if (typeof cell.score === "number" && Number.isFinite(cell.score)) {
      key = cell.score;
    } else if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
      key = cell.value;
    }
    if (key === null) {
      map.set(opt.id, "neutral");
      continue;
    }
    scored.push({ id: opt.id, key });
  }

  if (scored.length === 0) return map;

  // Sort descending by score (best first) · flip when lower-is-better.
  const lowerIsBetter = criterion.higherIsBetter === false;
  scored.sort((a, b) => (lowerIsBetter ? a.key - b.key : b.key - a.key));

  // Quantile thresholds · with ≤3 scored options we degrade to
  // top-1 / bottom-1 so the matrix is still readable for small sets.
  const n = scored.length;
  const topCount = n <= 3 ? 1 : Math.max(1, Math.ceil(n * 0.3));
  const bottomCount = n <= 3 ? 1 : Math.max(1, Math.ceil(n * 0.3));

  for (let i = 0; i < scored.length; i += 1) {
    const tint: Tint =
      i < topCount
        ? "emerald"
        : i >= scored.length - bottomCount
          ? "rose"
          : "amber";
    map.set(scored[i].id, tint);
  }

  return map;
}

const TINT_CLASS: Record<Tint, string> = {
  emerald: "bg-emerald-500/15 text-emerald-300",
  amber: "bg-amber-500/15 text-amber-300",
  rose: "bg-rose-500/15 text-rose-300",
  neutral: "text-zinc-500",
};

function formatCell(cell: MatrixCell): string {
  if (cell.display !== undefined) return cell.display;
  if (cell.value === null) return "—";
  if (typeof cell.value === "number") {
    // Two-decimal default for floats, untouched for integers.
    return Number.isInteger(cell.value)
      ? String(cell.value)
      : cell.value.toFixed(2);
  }
  return String(cell.value);
}

/**
 * Sort key for a row · uses score when available, otherwise the raw
 * numeric value, otherwise the string value (lexicographic). Null
 * cells sink to the bottom regardless of direction.
 */
function rowSortKey(cell: MatrixCell): { key: number | string; isNull: boolean } {
  if (cell.value === null) return { key: 0, isNull: true };
  if (typeof cell.score === "number" && Number.isFinite(cell.score)) {
    return { key: cell.score, isNull: false };
  }
  if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
    return { key: cell.value, isNull: false };
  }
  return { key: String(cell.value).toLowerCase(), isNull: false };
}

// ── Component ───────────────────────────────────────────────────────────

export function ComparisonMatrix({
  options,
  criteria,
  cells,
  title,
  caption,
  defaultSortCriterion,
  className,
}: ComparisonMatrixProps) {
  // Empty-state guard · the spec calls for graceful rendering when
  // either dimension is empty. We still emit the table shell so the
  // host page's layout doesn't collapse to zero height.
  const hasData = options.length > 0 && criteria.length > 0;

  const [sortId, setSortId] = useState<string>(
    defaultSortCriterion ?? criteria[0]?.id ?? "",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = useCallback(
    (criterionId: string) => {
      setSortId((prev) => {
        if (prev === criterionId) {
          setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return prev;
        }
        // Switching column · default to descending (best-first).
        setSortDir("desc");
        return criterionId;
      });
    },
    [],
  );

  const handleHeaderKey = useCallback(
    (e: KeyboardEvent<HTMLTableCellElement>, criterionId: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSort(criterionId);
      }
    },
    [toggleSort],
  );

  // Pre-compute per-criterion tint maps · one pass per column.
  // Memoized so re-renders driven by `sortDir` don't re-rank.
  const tintByCriterion = useMemo(() => {
    const out = new Map<string, Map<string, Tint>>();
    for (const crit of criteria) {
      out.set(crit.id, buildTintMap(options, crit, cells));
    }
    return out;
  }, [options, criteria, cells]);

  // Sorted option order · memoized on sort state.
  const sortedOptions = useMemo(() => {
    if (!sortId) return options;
    const sortCriterion = criteria.find((c) => c.id === sortId);
    if (!sortCriterion) return options;
    const copy = [...options];
    copy.sort((a, b) => {
      const ka = rowSortKey(cells(a, sortCriterion));
      const kb = rowSortKey(cells(b, sortCriterion));
      if (ka.isNull && kb.isNull) return 0;
      if (ka.isNull) return 1; // nulls always last
      if (kb.isNull) return -1;
      if (typeof ka.key === "number" && typeof kb.key === "number") {
        return sortDir === "asc" ? ka.key - kb.key : kb.key - ka.key;
      }
      return sortDir === "asc"
        ? String(ka.key).localeCompare(String(kb.key))
        : String(kb.key).localeCompare(String(ka.key));
    });
    return copy;
  }, [options, criteria, cells, sortId, sortDir]);

  return (
    <section
      className={cn(
        "rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] overflow-hidden",
        className,
      )}
    >
      {(title || caption) && (
        <header className="px-4 sm:px-5 pt-4 pb-3 border-b border-[var(--border-soft)]">
          {title && (
            <h3 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              {title}
            </h3>
          )}
          {caption && (
            <p className="mt-1 text-[12px] text-[var(--text-secondary)] leading-relaxed">
              {caption}
            </p>
          )}
        </header>
      )}

      {!hasData ? (
        <div className="px-4 sm:px-5 py-6 text-[11px] text-[var(--text-tertiary)] italic">
          {options.length === 0
            ? "no options to compare"
            : "no criteria defined"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-[var(--bg-card)]">
              <tr className="border-b border-[var(--border-soft)]">
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-[var(--bg-card)] px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] min-w-[160px] border-r border-[var(--border-soft)]"
                >
                  option
                </th>
                {criteria.map((crit) => {
                  const isActive = crit.id === sortId;
                  const ariaSort: "ascending" | "descending" | "none" = isActive
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                  return (
                    <th
                      key={crit.id}
                      scope="col"
                      aria-sort={ariaSort}
                      tabIndex={0}
                      role="columnheader"
                      onClick={() => toggleSort(crit.id)}
                      onKeyDown={(e) => handleHeaderKey(e, crit.id)}
                      className={cn(
                        "px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wider whitespace-nowrap cursor-pointer select-none transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/60",
                        isActive
                          ? "text-[var(--gold)]"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                      )}
                      title={
                        crit.weight !== undefined
                          ? `${crit.label} · weight ${crit.weight}`
                          : crit.label
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {crit.label}
                        <span
                          aria-hidden="true"
                          className={cn(
                            "inline-block text-[9px] leading-none",
                            isActive ? "opacity-100" : "opacity-30",
                          )}
                        >
                          {isActive
                            ? sortDir === "asc"
                              ? "▲"
                              : "▼"
                            : "↕"}
                        </span>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedOptions.map((opt, rowIdx) => (
                <tr
                  key={opt.id}
                  className={cn(
                    "border-b border-[var(--border-soft)]/50 hover:bg-[color-mix(in_oklab,var(--bg-card)_92%,var(--gold)_4%)] transition-colors",
                    rowIdx === sortedOptions.length - 1 && "border-b-0",
                  )}
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-[5] bg-[var(--bg-card)] px-3 py-2 text-left text-[12px] font-medium text-[var(--text-primary)] min-w-[160px] border-r border-[var(--border-soft)] align-top"
                  >
                    {opt.label}
                  </th>
                  {criteria.map((crit) => {
                    const cell = cells(opt, crit);
                    const tint = tintByCriterion.get(crit.id)?.get(opt.id) ?? "neutral";
                    return (
                      <td
                        key={crit.id}
                        className={cn(
                          "px-3 py-2 tabular-nums whitespace-nowrap align-top",
                          TINT_CLASS[tint],
                        )}
                        title={
                          cell.value === null
                            ? "no data"
                            : `${crit.label}: ${String(cell.value)}`
                        }
                        data-tint={tint}
                      >
                        {formatCell(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
