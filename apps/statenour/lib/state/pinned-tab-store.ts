import { create } from "zustand";
import { DEFAULT_PINNED_HREF } from "@/components/layout/nav-items";

/**
 * Pinned bottom-tab slot (UI v3 W1b). Shared by the bar and the More sheet, so a pin in the sheet
 * moves the bar at once; same Zustand pattern as more-sheet-store.ts.
 *
 * Hydration: the store starts on the default (Journal) on the server and on the first client
 * render, so the markup agrees; BottomTabBar calls hydrate() after mount and the slot swaps then.
 * The stored value is a bare href. A stale or unknown one is kept here and resolved to Journal at
 * render by resolvePinnedTab, so a removed route never breaks the bar.
 */
export const PINNED_TAB_KEY = "nav:pinned-tab";

export interface PinnedTabState {
  href: string;
  hydrate: () => void;
  pin: (href: string) => void;
}

export const usePinnedTabStore = create<PinnedTabState>((set) => ({
  href: DEFAULT_PINNED_HREF,
  hydrate: () => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(PINNED_TAB_KEY);
      if (saved) set({ href: saved });
    } catch {
      // localStorage can throw (private mode, quota); the default stands.
    }
  },
  pin: (href) => {
    set({ href });
    if (typeof window === "undefined") return;
    try {
      if (href === DEFAULT_PINNED_HREF) window.localStorage.removeItem(PINNED_TAB_KEY);
      else window.localStorage.setItem(PINNED_TAB_KEY, href);
    } catch {
      // in-memory state still updated; the pin lasts for this session.
    }
  },
}));
