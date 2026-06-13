"use client";

/**
 * TaskFilters · v10.0.326 · the filter row + indicator chips for /tasks.
 *
 * Stage B.2 of the /tasks decomposition campaign · v10.0.311 (Stage A)
 * extracted NowOperatorBar · v10.0.325 (Stage B.1) extracted QuickAddBar ·
 * this lifts ~295 LOC of inline filter UI into one typed component.
 *
 * Encapsulates BOTH:
 *   1. The expanded filter panel (`showFilters && ...`):
 *      · Kind pills (All / Tasks / Routines / Promises) · with anchor logic
 *      · Domain pills (anchors + custom + auto-derived + edit affordances)
 *      · "+ add" inline domain input
 *      · "edit" mode toggle for removing custom domains
 *      · Search input (only when 5+ active loops)
 *   2. The collapsed-state active-filter indicator chips (when
 *      showFilters=false but a filter is set)
 *
 * Why one component for both: the active-filter indicator is the
 * shadow-mode of the expanded filter panel. They share state + react
 * to the same setters. Splitting them creates two components that
 * always co-render with the same prop bag.
 *
 * 19 props sounds like a lot but each is a single primitive or
 * setter · per kaizen "right tool for the job", combining them into
 * a `filterState` blob would just push the prop count somewhere else
 * AND obscure the parent's state-of-truth. The standard React lift-
 * state-up pattern wins.
 */

import { Input } from "@/components/ui/input";
import { Target, Flame, Handshake, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { domainClass as dc, type LoopKind } from "@/components/actions/shared";

type KindFilter = "all" | LoopKind;

interface DomainAgg {
  name: string;
  count: number;
}

interface TaskFiltersProps {
  showFilters: boolean;
  kindFilter: KindFilter;
  setKindFilter: (k: KindFilter) => void;
  domainFilter: string | null;
  setDomainFilter: (d: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** Counts for the kind-pill row · ONCE / DAILY / PROMISE */
  onceCount: number;
  dailyCount: number;
  promiseCount: number;
  /** Total active loops · drives the "all" pill display + showSearch threshold */
  activeCount: number;
  /** Domains derived from active loops · sorted by count desc */
  activeDomains: DomainAgg[];
  customDomains: string[];
  setCustomDomains: (updater: (prev: string[]) => string[]) => void;
  addingDomain: boolean;
  setAddingDomain: (v: boolean) => void;
  newDomainInput: string;
  setNewDomainInput: (s: string) => void;
  filterEditMode: boolean;
  setFilterEditMode: (updater: (prev: boolean) => boolean) => void;
}

const ANCHOR_DOMAINS = ["work", "personal", "health"] as const;

export function TaskFilters({
  showFilters,
  kindFilter,
  setKindFilter,
  domainFilter,
  setDomainFilter,
  searchQuery,
  setSearchQuery,
  onceCount,
  dailyCount,
  promiseCount,
  activeCount,
  activeDomains,
  customDomains,
  setCustomDomains,
  addingDomain,
  setAddingDomain,
  newDomainInput,
  setNewDomainInput,
  filterEditMode,
  setFilterEditMode,
}: TaskFiltersProps) {
  return (
    <>
      {/* ── Filters — toggled via the sliders icon.
          Apr 27 · STALE-CLEANUP — was a wall of dead chrome (DAILY 0,
          PROMISES 0, ALL DOMAINS pill, empty search). Now:
            · Kind pills hide buckets with count 0 (and skip the
              whole row when only "all" remains)
            · Domain pills hide when only one active domain
            · Search auto-focuses when revealed; empty placeholder
              is replaced with the actual count ("Search 16 loops…")
            · "All" pill auto-removed when there's nothing to
              contrast against. */}
      {showFilters && (() => {
        const getSearchPlaceholder = () => {
          const kindLabel = 
            kindFilter === "ONCE" ? "tasks" : 
            kindFilter === "DAILY" ? "routines" : 
            kindFilter === "PROMISE" ? "promises" : 
            "items";
            
          const count = 
            kindFilter === "ONCE" ? onceCount : 
            kindFilter === "DAILY" ? dailyCount : 
            kindFilter === "PROMISE" ? promiseCount : 
            activeCount;

          if (domainFilter) {
            return `Search ${count} ${kindLabel} in ${domainFilter.toLowerCase()}…`;
          }
          return `Search ${count} ${kindLabel}…`;
        };

        // Apr 27 · USER-PINNED — Routines (DAILY kind, renamed to
        // human language) + Work (domain) are always visible per
        // Nour's request, so he can pivot to them in one tap even
        // when no tasks currently fit. Other auto-derived buckets
        // still hide at count 0 to avoid dead chrome.
        const kindOptionsAll = [
          { key: "ONCE" as KindFilter, label: "Tasks", count: onceCount, color: "text-blue-400", icon: <Target size={8} />, alwaysShow: false },
          { key: "DAILY" as KindFilter, label: "Routines", count: dailyCount, color: "text-amber-400", icon: <Flame size={8} />, alwaysShow: true },
          { key: "PROMISE" as KindFilter, label: "Promises", count: promiseCount, color: "text-rose-300", icon: <Handshake size={8} />, alwaysShow: false },
        ];
        const kindOptions = kindOptionsAll.filter((k) => k.alwaysShow || k.count > 0);
        // Domain row composition (Apr 27):
        //   1. Anchors (work/personal/health) — always shown, immutable
        //   2. Custom domains added by Nour via "+ add" — removable
        //   3. Auto-derived from existing tasks — shown only if not
        //      already in anchors or customs (and count > 0)
        // Edit mode reveals × on anchors-and-customs to remove (anchors
        // are protected from removal but show a disabled × so the UI
        // is consistent).
        const anchorEntries = ANCHOR_DOMAINS.map((name) => ({
          name,
          count: activeDomains.find((d) => d.name.toLowerCase() === name)?.count ?? 0,
          isAnchor: true as const,
          isCustom: false as const,
        }));
        const customEntries = customDomains
          .filter(
            (name) =>
              !ANCHOR_DOMAINS.includes(name as (typeof ANCHOR_DOMAINS)[number]),
          )
          .map((name) => ({
            name,
            count:
              activeDomains.find((d) => d.name.toLowerCase() === name)?.count ?? 0,
            isAnchor: false as const,
            isCustom: true as const,
          }));
        const knownNames = new Set([
          ...ANCHOR_DOMAINS,
          ...customDomains,
        ]);
        const otherDomains = activeDomains
          .filter((d) => !knownNames.has(d.name.toLowerCase()))
          .map((d) => ({
            name: d.name,
            count: d.count,
            isAnchor: false as const,
            isCustom: false as const,
          }));
        const showKindRow = kindOptions.length >= 1; // Routines anchor guarantees >= 1
        const showDomainRow = true; // anchors guarantee row is meaningful
        const showSearch = activeCount >= 5; // search is useless under 5 items — eyeball it
        if (!showKindRow && !showDomainRow && !showSearch) {
          return (
            <div className="rounded-lg bg-zinc-900/30 border border-zinc-800/20 px-2.5 py-1.5 text-[9px] text-zinc-600 italic">
              Nothing to filter — {activeCount} routine{activeCount === 1 ? "" : "s"} on deck.
            </div>
          );
        }
        return (
          <div className="rounded-lg bg-zinc-900/50 border border-zinc-800/30 p-2.5 space-y-2">
            {/* Kind pills — hidden when only one bucket has tasks */}
            {showKindRow && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setKindFilter("all")}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all",
                    kindFilter === "all"
                      ? "text-amber-400 bg-zinc-800/80 border-zinc-700"
                      : "text-zinc-600 border-zinc-800/30 hover:text-zinc-400"
                  )}
                >
                  All <span className="opacity-50 font-mono">{activeCount}</span>
                </button>
                {kindOptions.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setKindFilter(f.key)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition-all",
                      kindFilter === f.key
                        ? `${f.color} bg-zinc-800/80 border-zinc-700`
                        : "text-zinc-600 border-zinc-800/30 hover:text-zinc-400"
                    )}
                  >
                    {f.icon}
                    {f.label}
                    <span className="opacity-50 font-mono">{f.count}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Domain pills — Apr 27 · anchors + custom + auto +
                edit affordances. Edit mode reveals × on each editable
                pill so Nour can remove what he doesn't want. The
                "+ add" button at the end of the row opens an inline
                input. Tapping "edit" again exits edit mode.
                Anchors (work/personal/health) cannot be removed but
                participate in the same UI rhythm. */}
            {showDomainRow && (
              <div className="flex items-center gap-1 flex-wrap">
                <button
                  onClick={() => setDomainFilter(null)}
                  className={cn(
                    "text-[8px] px-2 py-0.5 rounded-full border uppercase tracking-wider transition-all",
                    !domainFilter
                      ? "bg-zinc-700/50 text-zinc-200 border-zinc-600"
                      : "text-zinc-600 border-zinc-800/40 hover:text-zinc-400"
                  )}
                >
                  all
                </button>
                {[...anchorEntries, ...customEntries, ...otherDomains].map((d) => {
                  const removable = d.isCustom; // anchors + auto-derived not removable
                  return (
                    <span
                      key={d.name}
                      className="inline-flex items-center"
                    >
                      <button
                        onClick={() =>
                          setDomainFilter(domainFilter === d.name ? null : d.name)
                        }
                        className={cn(
                          "text-[8px] px-2 py-0.5 rounded-full border uppercase tracking-wider transition-all",
                          domainFilter === d.name
                            ? cn(dc(d.name), "border-current/30")
                            : d.count === 0
                              ? "text-zinc-700 border-zinc-800/30 hover:text-zinc-500"
                              : "text-zinc-600 border-zinc-800/40 hover:text-zinc-400",
                          // In edit mode, attach right edge to the × button
                          filterEditMode && removable && "rounded-r-none",
                        )}
                        title={
                          d.count === 0
                            ? `No ${d.name} loops yet — tap to filter when you have some`
                            : `Filter to ${d.name}`
                        }
                      >
                        {d.name}
                        <span
                          className={cn(
                            "ml-1",
                            d.count === 0 ? "opacity-30" : "opacity-60",
                          )}
                        >
                          {d.count}
                        </span>
                      </button>
                      {filterEditMode && removable && (
                        <button
                          onClick={() => {
                            setCustomDomains((prev) =>
                              prev.filter((n) => n !== d.name),
                            );
                            if (domainFilter === d.name) setDomainFilter(null);
                          }}
                          className="text-[8px] px-1.5 py-0.5 rounded-r-full border border-l-0 border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/30"
                          title={`Remove "${d.name}" from your filters`}
                        >
                          ✕
                        </button>
                      )}
                    </span>
                  );
                })}
                {/* + add inline input */}
                {addingDomain ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={newDomainInput}
                      onChange={(e) => setNewDomainInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const name = newDomainInput.trim().toLowerCase();
                          if (
                            name &&
                            !customDomains.includes(name) &&
                            !ANCHOR_DOMAINS.includes(
                              name as (typeof ANCHOR_DOMAINS)[number],
                            )
                          ) {
                            setCustomDomains((prev) => [...prev, name]);
                            setDomainFilter(name);
                          }
                          setAddingDomain(false);
                          setNewDomainInput("");
                        } else if (e.key === "Escape") {
                          setAddingDomain(false);
                          setNewDomainInput("");
                        }
                      }}
                      placeholder="domain name"
                      className="text-[9px] px-2 py-0.5 rounded-full border border-blue-500/40 bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-blue-500 w-28"
                    />
                    <button
                      onClick={() => {
                        setAddingDomain(false);
                        setNewDomainInput("");
                      }}
                      className="text-[8px] text-zinc-600 hover:text-zinc-300"
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setAddingDomain(true)}
                    className="text-[8px] px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/5 text-blue-300 uppercase tracking-wider hover:bg-blue-500/15"
                    title="Add a custom domain (e.g. learning, finance)"
                  >
                    + add
                  </button>
                )}
                {/* edit toggle — only when there's something removable */}
                {customEntries.length > 0 && (
                  <button
                    onClick={() => setFilterEditMode((v) => !v)}
                    className={cn(
                      "text-[8px] px-2 py-0.5 rounded-full border uppercase tracking-wider transition-all",
                      filterEditMode
                        ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                        : "text-zinc-600 border-zinc-800/40 hover:text-zinc-400",
                    )}
                    title={
                      filterEditMode
                        ? "Done editing"
                        : "Show × to remove custom domains"
                    }
                  >
                    {filterEditMode ? "done" : "edit"}
                  </button>
                )}
              </div>
            )}
            {/* Search — only renders when 5+ loops (otherwise eyeball) */}
            {showSearch && (
              <div className="flex items-center gap-1.5">
                <Search size={11} className="text-zinc-600 shrink-0" />
                <Input
                  placeholder={getSearchPlaceholder()}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 bg-zinc-900/60 border-zinc-800/40 text-[11px] placeholder:text-zinc-700"
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* 2026-05-24 · Wave U ux-F4 · pre-fix THREE filter-state
          surfaces competed for the operator's eye:
            (a) this collapsed-state indicator chips block
            (b) the always-visible ActiveFiltersStrip rendered by the
                /tasks page directly below TaskFilters
            (c) the expanded TaskFilters panel itself
          Operator saw the same `kind · ONCE × | domain · work ×`
          rendered twice with different remove affordances · classic
          Nielsen #4 violation (consistency). The page-level
          ActiveFiltersStrip is the canonical surface · deleting this
          block removes the duplicate without losing affordance. */}
    </>
  );
}
