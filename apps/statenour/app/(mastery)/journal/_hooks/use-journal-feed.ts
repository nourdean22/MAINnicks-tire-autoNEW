"use client";

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import type { SourceKey, TypeKey } from "@/components/journal/types";

export function useJournalFeed(
  initialSource: SourceKey = "all",
  initialType: TypeKey = "all"
) {
  const [source, setSource] = useState<SourceKey>(initialSource);
  const [type, setType] = useState<TypeKey>(initialType);
  const [limit, setLimit] = useState(100);
  const [days, setDays] = useState(60);

  // tRPC handles the AbortController cancellation natively via React Query
  // when the query key changes. No manual inflightRef logic needed.
  const query = trpc.journal.feed.useQuery(
    {
      source: source !== "all" ? source : undefined,
      type: type !== "all" ? type : null,
      limit,
      days,
    },
    {
      refetchOnWindowFocus: false, // Prevent feed jumps when switching tabs
      staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    }
  );

  const loadMore = useCallback(() => {
    // Expand the window dynamically for pseudo-infinite scroll
    setLimit((l) => Math.min(l + 50, 200));
    setDays((d) => Math.min(d + 30, 365));
  }, []);

  const resetLimits = useCallback(() => {
    setLimit(100);
    setDays(60);
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
    entries: query.data?.entries ?? [],
    counts: query.data?.counts ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error?.message ?? null,
    source,
    setSourceFilter,
    type,
    setTypeFilter,
    loadMore,
    hasMore: (query.data?.counts?.shown ?? 0) < (query.data?.counts?.total ?? 0),
    totalCount: query.data?.counts?.total ?? 0,
  };
}
