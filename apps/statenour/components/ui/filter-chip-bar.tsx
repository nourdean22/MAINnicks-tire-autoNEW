"use client";

/**
 * components/ui/filter-chip-bar.tsx · v10.0.436
 *
 * Shared filter-chip component · canonical pattern for any single-
 * select category/origin filter row.
 *
 * Replaces inline chip-row JSX across /brain/wisdom (origin chips +
 * topic tabs), /system/skills (category chips), /tasks (kind +
 * domain). Same mobile-44px tap targets, same gold-on-active visual.
 *
 * Usage:
 *   <FilterChipBar
 *     value={cat}
 *     onChange={setCat}
 *     options={[
 *       { value: "", label: "all", count: data.totalSkills },
 *       ...categories.map((c) => ({ value: c.name, label: c.name, count: c.count })),
 *     ]}
 *     ariaLabel="Filter by category"
 *   />
 */

export interface FilterChipOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  /** Tone tint · "default" · "warn" · "ok" · "info". */
  tone?: "default" | "warn" | "ok" | "info";
  hint?: string;
}

interface FilterChipBarProps<T extends string = string> {
  value: T;
  onChange: (next: T) => void;
  options: FilterChipOption<T>[];
  ariaLabel?: string;
  className?: string;
  /** When false, applies a horizontal scroll container instead of wrapping. */
  wrap?: boolean;
}

const TONE_STYLES: Record<NonNullable<FilterChipOption["tone"]>, string> = {
  default: "border-edge-default text-fg-tertiary hover:border-edge-strong hover:text-fg-secondary",
  warn: "border-amber-500/30 text-amber-300 hover:border-amber-500/50",
  ok: "border-emerald-500/30 text-emerald-300 hover:border-emerald-500/50",
  info: "border-sky-500/30 text-sky-300 hover:border-sky-500/50",
};

export function FilterChipBar<T extends string = string>({
  value,
  onChange,
  options,
  ariaLabel = "Filter",
  className,
  wrap = true,
}: FilterChipBarProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={[
        "flex gap-1.5",
        wrap ? "flex-wrap" : "overflow-x-auto",
        className ?? "",
      ].join(" ")}
    >
      {options.map((o) => {
        const active = o.value === value;
        const tone = TONE_STYLES[o.tone ?? "default"];
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            title={o.hint}
            className={[
              "text-[13px] font-medium px-3 py-2 sm:px-2 sm:py-1 min-h-[44px] sm:min-h-0 rounded-control border transition-colors duration-[var(--motion-state)] shrink-0",
              active
                ? "border-accent text-fg bg-accent-soft"
                : tone,
            ].join(" ")}
          >
            {o.label}
            {typeof o.count === "number" && (
              <span className={`ml-1 ${active ? "text-fg-secondary" : "text-fg-tertiary"}`}>
                ({o.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── ActiveFiltersStrip · "you have N filters · clear" ──────────

interface ActiveFilter {
  label: string;
  onRemove: () => void;
}

interface ActiveFiltersStripProps {
  filters: ActiveFilter[];
  /** Optional callback for "clear all" button. */
  onClearAll?: () => void;
  className?: string;
}

/**
 * Shows the current filter state as removable chips. When there are
 * no active filters, renders nothing (caller doesn't need to gate).
 *
 * Use this above search results to give the operator a single
 * visible summary of "what's filtering my view right now".
 */
export function ActiveFiltersStrip({
  filters,
  onClearAll,
  className,
}: ActiveFiltersStripProps) {
  if (filters.length === 0) return null;
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className ?? ""}`}>
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
        active:
      </span>
      {filters.map((f, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-1 rounded-micro border border-edge-default bg-surface-interactive text-fg-secondary"
        >
          {f.label}
          <button
            type="button"
            onClick={f.onRemove}
            aria-label={`Remove filter ${f.label}`}
            className="text-[var(--text-tertiary)] hover:text-rose-400 transition-colors"
          >
            ×
          </button>
        </span>
      ))}
      {onClearAll && filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[13px] font-medium text-fg-tertiary hover:text-rose-400 px-2 py-1 transition-colors duration-[var(--motion-state)]"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
