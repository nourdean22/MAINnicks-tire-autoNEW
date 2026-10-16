"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FIXED_TABS, NAV, resolvePinnedTab, type NavEntry } from "./nav-items";
import { usePinnedTabStore } from "@/lib/state/pinned-tab-store";

/** The swipe loop in bar order: the three fixed tabs plus the pinned slot (UI v3 W1b), same resolver as the bar. */
export function swipeTabs(pinnedHref: string): NavEntry[] {
  return [...FIXED_TABS, resolvePinnedTab(pinnedHref, NAV)].filter((t) => !t.external);
}

/** Index of the tab the pathname sits on (a sub-route counts), or -1 off the loop. */
export function swipeIndex(tabs: NavEntry[], pathname: string): number {
  return tabs.findIndex((t) => pathname === t.href || pathname.startsWith(t.href + "/"));
}

/** The slice of a DOM Element the swipe guard reads (pure, so tests pass plain objects). */
export interface SwipeNode {
  tagName: string;
  isContentEditable?: boolean;
  scrollWidth: number;
  clientWidth: number;
  parentElement: SwipeNode | null;
  hasAttribute(name: string): boolean;
}

/**
 * A touch that starts in text entry, inside a horizontal scroller that actually overflows, or in
 * an opted-out `[data-no-swipe]` region belongs to that element, not to tab navigation
 * (audit 09-F26: a flick across a code block or chip row used to change tabs).
 */
export function swipeStartsInExemptZone(
  target: SwipeNode | null,
  overflowX: (el: SwipeNode) => string = (el) => getComputedStyle(el as unknown as Element).overflowX,
): boolean {
  for (let el = target; el; el = el.parentElement) {
    if (el.hasAttribute("data-no-swipe")) return true;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return true;
    if (el.scrollWidth > el.clientWidth && /^(auto|scroll)$/.test(overflowX(el))) return true;
  }
  return false;
}

/** /chat pins its shell (window.scrollY stays 0), so a downward history drag read as a pull. */
export function pullToRefreshAllowed(pathname: string): boolean {
  return pathname !== "/chat" && !pathname.startsWith("/chat/");
}

/**
 * SwipeNavigation — enables swipe left/right between mobile tabs
 * and pull-to-refresh on all pages.
 *
 * Swipe left → next tab
 * Swipe right → previous tab
 * Pull down → refresh page
 */
export function SwipeNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pullRef = useRef<{ startY: number; pulling: boolean }>({ startY: 0, pulling: false });

  // Apr 18: filter out external tabs (Admin → nickstire.org). router.push
  // can't navigate to absolute URLs, and swiping shouldn't yank Nour
  // off-site. External entries remain reachable via the floating orb +
  // bottom nav, just not via swipe gesture.
  // UI v3 W1b · the loop is the bar: Home, Chat, Missions, then whatever is
  // pinned in the fourth slot (default Journal), so a swipe never lands on a
  // tab the bar does not show.
  const pinnedHref = usePinnedTabStore((s) => s.href);
  const SWIPEABLE = useMemo(() => swipeTabs(pinnedHref), [pinnedHref]);

  const currentTabIndex = swipeIndex(SWIPEABLE, pathname);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    // v10.0.529.95 · Wave 39 · H1 · iOS back-swipe edge guard. iOS
    // Safari starts its native back-swipe gesture from the left 20px
    // edge. Pre-Wave-39 this handler also fired and pushed the previous
    // tab on top of the history stack · corrupting navigation. Same
    // guard on the right edge for forward-swipe symmetry.
    if (
      touch.clientX < 20 ||
      touch.clientX > window.innerWidth - 20 ||
      swipeStartsInExemptZone(e.target instanceof Element ? e.target : null)
    ) {
      touchStartRef.current = null;
      pullRef.current = { startY: 0, pulling: false };
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

    // Pull-to-refresh: only if at top of page
    if (window.scrollY <= 0 && pullToRefreshAllowed(pathname)) {
      pullRef.current = { startY: touch.clientY, pulling: true };
    }
  }, [pathname]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;

    // Horizontal swipe detection
    const isHorizontalSwipe = Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 400;

    if (isHorizontalSwipe && currentTabIndex >= 0) {
      if (dx < 0 && currentTabIndex < SWIPEABLE.length - 1) {
        // Swipe left → next tab
        router.push(SWIPEABLE[currentTabIndex + 1].href);
      } else if (dx > 0 && currentTabIndex > 0) {
        // Swipe right → previous tab
        router.push(SWIPEABLE[currentTabIndex - 1].href);
      }
    }

    // Pull-to-refresh detection
    //
    // 2026-05-23 · Wave A · was window.location.reload() · in iOS PWA
    // standalone mode that's a full app-cold-restart · blew away the
    // operator's chat draft + streaming response + optimistic UI on
    // every accidental pull. router.refresh() re-fetches server
    // components without touching client state.
    if (pullRef.current.pulling && dy > 120 && Math.abs(dy) > Math.abs(dx) * 2) {
      router.refresh();
    }

    touchStartRef.current = null;
    pullRef.current = { startY: 0, pulling: false };
  }, [currentTabIndex, router, SWIPEABLE]);

  useEffect(() => {
    // Only enable on mobile (check for touch support + narrow viewport)
    const isMobile = window.matchMedia("(max-width: 768px)").matches && "ontouchstart" in window;
    if (!isMobile) return;

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);

  return null; // Invisible component
}
