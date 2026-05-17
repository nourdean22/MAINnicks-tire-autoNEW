"use client";

/**
 * ULTRON top strip — composition of wordmark + capture + ticker.
 *
 * Apr 19 pivot: the 4-chip PulseStack (body/mind/money/life) was folded
 * into the top + bottom tickers (body+money top, mind+life bottom) and
 * the freed-up real estate now holds the OmniCapture input so capture
 * is always one-tap-away at the top. The sticky header gives Nour:
 *   • ticker (markets + brain + self metrics rotating)
 *   • wordmark + mode pill
 *   • capture input (type anywhere, Ultron routes it)
 */

import { Wordmark } from "./wordmark";
import { Ticker } from "./ticker";
import { HQStatusChips } from "./hq-status-chips";
import { OmniCapture } from "@/components/ultron/ask/omni-capture";
import type { UltronMode } from "@/lib/ultron/mode-classifier";

// 2026-05-02 — DeployChip moved to /settings (Build Status section).
// Was admin-tier signal cluttering the daily-driver top strip. Same
// reasoning as SystemHealthCard + HQErrorsCard before it.

interface TopStripProps {
  mode: UltronMode;
  reason?: string;
}

export function TopStrip({ mode, reason }: TopStripProps) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[var(--bg-void)]/85 border-b border-[var(--border-default)]">
      <Ticker mode={mode} reason={reason} />
      <div className="px-3 py-2 flex items-center gap-3">
        <div className="shrink-0">
          <Wordmark mode={mode} reason={reason} />
        </div>
        <div className="flex-1 min-w-0">
          <OmniCapture mode={mode} />
        </div>
        <HQStatusChips />
      </div>
    </header>
  );
}
