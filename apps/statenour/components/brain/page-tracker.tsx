"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { authedFetch } from "@/hooks/use-authed-fetch";
/**
 * Silent page visit tracker. Fires a POST to /api/brain/page-visit
 * on every route change so the brain can detect usage patterns,
 * blind spots, and time-of-day habits.
 */
export function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    // Fire and forget — non-blocking, non-critical
    authedFetch("/api/brain/page-visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        page: pathname,
        referrer: typeof document !== "undefined" ? document.referrer : null,
      }),
    }).catch(() => {}); // Silent fail
  }, [pathname]);

  return null; // Invisible component
}
