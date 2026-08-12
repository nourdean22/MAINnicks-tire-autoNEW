import { create } from "zustand";

/**
 * MoreSheet open state — 2026-08-12.
 *
 * Replaces the raw `window.dispatchEvent(new Event(MORE_SHEET_OPEN_EVENT))`
 * bus that connected bottom-tab-bar.tsx to more-sheet.tsx: two files
 * coordinating through an untyped global DOM event, with manual
 * addEventListener/removeEventListener boilerplate on the listening side
 * and no way to read "is it open" from anywhere else. `chat-ui-store.ts`
 * already established the Zustand pattern for exactly this class of
 * cross-component UI state (privateMode, posture, turbo); this brings
 * the More sheet in line with it. Blast radius confirmed narrow before
 * the swap — MORE_SHEET_OPEN_EVENT had exactly one dispatcher and one
 * listener in the whole app.
 */
export interface MoreSheetState {
  open: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useMoreSheetStore = create<MoreSheetState>((set) => ({
  open: false,
  openSheet: () => set({ open: true }),
  closeSheet: () => set({ open: false }),
}));
