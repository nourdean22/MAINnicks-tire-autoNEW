"use client";

/**
 * useChatOverrides — owns the mode/provider/taskType overrides state
 * plus the cycleMode shortcut for the ModePill.
 *
 * Extracted from `app/(mastery)/chat/page.tsx` as part of the v11.1
 * B2 decomp. Overrides are "force the NEXT message to run with
 * specific settings" — the control bar + ⋯ menu are the UX surfaces;
 * this hook is the state owner.
 *
 * The ChatOverrides shape + ChatModeOverride enum live in
 * `lib/chat/types.ts`; that's stayed as-is.
 */
import { useCallback, useState } from "react";
import type { ChatOverrides, ChatModeOverride } from "@/lib/chat/types";

const DEFAULT_OVERRIDES: ChatOverrides = {
  mode: "auto",
  provider: "auto",
  taskType: "auto",
};

export interface UseChatOverridesResult {
  overrides: ChatOverrides;
  setOverrides: React.Dispatch<React.SetStateAction<ChatOverrides>>;
  /** Cycle mode: auto → standard → deep → auto. */
  cycleMode: () => void;
  /** Reset all overrides back to auto. */
  resetAll: () => void;
}

export function useChatOverrides(
  initial: ChatOverrides = DEFAULT_OVERRIDES,
): UseChatOverridesResult {
  const [overrides, setOverrides] = useState<ChatOverrides>(initial);

  const cycleMode = useCallback(() => {
    setOverrides((prev) => {
      const next: ChatModeOverride =
        prev.mode === "auto"
          ? "standard"
          : prev.mode === "standard"
            ? "deep"
            : "auto";
      return { ...prev, mode: next };
    });
  }, []);

  const resetAll = useCallback(() => {
    setOverrides(DEFAULT_OVERRIDES);
  }, []);

  return { overrides, setOverrides, cycleMode, resetAll };
}
