"use client";

/**
 * ULTRON wordmark + state aura
 *
 * Glows gold when mode is NORMAL/SURGICAL.
 * Shifts red when BATTLE.
 * Dims amber when RECOVERY.
 * Goes blue/quiet when SHUTDOWN.
 *
 * Subtle animation — no throbbing disco vibes. This is apex-predator calm.
 */

import { cn } from "@/lib/utils";
import type { UltronMode } from "@/lib/ultron/mode-classifier";

interface WordmarkProps {
  mode: UltronMode;
  reason?: string;
}

const MODE_CLASSES: Record<UltronMode, string> = {
  NORMAL:   "text-[var(--gold)] drop-shadow-[0_0_8px_rgba(253,185,19,0.35)]",
  SURGICAL: "text-[var(--gold)] drop-shadow-[0_0_14px_rgba(253,185,19,0.55)] animate-pulse",
  BATTLE:   "text-red-400 drop-shadow-[0_0_10px_rgba(239,68,68,0.45)]",
  RECOVERY: "text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.35)]",
  SHUTDOWN: "text-blue-400 drop-shadow-[0_0_6px_rgba(59,130,246,0.25)] opacity-70",
};

export function Wordmark({ mode, reason }: WordmarkProps) {
  return (
    <div className="flex items-baseline gap-2" title={reason || "ultron"}>
      <span
        className={cn(
          "font-[var(--font-display)] font-black leading-none transition-colors duration-700",
          // Single-letter glyph — the full wordmark felt heavy next to the
          // MODE pill + 4-stack pulse. One U carries the brand in a sliver
          // of the space. tooltip ("ultron") preserves the full identity.
          "text-xl sm:text-2xl tracking-normal",
          MODE_CLASSES[mode],
        )}
        aria-label="ultron"
      >
        U
      </span>
    </div>
  );
}
