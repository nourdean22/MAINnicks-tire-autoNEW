"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// page-visit")` onto `trpc.brain.pageVisit` · fire-and-forget mutation.
import { trpc } from "@/lib/trpc/client";
/**
 * Silent page visit tracker. Fires a mutation to record a page visit
 * on every route change so the brain can detect usage patterns,
 * blind spots, and time-of-day habits.
 */
export function PageTracker() {
  const pathname = usePathname();
  const pageVisit = trpc.brain.pageVisit.useMutation();

  useEffect(() => {
    if (!pathname) return;

    // Fire and forget — non-blocking, non-critical
    pageVisit.mutate({
      page: pathname,
      referrer: typeof document !== "undefined" ? document.referrer : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]); // Silent fail

  return null; // Invisible component
}
