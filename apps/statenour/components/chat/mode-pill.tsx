"use client";

/**
 * MODE PILL — shows the chat mode Nick is about to use for the
 * current message, with a tap to cycle through standard/deep/auto.
 *
 * Logic:
 *   - If the user hasn't touched the override, we show the AUTO
 *     classification based on the current draft input (live preview).
 *     Color: muted gold on transparent.
 *   - If the user taps the pill, it enters OVERRIDE mode. Tap cycles
 *     through: standard → deep → auto. Color: bold gold (active).
 *   - The override is sent via the chat transport body as
 *     `modeOverride` so the route respects it instead of re-detecting.
 *
 * Placement: next to the input area in the chat page, left of the
 * send button. Compact — single-line pill that doesn't eat screen.
 *
 * Two-mode design (Apr 17) — quick mode was collapsed into standard
 * because standard + query-shape adaptive token caps handles short
 * casual messages just as fast. Deep stays for explicit strategy /
 * plan / analysis / brain-dump territory.
 */

import { cn } from "@/lib/utils";
import { Target, Brain } from "lucide-react";
import type { ChatMode } from "@/lib/ai/chat-mode-detect";
import type { ChatModeOverride } from "@/lib/chat/types";

interface ModePillProps {
  /** What the auto classifier currently thinks (from live input) */
  detectedMode: ChatMode;
  /** User's explicit override, or "auto" if they haven't touched it */
  override: ChatModeOverride;
  /** Called when user clicks to cycle through modes */
  onCycle: () => void;
  /** When true, pill breathes gold — shows Nick is doing work */
  active?: boolean;
  /** What mode actually ran on the most recent response (from the
   *  X-Nick-Mode response header). Shows a small "ran X" confirmation
   *  badge so Nour sees predicted-vs-actual without opening logs. */
  lastRunMode?: {
    mode: ChatMode;
    source: "auto" | "override";
  } | null;
}

const MODE_META: Record<
  ChatMode,
  { label: string; icon: typeof Target; description: string }
> = {
  standard: {
    label: "Standard",
    icon: Target,
    description: "Smart tool pruning, adaptive token budget, focused answer",
  },
  deep: {
    label: "Deep",
    icon: Brain,
    description: "All tools (cap 50), 4000 token budget, full strategic context",
  },
};

export function ModePill({
  detectedMode,
  override,
  onCycle,
  active = false,
  lastRunMode,
}: ModePillProps) {
  const activeMode: ChatMode = override === "auto" ? detectedMode : override;
  const isOverride = override !== "auto";
  const meta = MODE_META[activeMode];
  const Icon = meta.icon;
  // Show "ran X" feedback only when the last run differs from the
  // current prediction (i.e. override was used or classifier changed).
  // Skip otherwise — silence when prediction matches reality.
  const showFeedback =
    lastRunMode &&
    (lastRunMode.mode !== activeMode || lastRunMode.source === "override");

  return (
    <button
      type="button"
      onClick={onCycle}
      className={cn(
        "shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-[0.14em] transition-all",
        "hover:scale-105 active:scale-95",
        isOverride
          ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
          : "border-zinc-700/50 bg-zinc-900/40 text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]/80",
        active && "mode-pill-active"
      )}
      title={`${meta.description}${isOverride ? " (override active — click to cycle)" : " (auto — click to override)"}`}
      aria-label={`Chat mode: ${meta.label}${isOverride ? " (manual override)" : " (auto)"}`}
    >
      <Icon size={9} className={isOverride ? "text-[var(--gold)]" : undefined} />
      <span>{meta.label}</span>
      {isOverride && <span className="text-[7px] opacity-70">·OVR</span>}
      {showFeedback && lastRunMode && (
        <span
          className="text-[7px] opacity-60 border-l border-current pl-1 ml-0.5"
          title={`Last reply ran in ${lastRunMode.mode.toUpperCase()} mode${lastRunMode.source === "override" ? " (override)" : ""}`}
        >
          ran·{lastRunMode.mode === "deep" ? "D" : "S"}
        </span>
      )}
    </button>
  );
}
