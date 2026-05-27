"use client";

/**
 * NickSidePane · /tasks v2.2 Phase 5 LITE · 2026-05-26
 *
 * Persistent Nick chat surface on /tasks (and ready for any page that
 * wants it). Hosts the existing PageNick streaming Q&A primitive inside
 * a side-pane shell:
 *   - Desktop (≥lg / 1024px+): fixed right pane · 380px width
 *   - Mobile: bottom-sheet · 80vh max-height · swipe-down to close
 *
 * Phase 5 LITE scope (this commit):
 *   - Side-pane shell (open/closed via toggle FAB)
 *   - PageNick mounted inside · operator types question, Nick streams
 *   - Page-aware presets for /tasks ("what should I focus on?", etc)
 *   - Persistent across page interactions (open state in localStorage)
 *
 * Phase 5 FULL (DEFERRED):
 *   - Multi-turn conversational state
 *   - Proactive coach watcher (idle nudge, defer-count, pace shift)
 *   - SSE-pushed coach event chips inside the pane
 *   - Page-context-bridge auto-injection on task row tap
 *   - Tap-task-to-ask-nick-about-it integration
 *
 * Operator-visible value today · "Nick is always one tap away on
 * /tasks" without leaving the page. Multi-turn + proactive surfaces
 * land as follow-ups when the SSE infrastructure ships.
 */

import { useCallback, useEffect, useState } from "react";
import { Brain, X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageNick } from "@/components/ai/page-nick";

const STORAGE_KEY = "nour:nick-side-pane:open:v1";

interface NickSidePaneProps {
  /** Page identifier passed to PageNick for context-aware analysis. */
  page: string;
  /** Optional structured data passed to PageNick. Skipped → PageNick
   *  falls back to buildPageData(page) on the server. */
  data?: unknown;
  /** Optional one-line focus that biases analysis. */
  focus?: string;
  /** Quick-question preset pills · max 4 visible. Defaults to
   *  generic operator-grade prompts when omitted. */
  presets?: string[];
}

const DEFAULT_PRESETS = [
  "What should I focus on right now?",
  "What patterns am I missing today?",
  "What's blocking my biggest goal?",
];

export function NickSidePane({ page, data, focus, presets }: NickSidePaneProps) {
  const [open, setOpen] = useState(false);

  // Restore persisted state on mount · SSR-safe.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setOpen(true);
    } catch {
      /* private browsing · stay closed */
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* best-effort */
      }
      return next;
    });
  }, []);

  // Esc closes when open · matches OmniCaptureModal contract.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Only close if focus is not inside an editable element ·
        // otherwise let the input handle Esc (e.g. clear search).
        const active = document.activeElement;
        const tag = (active?.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, toggle]);

  return (
    <>
      {/* Toggle FAB · always rendered · positioned bottom-right ·
       *  iOS-PWA-safe min-h 44pt · gold-accent editorial pill. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "close nick side pane" : "open nick side pane"}
        aria-expanded={open}
        className={cn(
          "fixed bottom-4 right-4 z-40 inline-flex h-11 min-w-[44px] items-center gap-1.5 rounded-full px-3.5",
          "border border-[var(--gold)]/40 bg-[var(--bg-base)]/95 backdrop-blur-sm",
          "text-[var(--gold)] shadow-lg shadow-[var(--gold)]/10",
          "hover:bg-[var(--gold)]/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40",
          "transition-all",
          // Hide FAB when pane is open · pane has its own close affordance
          open && "opacity-0 pointer-events-none",
          // Respect iOS safe area
          "pb-[env(safe-area-inset-bottom,0px)]",
        )}
      >
        <Brain size={14} strokeWidth={1.75} />
        <span className="text-[10px] font-mono uppercase tracking-[0.18em]">nick</span>
      </button>

      {/* Pane · slide-in from right on desktop · bottom-sheet on
       *  mobile · same component, responsive Tailwind classes. */}
      {open && (
        <>
          {/* Backdrop · mobile only · tap to close. lg:hidden keeps
           *  desktop fully usable (no overlay). */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            onClick={toggle}
            aria-hidden
          />
          <aside
            role="complementary"
            aria-label="nick assistant"
            className={cn(
              "fixed z-50 flex flex-col bg-[var(--bg-base)] border-[var(--border-default)]",
              // Mobile bottom-sheet · 80vh max
              "inset-x-0 bottom-0 max-h-[80vh] rounded-t-2xl border-t",
              // Desktop right-pane · 380px wide · full height
              "lg:top-0 lg:right-0 lg:bottom-0 lg:inset-x-auto lg:max-h-none lg:w-[380px] lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0",
              // iOS safe-area
              "pb-[env(safe-area-inset-bottom,0px)]",
            )}
          >
            {/* Header · drag handle (mobile) + title + close */}
            <header className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3 shrink-0">
              <GripVertical
                size={12}
                className="text-[var(--text-tertiary)]/40 lg:hidden"
                strokeWidth={1.75}
                aria-hidden
              />
              <Brain size={14} className="text-[var(--gold)] shrink-0" strokeWidth={1.75} />
              <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
                nick · {page}
              </h2>
              <span className="ml-2 text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                esc to close
              </span>
              <button
                type="button"
                onClick={toggle}
                aria-label="close nick"
                className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/[0.15] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
              >
                <X size={12} strokeWidth={2} />
              </button>
            </header>

            {/* Body · PageNick streams analysis · scroll-isolated.
             *  PageNick already owns its full UX (presets, send, copy,
             *  abort, follow-up-in-chat link). Wrapping it here in a
             *  flex container that takes remaining space + scrolls. */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <PageNick
                page={page}
                data={data}
                focus={focus}
                presets={presets ?? DEFAULT_PRESETS}
                placeholder="Ask Nick · type a question…"
                className="w-full"
              />
            </div>

            {/* Footer hint · operator-grade affordance · sets expectation
             *  that multi-turn + proactive chips are queued. */}
            <footer className="px-4 py-2 border-t border-[var(--border-default)]/60 shrink-0">
              <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]/60">
                phase 5 lite · single-turn · multi-turn coming
              </p>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}
