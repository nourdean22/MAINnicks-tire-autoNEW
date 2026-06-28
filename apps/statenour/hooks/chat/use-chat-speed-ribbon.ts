"use client";

/**
 * useChatSpeedRibbon — per-message timing map + visibility toggle.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.15 BATCH A
 * decomposition. The chat page tracked three timestamps per message in
 * a Map<id, {sentAt, firstTokenAt?, endedAt?}> and a boolean toggle for
 * displaying the ribbon under each NickMessage footer. Nour can opt-in
 * via Settings; the toggle is persisted in localStorage so the choice
 * survives navigation.
 *
 * The hook owns:
 *   · `timingRef` — same Map type the page used; caller writes into it
 *     on send/firstToken/end events
 *   · `showSpeedRibbon` — boolean toggle, hydrated from localStorage on mount
 *   · `setShowSpeedRibbon` — passes through to the toggle source-of-truth
 *
 * The render-time effect (track `messages` + `isStreaming` to record
 * end-of-stream timings) STAYS in the page because it depends on
 * useChat-internal message refs that don't lift cleanly. We just expose
 * the ref so the page's effect can mutate through it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "nour:chat:speed-ribbon";

export interface MessageTiming {
  sentAt: number;
  firstTokenAt?: number;
  endedAt?: number;
}

export interface ChatSpeedRibbonState {
  timingRef: React.MutableRefObject<Map<string, MessageTiming>>;
  showSpeedRibbon: boolean;
  setShowSpeedRibbon: (next: boolean) => void;
}

export function useChatSpeedRibbon(): ChatSpeedRibbonState {
  const timingRef = useRef<Map<string, MessageTiming>>(new Map());
  const [showSpeedRibbon, setShowSpeedRibbonState] = useState(false);

  // Hydrate from localStorage on mount only — same hydration-safety pattern
  // the page used (initialize false, sync after mount). React 19 + Next 16
  // flag init-from-localStorage in useState as a hydration mismatch.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) === "1";
      setTimeout(() => setShowSpeedRibbonState(stored), 0);
    } catch {
      // localStorage may be disabled (private mode); default false is fine.
    }
  }, []);

  const setShowSpeedRibbon = useCallback((next: boolean) => {
    setShowSpeedRibbonState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Best effort; hydration on next mount will read the (un-)written value.
    }
  }, []);

  return { timingRef, showSpeedRibbon, setShowSpeedRibbon };
}
