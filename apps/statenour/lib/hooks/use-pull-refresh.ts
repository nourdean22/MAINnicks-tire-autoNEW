"use client";

import { useRef, useCallback, useState } from "react";

/**
 * Pull-to-refresh hook for mobile.
 * Returns touch handlers to attach to a container element.
 */
export function usePullRefresh(onRefresh: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  }, []);

  const onTouchEnd = useCallback(
    async (e: React.TouchEvent) => {
      if (!pulling.current) return;
      pulling.current = false;

      const endY = e.changedTouches[0].clientY;
      const diff = endY - startY.current;

      // Pull down at least 80px to trigger refresh
      if (diff > 80 && !refreshing) {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }
    },
    [onRefresh, refreshing]
  );

  return { refreshing, onTouchStart, onTouchEnd };
}
