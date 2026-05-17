"use client";

/**
 * CONTEXT RAIL — Thin live context strip shown above the message scroll area.
 *
 * Keeps Nour anchored in reality while chatting with Nick. Pulls live data
 * from NourState and surfaces the highest-signal context:
 *
 *   - State pill (LIVE / FIRE / DRIFT / SCATTERED / LOW ENERGY)
 *   - $ today
 *   - Crosshairs compact (the current MIT)
 *   - Drift alert count (if any)
 *   - Time of day icon
 *
 * Renders nothing if there's literally nothing worth showing (rare — usually
 * at least the state pill is there).
 */

import Link from "next/link";
import { useNourState } from "@/lib/state/nour-state";
import { cn } from "@/lib/utils";
import { Crosshair, Sunrise, Sun, Moon, AlertTriangle, Flame } from "lucide-react";

const STATE_STYLES: Record<string, { label: string; color: string; bg: string; border: string }> = {
  normal:      { label: "LIVE",      color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  on_fire:     { label: "FIRE",      color: "text-[var(--gold)]", bg: "bg-[var(--gold)]/10", border: "border-[var(--gold)]/25" },
  drift:       { label: "DRIFT",     color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/25" },
  scattered:   { label: "SCATTERED", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/25" },
  low_energy:  { label: "LOW ENERGY", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/25" },
};

export function ContextRail() {
  const s = useNourState();

  const timeIcon =
    s.timeOfDay === "morning" ? Sunrise :
    s.timeOfDay === "afternoon" ? Sun :
    Moon;
  const TimeIcon = timeIcon;

  const stateStyle = STATE_STYLES[s.currentState] ?? STATE_STYLES.normal;
  const isFire = s.currentState === "on_fire";
  const isDrift = s.currentState === "drift";

  // Build the list of visible chips
  const hasAny =
    s.todayRevenue > 0 ||
    s.mit != null ||
    s.driftAlerts > 0 ||
    s.agingCritical > 0 ||
    s.currentState !== "normal";

  if (!hasAny) return null;

  return (
    <div
      className={cn(
        "shrink-0 flex items-center gap-2 px-3 py-1.5 border-b overflow-x-auto no-scrollbar",
        "bg-[var(--bg-void)]/40 backdrop-blur-sm",
        isDrift ? "border-red-500/20 context-rail-drift" : "border-[var(--border-default)]"
      )}
    >
      {/* Time-of-day glyph */}
      <TimeIcon size={11} className="shrink-0 text-[var(--text-tertiary)]" />

      {/* State pill */}
      <span
        className={cn(
          "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border",
          "text-[9px] font-[var(--font-display)] font-bold uppercase tracking-[0.18em]",
          stateStyle.bg,
          stateStyle.border,
          stateStyle.color
        )}
      >
        {isFire && <Flame size={8} />}
        {stateStyle.label}
      </span>

      {/* $ today */}
      {s.todayRevenue > 0 && (
        <span className="shrink-0 text-[9px] font-mono font-bold tabular-nums text-[var(--gold)]">
          ${s.todayRevenue.toLocaleString()}
          <span className="text-[var(--text-tertiary)] font-normal ml-0.5">today</span>
        </span>
      )}

      {/* Drift alerts */}
      {s.driftAlerts > 0 && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-mono font-bold text-red-400">
          <AlertTriangle size={9} />
          {s.driftAlerts}
        </span>
      )}

      {/* Aging pipeline critical */}
      {s.agingCritical > 0 && (
        <span className="shrink-0 text-[9px] font-mono text-red-400 pulse-live">
          {s.agingCritical} rot
        </span>
      )}

      {/* OpenLoops retired Apr 18 · inbox-tasks surface in WorkWidget */}

      {/* Crosshairs compact — takes remaining space with truncation */}
      {s.mit && (
        <Link
          href="/tasks"
          className="min-w-0 flex items-center gap-1 text-[9px] text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors group"
          title={s.mit}
        >
          <Crosshair size={9} className="shrink-0 text-[var(--gold)]/60 group-hover:text-[var(--gold)]" />
          <span className="truncate">{s.mit}</span>
        </Link>
      )}
    </div>
  );
}
