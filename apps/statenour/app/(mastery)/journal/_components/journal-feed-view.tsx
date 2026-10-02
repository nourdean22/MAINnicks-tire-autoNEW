"use client";

import { useMemo, useState } from "react";
import { Search, X as XIcon, NotebookPen, Calendar } from "lucide-react";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { JournalEntryRow } from "@/components/journal/entry-row";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { ActiveFiltersStrip } from "@/components/ui/filter-chip-bar";
import { useJournalFeed } from "../_hooks/use-journal-feed";

export function JournalFeedView() {
  const {
    entries,
    counts,
    isLoading,
    isFetchingMore,
    degraded,
    error,
    source,
    setSourceFilter,
    type,
    setTypeFilter,
    search,
    setSearch,
    loadMore,
    hasMore,
  } = useJournalFeed();

  const [sortKey, setSortKey] = useState<"newest" | "oldest" | "alpha-asc" | "alpha-desc" | "longest" | "shortest">("newest");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Feed v2 (audit 2026-07-15) · search now runs SERVER-SIDE (the hook
  // debounces the input into the query), so matches anywhere in the
  // archive surface — the old client filter only saw the loaded window.
  // Sorting stays client-side over the loaded pages.
  const filteredEntries = useMemo(() => {
    let result = entries;
    result = [...result].sort((a, b) => {
      if (sortKey === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortKey === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sortKey === "alpha-asc") return a.title.localeCompare(b.title);
      if (sortKey === "alpha-desc") return b.title.localeCompare(a.title);
      if (sortKey === "longest") return b.body.length - a.body.length;
      if (sortKey === "shortest") return a.body.length - b.body.length;
      return 0;
    });

    return result;
  }, [entries, sortKey]);

  // Group by date
  const byDate = useMemo(() => {
    const groups = new Map<string, typeof entries>();
    for (const e of filteredEntries) {
      const d = e.date;
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d)!.push(e);
    }
    // Sort dates descending
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredEntries]);

  const formatDay = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00Z");
    const today = new Date();
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yest.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <div className="space-y-5 animate-fade-in flex flex-col h-full">
      {/* Search & Sort */}
      <div className="flex gap-2 flex-wrap sm:flex-nowrap">
        <div className="relative flex-1 min-w-0">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-tertiary)" />
          <input
            type="text"
            placeholder="Search the whole journal archive..."
            aria-label="Search journal archive"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-8 py-2 min-h-[44px] sm:min-h-0 rounded-control bg-surface-interactive border border-edge-default text-[13px] text-fg placeholder:text-fg-tertiary outline-none focus:border-gold/40 transition-colors"
          />
          {search.length > 0 && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 min-h-[28px] min-w-[28px] flex items-center justify-center rounded-control text-fg-tertiary hover:text-fg hover:bg-surface-hover"
            >
              <XIcon size={12} />
            </button>
          )}
        </div>
        <SortDropdown
          value={sortKey}
          onChange={setSortKey as any}
          defaultValue="newest"
          ariaLabel="Sort journal entries"
          options={[
            { value: "newest", label: "newest first" },
            { value: "oldest", label: "oldest first" },
            { value: "alpha-asc", label: "title · A→Z" },
            { value: "alpha-desc", label: "title · Z→A" },
            { value: "longest", label: "body · longest" },
            { value: "shortest", label: "body · shortest" },
          ]}
        />
      </div>

      <ActiveFiltersStrip
        filters={[
          ...(search.trim() ? [{ label: `search · "${search.trim().slice(0, 20)}"`, onRemove: () => setSearch("") }] : []),
          ...(source !== "all" ? [{ label: `source · ${source}`, onRemove: () => setSourceFilter("all") }] : []),
          ...(type !== "all" ? [{ label: `type · ${type}`, onRemove: () => setTypeFilter("all") }] : []),
          ...(sortKey !== "newest" ? [{ label: `sort · ${sortKey}`, onRemove: () => setSortKey("newest") }] : []),
        ]}
        onClearAll={() => { setSearch(""); setSourceFilter("all"); setTypeFilter("all"); setSortKey("newest"); }}
      />

      {error && (
        <div className="mb-3 rounded-control border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-[12px] text-rose-200 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px]">{error}</span>
        </div>
      )}

      {/* Feed v2 · degraded-source banner — a failed silo query used to
          be swallowed silently, rendering a plausible-but-incomplete
          feed with zero signal. */}
      {degraded.length > 0 && (
        <div className="mb-3 rounded-control border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] font-mono text-amber-200">
          partial feed — failed source{degraded.length > 1 ? "s" : ""}: {degraded.join(", ")}
        </div>
      )}

      {/* Feed List */}
      <div className="flex-1 overflow-y-auto pb-20">
        <div className="space-y-5">
            {isLoading && entries.length === 0 ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <ShimmerSkeleton key={i} className="h-20 rounded-surface border border-edge-subtle" />
                ))}
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-12 rounded-surface border border-edge-subtle bg-content">
                <NotebookPen size={24} className="text-fg-tertiary mx-auto mb-3" />
                <p className="text-[13px] font-semibold text-fg-secondary">No thoughts captured yet in this filter.</p>
              </div>
            ) : (
              byDate.map(([date, dayEntries]) => (
                <div key={date} className="animate-fade-in">
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar size={11} className="text-(--text-tertiary)" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                      {formatDay(date)}
                    </span>
                    <div className="h-px flex-1 bg-edge-subtle" />
                    <span className="font-mono text-[11px] text-fg-tertiary">
                      {dayEntries.length} {dayEntries.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {dayEntries.map((entry, i) => (
                      <JournalEntryRow
                        key={entry.id}
                        entry={entry}
                        isExpanded={expandedId === entry.id}
                        onToggle={() => setExpandedId((curr) => (curr === entry.id ? null : entry.id))}
                        delay={0}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
        </div>
        
        {/* Feed v2 · cursor pagination — walks strictly-older pages
            (the old window-widening capped at 200 entries / 365 days). */}
        {hasMore && !isLoading && (
          <div className="pt-6 pb-12 flex justify-center">
            <button
              onClick={loadMore}
              disabled={isFetchingMore}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-60"
            >
              {isFetchingMore ? "Loading…" : "Load more archives"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
