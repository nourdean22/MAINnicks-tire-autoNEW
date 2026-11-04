"use client";

import { useEffect } from "react";

import { useMissionUIStore } from "../state/use-mission-ui-store";

/**
 * R3 Codex round (PR 3541): the UI store keeps Focus mode on across navigation, and Focus mode renders only the
 * execution panel, so /missions#promises (Home's proposed row, Nick's "Commitments read" chip) landed on a page
 * with no Promises section. Arriving at, or changing to, #promises leaves Focus mode; the section then mounts and
 * scrolls itself into view.
 */
export function useLeaveFocusForPromises(): void {
  const setExecutionModeActive = useMissionUIStore((s) => s.setExecutionModeActive);
  useEffect(() => {
    const leave = () => {
      if (window.location.hash === "#promises") setExecutionModeActive(false);
    };
    leave();
    window.addEventListener("hashchange", leave);
    return () => window.removeEventListener("hashchange", leave);
  }, [setExecutionModeActive]);
}
