"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// page-visit")` onto `trpc.brain.pageVisit` · fire-and-forget mutation.
import { trpc } from "@/lib/trpc/client";
import { PAGE_LEAVE_URL, type LeaveReason } from "@/lib/brain/page-dwell";
import { defaultTabFor } from "@/lib/brain/default-tabs";
/**
 * Silent page visit tracker. Fires a mutation to record a page visit
 * on every route change so the brain can detect usage patterns,
 * blind spots, and time-of-day habits. Opt-out: localStorage
 * 'nour:no-track' = '1'.
 *
 * The ?tab= value is recorded separately (2026-10-19): tab-level use of /brain and /stats is
 * measurable, but a tab click is not a page visit, so `page_visit` fires on a pathname change only
 * and the tab goes through its own mutation and effect (eventType page_tab_visit).
 *
 * A page opened with no ?tab= logs the tab it shows (lib/brain/default-tabs.ts), so a plain visit to
 * /brain or /stats is a measured tab view too (2026-10-23).
 *
 * The end of a visit is recorded too (2026-10-23, eventType page_leave, POST /api/brain/page-leave):
 * route change or unmount, tab hidden, pagehide. Dwell is wall-clock from the open (or from the return
 * to a hidden tab), capped server-side. Reader: Appendix E in docs/research.
 */
const NO_TRACK_KEY = "nour:no-track";

function trackingOptedOut(): boolean {
  try {
    return window.localStorage.getItem(NO_TRACK_KEY) === "1";
  } catch {
    return false; // storage blocked (private mode): no opt-out could be read
  }
}

/**
 * One leave per ended visit: path, dwell and reason only. keepalive lets the request outlive a closing
 * page (a tRPC mutation cannot). Fire and forget: a failed send loses one data point and nothing else.
 */
function sendPageLeave(page: string, dwellMs: number, reason: LeaveReason): void {
  try {
    void fetch(PAGE_LEAVE_URL, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page, dwellMs, reason }),
    }).catch(() => {});
  } catch {
    // fetch unavailable or threw synchronously: tracking is non-critical
  }
}

export function PageTracker() {
  const pathname = usePathname();
  // The tab the page shows: ?tab= when present, else the page's default (null for untabbed pages).
  const urlTab = useSearchParams()?.get("tab") || null;
  const tab = urlTab ?? (pathname ? defaultTabFor(pathname) : null);
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

    // The visit ends once per foreground stretch: a route change (this effect's cleanup), the tab
    // being hidden, or pagehide. `open` is the dedupe: hidden followed by pagehide (what closing a tab
    // does) sends one leave, not two. Coming back to a hidden tab opens a new stretch from that moment.    // A page mounted while the tab is already hidden (opened in the background) has no stretch yet: it
    // starts on the first visible, so hidden time is never counted as dwell.
    let startedAt = Date.now();
    let open = document.visibilityState !== "hidden";
    const end = (reason: LeaveReason) => {
      if (!open) return;
      open = false;
      sendPageLeave(pathname, Date.now() - startedAt, reason);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") end("hidden");
      else if (!open) {
        open = true;
        startedAt = Date.now();
      }
    };
    const onPageHide = () => end("pagehide");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      end("route");
    };
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
