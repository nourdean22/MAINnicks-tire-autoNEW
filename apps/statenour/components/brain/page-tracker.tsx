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
 * The ?tab= value rides along (2026-10-18) so tab-level use of /brain and /stats is measurable;
 * a tab change inside one pathname is a visit too, hence `tab` in the effect deps.
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

  useEffect(() => {
    if (!pathname) return;
    if (trackingOptedOut()) return;

    // Fire and forget — non-blocking, non-critical
    pageVisit.mutate({
      page: pathname,
      referrer: typeof document !== "undefined" ? document.referrer : null,
      ...(tab ? { tab } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, tab]); // Silent fail

  return null; // Invisible component
}
