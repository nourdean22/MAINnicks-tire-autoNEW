"use client";

/**
 * IntelPanel · 2026-05-21 · the /tasks "powerful underneath" drawer.
 *
 * /tasks is the operator's execution surface. Over many waves, six
 * intel / reflection widgets accreted ABOVE the task list — daily
 * brief, Nick's suggestions, operator pulse, today's compound, the
 * compound chain, the context band — each landing "one notch higher-
 * signal than the card below it" until the actual NowPanel was buried
 * under six stacked cards. The operator's verdict: "too much going on."
 *
 * The fix (Tesla-minimal · simple on top, powerful underneath): the
 * execution surface (NowPanel) renders first and unobstructed; every
 * informational widget collapses into this one disclosure beneath it.
 *
 * Collapsed by default — the operator opens intel deliberately, it
 * isn't pushed at them. Children render only while expanded, so a
 * collapsed panel costs ZERO data fetches on the /tasks load path
 * (each folded widget self-fetches — gating their mount is also a
 * measurable load-time win, not just a layout one).
 *
 * The open/closed choice persists to localStorage so it survives
 * navigation. SSR-safe: defaults collapsed, then reads the stored
 * value after hydration (reading localStorage during render would
 * desync the server markup).
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

/** localStorage key — "1" = expanded, anything else = collapsed. */
const STORAGE_KEY = "tasks_intel_open";

interface IntelPanelProps {
  children: React.ReactNode;
  /**
   * When > 0 and the panel is collapsed, the toggle shows an amber
   * count pill — a breadcrumb that the folded widgets are worth
   * opening for, without un-folding (or fetching) them. The /tasks
   * page feeds its overdue count; OperatorPulse inside the drawer is
   * the strategic read on exactly those. Kept a generic number so the
   * panel stays decoupled from any one data source.
   */
  signalCount?: number;
  /** Noun rendered after the count, e.g. "overdue" → "3 overdue". */
  signalLabel?: string;
}

export function IntelPanel({ children, signalCount = 0, signalLabel }: IntelPanelProps) {
  const [open, setOpen] = useState(false);

  // Restore the persisted choice after mount. Done in an effect, not
  // in useState's initializer, so the server and first client render
  // agree (both collapsed) — no hydration mismatch.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setOpen(true);
    } catch {
      /* private mode / storage disabled — stay collapsed */
    }
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* best-effort persistence */
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={cn(
          "flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
          open
            ? "border-[var(--gold)]/25 bg-[var(--gold)]/[0.04]"
            : "border-[var(--gold)]/15 bg-[var(--gold)]/[0.02] hover:bg-[var(--gold)]/[0.05]",
        )}
      >
        <Layers size={12} className="shrink-0 text-[var(--gold)]/70" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--gold)]/80">
          Today&apos;s intel
        </span>
        <span className="ml-1 hidden flex-1 truncate text-[9px] italic text-white/30 sm:block">
          brief · suggestions · pulse · compounding
        </span>
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
      {/* Children mount only while expanded — the six folded widgets
          each self-fetch, so a collapsed panel does no work. */}
      {open && children}
    </div>
  );
}
