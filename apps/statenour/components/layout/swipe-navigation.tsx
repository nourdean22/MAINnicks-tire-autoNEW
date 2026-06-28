"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BOTTOM_TABS } from "./nav-items";

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
  // 2026-06-18 · IA reorg Phase 4 · now derives from BOTTOM_TABS (the 4 daily
  // content tabs Home/Missions/Journal/Stats) — Stats joins the swipe loop.
  const SWIPEABLE = BOTTOM_TABS.filter((t) => !t.external);

  const currentTabIndex = SWIPEABLE.findIndex(
    t => pathname === t.href || pathname.startsWith(t.href + "/")
  );

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    // v10.0.529.95 · Wave 39 · H1 · iOS back-swipe edge guard. iOS
    // Safari starts its native back-swipe gesture from the left 20px
    // edge. Pre-Wave-39 this handler also fired and pushed the previous
    // tab on top of the history stack · corrupting navigation. Same
    // guard on the right edge for forward-swipe symmetry.
    if (touch.clientX < 20 || touch.clientX > window.innerWidth - 20) {
      touchStartRef.current = null;
      pullRef.current = { startY: 0, pulling: false };
      return;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };

    // Pull-to-refresh: only if at top of page
    if (window.scrollY <= 0) {
      pullRef.current = { startY: touch.clientY, pulling: true };
    }
  }, []);

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
    // SWIPEABLE is derived from BOTTOM_TABS which is module-const, so
    // it's stable across renders — no need to include in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTabIndex, router]);

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
