"use client";

import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { onDataChanged } from "@/lib/events/data-change";
import type { SourceKey, TypeKey } from "@/components/journal/types";

const PAGE_SIZE = 50;

export function useJournalFeed(
  initialSource: SourceKey = "all",
  initialType: TypeKey = "all"
) {
  const [source, setSource] = useState<SourceKey>(initialSource);
  const [type, setType] = useState<TypeKey>(initialType);
  // Feed v2 (audit 2026-07-15) · server-side search. The raw input
  // value debounces 300ms into `search`, which keys the query — so the
  // archive is searchable end-to-end instead of filtering only the
  // loaded window (the old client-side filter capped out at the
  // 200-entry / 365-day load-more ceiling).
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const utils = trpc.useUtils();

  // Feed v2 · cursor pagination via useInfiniteQuery — LOAD MORE now
  // walks strictly-older pages instead of widening a limit/days window
  // that hard-capped at 200 entries / 365 days.
  const query = trpc.journal.feed.useInfiniteQuery(
    {
      source: source !== "all" ? source : undefined,
      type: type !== "all" ? type : null,
      limit: PAGE_SIZE,
      days: 365,
      search: search || undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      refetchOnWindowFocus: false, // Prevent feed jumps when switching tabs
      staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    }
  );

  // 2026-07-05 (audit) · listen to the cross-surface data-change bus.
  // ReflectComposer and the chat journal tools (logSituation /
  // journalDecision / reviewDecisionReplay) fire notifyDataChanged on
  // capture; invalidate forces a refetch regardless of staleTime.
  useEffect(() => {
    return onDataChanged(["journal", "any"], () => {
      void utils.journal.feed.invalidate();
    });
  }, [utils]);

  const pages = query.data?.pages ?? [];
  const entries = pages.flatMap((p) => p.entries);
  const counts = pages[0]?.counts ?? null;
  const degraded = pages.flatMap((p) => p.degraded ?? []);

  const loadMore = useCallback(() => {
    void query.fetchNextPage();
  }, [query]);

  const resetLimits = useCallback(() => {
    // Cursor pagination resets naturally when the query key changes.
  }, []);

  const setSourceFilter = useCallback(
    (newSource: SourceKey) => {
      setSource(newSource);
      resetLimits();
    },
    [resetLimits]
  );

  const setTypeFilter = useCallback(
    (newType: TypeKey) => {
      setType(newType);
      resetLimits();
    },
    [resetLimits]
  );

  return {
    entries,
    counts,
    degraded: [...new Set(degraded)],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingMore: query.isFetchingNextPage,
    error: query.error?.message ?? null,
    source,
    setSourceFilter,
    type,
    setTypeFilter,
    search: searchInput,
    setSearch: setSearchInput,
    isSearching: searchInput.trim() !== search,
    loadMore,
    hasMore: query.hasNextPage ?? false,
    totalCount: counts?.total ?? 0,
  };
}
