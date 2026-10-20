"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// page-visit")` onto `trpc.brain.pageVisit` · fire-and-forget mutation.
import { trpc } from "@/lib/trpc/client";
/**
 * Silent page visit tracker. Fires a mutation to record a page visit
 * on every route change so the brain can detect usage patterns,
 * blind spots, and time-of-day habits. Opt-out: localStorage
 * 'nour:no-track' = '1'.
 *
 * The ?tab= value is recorded separately (2026-10-19): tab-level use of /brain and /stats is
 * measurable, but a tab click is not a page visit, so `page_visit` fires on a pathname change only
 * and the tab goes through its own mutation and effect (eventType page_tab_visit).
 */
const NO_TRACK_KEY = "nour:no-track";

function trackingOptedOut(): boolean {
  try {
    return window.localStorage.getItem(NO_TRACK_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode): no opt-out could be read
  }
}

export function PageTracker() {
  const pathname = usePathname();
  const tab = useSearchParams()?.get("tab") || null;
  const pageVisit = trpc.brain.pageVisit.useMutation();
  const pageTabVisit = trpc.brain.pageTabVisit.useMutation();

  useEffect(() => {
    if (!pathname) return;
    if (trackingOptedOut()) return;

    // Fire and forget — non-blocking, non-critical
    pageVisit.mutate({
      page: pathname,
      referrer: typeof document !== "undefined" ? document.referrer : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]); // Silent fail

  useEffect(() => {
    if (!pathname || !tab) return;
    if (trackingOptedOut()) return;
    pageTabVisit.mutate({ page: pathname, tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, tab]);

  return null; // Invisible component
}
