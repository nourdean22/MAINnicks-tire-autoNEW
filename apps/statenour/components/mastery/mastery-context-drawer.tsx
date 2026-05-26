"use client";

/**
 * MasteryContextDrawer · Mastery Layer Stage B foundation · 2026-05-26
 *
 * Generalized from `components/actions/intel-panel.tsx` (which now
 * proxies to this drawer with surface="tasks"). The original IntelPanel
 * was /tasks-specific in 3 ways: hardcoded STORAGE_KEY, hardcoded
 * label, and single signalCount prop. This generalization keeps every
 * piece of behavior intact while making the drawer the canonical
 * cross-page primitive for collapsing context bands below the primary
 * work surface.
 *
 * Adoption pattern (any of the 5 daily-driver pages):
 *
 *   <MasteryContextDrawer surface="goals">
 *     <OperatorPulse surface="goals" />
 *     <CompoundChain surface="goals" />
 *     <RecentInsightsPanel />
 *   </MasteryContextDrawer>
 *
 * Per-surface persistence (`mastery_ctx_open_${surface}` in
 * localStorage) so the operator's open/closed choice on /tasks doesn't
 * propagate to /scoreboard etc. SSR-safe via deferred-read effect.
 *
 * Children mount only while expanded · self-fetching widgets stay
 * dormant in collapsed state · real perf win for /journal (10 bands)
 * + /goals (6 bands) when the drawer ships closed-by-default.
 *
 * Stage B per-surface adoptions (queued · separate commits):
 *   - /goals · wrap OperatorPulse + CompoundChain + RecentInsightsPanel
 *   - /journal · wrap LearningVelocity + WeeklyMemoir + ThreadRadar etc
 *   - /scoreboard · wrap CompoundChain + KommandoTrack (context tier)
 *   - /brain · DEFER · the 22-panel wall is the surface's identity
 *
 * The /tasks IntelPanel mount stays unchanged (via the legacy wrapper).
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export type MasteryDrawerSurface = "tasks" | "goals" | "journal" | "brain" | "scoreboard";

interface MasteryContextDrawerProps {
  /** Which page this drawer is on · drives the localStorage key so
   *  each page persists its open/closed state independently. */
  surface: MasteryDrawerSurface;
  children: React.ReactNode;
  /** Header label · uppercase mono · default "Context". */
  label?: string;
  /** Hint shown after the label on wide screens (italic, dimmed). */
  hint?: string;
  /** Optional · when > 0 and collapsed, shows an amber chip with the
   *  count + label so the operator can see there's signal worth
   *  opening for, without unfolding (or fetching) the children. */
  signalCount?: number;
  signalLabel?: string;
  /** Override · start expanded on first mount (no localStorage written
   *  until operator toggles). Useful for pages where context is the
   *  primary work surface · rare. Default false. */
  defaultOpen?: boolean;
}

export function MasteryContextDrawer({
  surface,
  children,
  label = "Context",
  hint,
  signalCount = 0,
  signalLabel,
  defaultOpen = false,
}: MasteryContextDrawerProps) {
  const storageKey = `mastery_ctx_open_${surface}`;
  const [open, setOpen] = useState(defaultOpen);

  // Restore persisted choice after mount · SSR-safe.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "1") setOpen(true);
      else if (stored === "0") setOpen(false);
      // No stored value · keep the defaultOpen from initial useState.
    } catch {
      /* private browsing or storage disabled — stay with default */
    }
  }, [storageKey]);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* best-effort persistence */
      }
      return next;
    });
  }

  return (
    <div className="space-y-3" data-surface={surface}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`mastery-ctx-${surface}`}
        className={cn(
          "flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
          open
            ? "border-[var(--gold)]/25 bg-[var(--gold)]/[0.04]"
            : "border-[var(--gold)]/15 bg-[var(--gold)]/[0.02] hover:bg-[var(--gold)]/[0.05]",
        )}
      >
        <Layers size={12} className="shrink-0 text-[var(--gold)]/70" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--gold)]/80">
          {label}
        </span>
        {hint && (
          <span className="ml-1 hidden flex-1 truncate text-[9px] italic text-white/30 sm:block">
            {hint}
          </span>
        )}
        {!open && signalCount > 0 && (
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-amber-300">
            {signalCount}
            {signalLabel ? ` ${signalLabel}` : ""}
          </span>
        )}
        {open ? (
          <ChevronDown size={13} className="ml-auto shrink-0 text-[var(--gold)]/50 sm:ml-0" />
        ) : (
          <ChevronRight size={13} className="ml-auto shrink-0 text-[var(--gold)]/50 sm:ml-0" />
        )}
      </button>
      {/* Children mount only while expanded · self-fetching widgets
       *  stay dormant in collapsed state. */}
      {open && <div id={`mastery-ctx-${surface}`}>{children}</div>}
    </div>
  );
}
