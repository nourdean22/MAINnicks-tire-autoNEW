/**
 * useMoreSheetStore (2026-08-12) — replaces the raw window CustomEvent bus
 * that connected bottom-tab-bar.tsx to more-sheet.tsx. Pure state; the
 * exit-animation timing itself lives in MoreSheet's onAnimationEnd (not
 * unit-testable without a browser), but the state machine it reacts to
 * is exactly this store, and it's worth pinning independent of any DOM.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useMoreSheetStore } from "@/lib/state/more-sheet-store";

beforeEach(() => {
  useMoreSheetStore.setState({ open: false });
});

describe("useMoreSheetStore", () => {
  it("starts closed", () => {
    expect(useMoreSheetStore.getState().open).toBe(false);
  });

  it("openSheet sets open true", () => {
    useMoreSheetStore.getState().openSheet();
    expect(useMoreSheetStore.getState().open).toBe(true);
  });

  it("closeSheet sets open false", () => {
    useMoreSheetStore.setState({ open: true });
    useMoreSheetStore.getState().closeSheet();
    expect(useMoreSheetStore.getState().open).toBe(false);
  });

  it("closeSheet on an already-closed store is a harmless no-op (route-change effect calls it unconditionally)", () => {
    expect(useMoreSheetStore.getState().open).toBe(false);
    useMoreSheetStore.getState().closeSheet();
    expect(useMoreSheetStore.getState().open).toBe(false);
  });
});
