/**
 * Shared admin row + secondary-navigation primitives —
 * ClickableRow, RowAction, FilterChips, TabBar, SearchInput, Breadcrumbs.
 */
import React from "react";
import { XCircle, Search } from "lucide-react";

// ─── ROW PRIMITIVES ─────────────────────────────────────────────────────────
// 2026-05-23 · extracted after fixing 5+ "row looks tappable but isn't"
// bugs across the admin. Every list surface (priority queue · pickup
// queue · at-risk whales · snap apps · etc.) was rebuilding the same
// pattern: a div with cursor-pointer + onClick + inner action buttons
// that needed e.stopPropagation. The exact set of bugs varied — some
// rows had only the icon clickable, some had no keyboard nav, some
// had action buttons that ALSO triggered the row click.
//
// ClickableRow standardizes the row container · RowAction standardizes
// the inline action button/anchor with built-in stopPropagation.
// Together they make the bug class impossible to reintroduce.

interface ClickableRowProps {
  /** Called on tap, Enter, or Space. Omit for a non-interactive row
   *  (no cursor pointer, no focus ring, no event handlers). */
  onClick?: () => void;
  /** aria-label for the row (when interactive). */
  ariaLabel?: string;
  /** Extra classes appended to the base row styling. */
  className?: string;
  children: React.ReactNode;
}

/** Standard clickable list-row. Whole row is the tap target (44pt+ on
 *  mobile). Action buttons inside should use `<RowAction>` so taps on
 *  them don't ALSO trigger the row's onClick. */
export function ClickableRow({ onClick, ariaLabel, className = "", children }: ClickableRowProps) {
  if (!onClick) {
    return (
      <div className={`flex items-center gap-3 px-3 py-2.5 ${className}`}>
        {children}
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 ${className}`}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

type RowActionCommon = {
  icon: React.ReactNode;
  title: string;
  /** Tailwind hover classes for the icon + bg. Defaults to primary tint. */
  hoverClass?: string;
  /** aria-label override. Defaults to `title`. */
  ariaLabel?: string;
  /** Extra classes appended to the base button/anchor styling. */
  className?: string;
};

type RowActionProps =
  | (RowActionCommon & { onClick: (e: React.MouseEvent) => void; disabled?: boolean; href?: never })
  | (RowActionCommon & { href: string; onClick?: never; disabled?: never });

/** Standard row-action icon (call · sms · mark done · delete · etc).
 *  stopPropagation is built in so taps on the action don't trigger
 *  the parent ClickableRow's onClick. */
export function RowAction(props: RowActionProps) {
  const hover = props.hoverClass ?? "hover:text-primary hover:bg-primary/10";
  const baseClass = `inline-flex items-center justify-center p-2.5 sm:p-1.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 text-foreground/40 ${hover} rounded transition-all disabled:opacity-30 ${props.className ?? ""}`;
  const aria = props.ariaLabel ?? props.title;
  if ("href" in props && props.href) {
    return (
      <a
        href={props.href}
        onClick={(e) => e.stopPropagation()}
        className={baseClass}
        title={props.title}
        aria-label={aria}
      >
        {props.icon}
      </a>
    );
  }
  // After the href branch above, TS still sees props as the union.
  // Cast to the click-variant so destructure narrows cleanly.
  const clickProps = props as Extract<RowActionProps, { onClick: (e: React.MouseEvent) => void }>;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); clickProps.onClick(e); }}
      disabled={clickProps.disabled}
      className={baseClass}
      title={props.title}
      aria-label={aria}
    >
      {props.icon}
    </button>
  );
}

// ─── 2026-05-06 — FILTER CHIPS ─────────────────────────────
// Visual affordance showing currently-active URL filters with one-click
// reset. Pair with useUrlFilter — when a filter is at its default, it
// renders no chip; non-default values get a chip with an X.
//
// Usage:
//   <FilterChips chips={[
//     { label: "Status", value: leadFilter, default: "all", onClear: () => setLeadFilter("all") },
//     { label: "Search", value: searchQuery, default: "", onClear: () => setSearchQuery("") },
//   ]} />
//
// Renders nothing when ALL filters are at default. Drop in at top of
// any list/grid for a "what am I currently filtering by?" indicator.

interface FilterChipDef {
  label: string;
  value: string;
  default: string;
  onClear: () => void;
  /** Optional: render a friendlier display value (e.g. "All" for "all") */
  displayValue?: string;
}

export function FilterChips({ chips, onClearAll }: {
  chips: FilterChipDef[];
  /** Optional master clear — clears every active filter */
  onClearAll?: () => void;
}) {
  const active = chips.filter((c) => c.value !== c.default && c.value !== "");
  if (active.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap py-1">
      <span className="text-[10px] font-bold tracking-[0.15em] text-foreground/40 uppercase">
        Filtered by
      </span>
      {active.map((chip) => (
        <span
          key={chip.label}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] bg-primary/10 text-primary border border-primary/20"
        >
          <span className="text-primary/60">{chip.label}:</span>
          <span className="font-medium">{chip.displayValue || chip.value}</span>
          <button
            onClick={chip.onClear}
            className="p-1 sm:p-0 text-primary/50 hover:text-primary transition-colors inline-flex items-center justify-center"
            aria-label={`Clear ${chip.label} filter`}
          >
            <XCircle className="w-4 h-4 sm:w-3 sm:h-3" />
          </button>
        </span>
      ))}
      {active.length > 1 && onClearAll && (
        <button
          onClick={onClearAll}
          className="text-[11px] text-foreground/50 hover:text-primary transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ─── 2026-05-06 — TABBAR / SEARCH / BREADCRUMBS / TIMESTAMP ──
// Unified secondary-navigation primitives. Replaces ~6 different
// in-section tab implementations + ad-hoc search + ad-hoc "last
// refreshed" timestamps. Net: identical interaction language
// everywhere in admin.

interface TabBarItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
  /** Optional sub-label rendered under the label */
  subtitle?: string;
}

/**
 * TabBar — the canonical secondary navigation pattern. Used inside
 * a section to switch between sub-views (e.g. Customers → Loyalty →
 * Coupons, or Revenue → Daily → Invoices → Forecast).
 *
 * Two variants:
 *   - `border` (default): underline-style, tighter, fits long lists
 *   - `pill`: rounded-button style, fits 2-4 short tabs
 */
export function TabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
  variant = "border",
  size = "default",
}: {
  tabs: TabBarItem<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  variant?: "border" | "pill";
  size?: "default" | "compact";
}) {
  if (variant === "pill") {
    return (
      <div className="inline-flex items-center gap-1 bg-card/50 border border-border/30 p-1 rounded-md">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-3 ${size === "compact" ? "py-2.5 sm:py-1" : "py-3 sm:py-1.5"} text-[12px] font-bold tracking-wide rounded transition-all whitespace-nowrap ${
              activeTab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-foreground/50 hover:text-foreground/80 hover:bg-foreground/5"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== "" && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                activeTab === t.id ? "bg-primary-foreground/15 text-primary-foreground" : "bg-foreground/10 text-foreground/60"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 border-b border-border/20 overflow-x-auto">
      {tabs.map((t) => {
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-1.5 px-4 ${size === "compact" ? "py-3 sm:py-1.5" : "py-3.5 sm:py-2.5"} text-[12px] font-bold tracking-wide border-b-2 transition-colors whitespace-nowrap ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-foreground/40 hover:text-foreground/70"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== "" && (
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                active ? "bg-primary/15 text-primary" : "bg-foreground/10 text-foreground/60"
              }`}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * SearchInput — canonical text-search field for any list/grid in admin.
 * Replaces ~12 different inline search input styles.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  size = "default",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: "default" | "compact";
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-background border border-border/30 text-foreground pl-9 pr-3 ${size === "compact" ? "py-1.5 text-[12px]" : "py-2 text-[13px]"} rounded focus:border-primary focus:outline-none placeholder:text-foreground/30`}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground/60"
          aria-label="Clear search"
        >
          <XCircle className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Breadcrumbs — section / sub-section / detail. Used inside a section
 * when there's a deep view (e.g. Customers → John Smith → Edit).
 * onClick on a non-final crumb navigates back.
 */
export function Breadcrumbs({
  items,
}: {
  items: Array<{ label: string; onClick?: () => void }>;
}) {
  return (
    <nav className="flex items-center gap-1.5 text-[11px] text-foreground/40 flex-wrap">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <React.Fragment key={i}>
            {item.onClick && !isLast ? (
              <button
                onClick={item.onClick}
                className="hover:text-foreground transition-colors"
              >
                {item.label}
              </button>
            ) : (
              <span className={isLast ? "text-foreground font-medium" : ""}>
                {item.label}
              </span>
            )}
            {!isLast && <span className="text-foreground/20">/</span>}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
