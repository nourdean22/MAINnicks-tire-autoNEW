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
import { Brain, X, GripVertical, AlertTriangle, Sparkles, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { MultiTurnChat } from "@/components/mastery/multi-turn-chat";
import { useCoachEvents } from "@/lib/hooks/use-coach-events";
import type { CoachEvent, CoachEventSurface } from "@/lib/services/coach-events-types";

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
  /** Coach Channel surface this pane subscribes to · drives the
   *  proactive event chips shown above PageNick. Default: matches
   *  `page` if it's a valid surface · falls back to no subscription. */
  coachSurface?: CoachEventSurface;
}

const DEFAULT_PRESETS = [
  "What should I focus on right now?",
  "What patterns am I missing today?",
  "What's blocking my biggest goal?",
];

export function NickSidePane({
  page,
  data,
  focus,
  presets,
  coachSurface,
}: NickSidePaneProps) {
  const [open, setOpen] = useState(false);

  // Phase 5 FULL · proactive coach event push (polled).
  // Subscribes to the Coach Channel for the pane's surface · displays
  // active events as chips ABOVE PageNick. Polls every 60s with tab-
  // visibility pause (faster than the CoachEventBanner's 90s because
  // the pane is a more deliberate operator surface). Skipped when
  // coachSurface is omitted OR pane is closed (no point fetching
  // events the operator can't see).
  const surface =
    coachSurface ??
    (["tasks", "goals", "journal", "brain", "scoreboard"].includes(page)
      ? (page as CoachEventSurface)
      : undefined);
  // Shared, surface-keyed poller (de-duped with CoachEventBanner). `enabled`
  // mirrors the old `skip` gate — no poll runs while the pane is closed.
  const { events: coachEvents } = useCoachEvents(surface, { enabled: open });

  // Restore persisted state on mount · SSR-safe.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setOpen(true);
    } catch {
      /* private browsing · stay closed */
    }
  }, []);

  // Listen for the custom "statenour:open-nick" event to automatically open the side pane.
  useEffect(() => {
    function handleOpenNick() {
      setOpen(true);
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        /* best-effort */
      }
    }
    window.addEventListener("statenour:open-nick", handleOpenNick);
    return () => window.removeEventListener("statenour:open-nick", handleOpenNick);
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
          // Mobile-tightening #2 · active:scale tap feedback (replaces
          // absent haptic on iOS Safari PWAs · operator sees the FAB
          // press-down). Subtle enough not to feel "bouncy" on desktop.
          "active:scale-95 transition-all",
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
              // Mobile bottom-sheet · 80vh max · 60vh min (2026-05-26
              // mobile-tightening · iPhone SE keyboard-up was leaving the
              // thread region < 30vh, the 60vh floor keeps the chat
              // usable even with the keyboard open)
              "inset-x-0 bottom-0 min-h-[60vh] max-h-[80vh] rounded-t-2xl border-t",
              // Desktop right-pane · 380px wide · full height
              "lg:top-0 lg:right-0 lg:bottom-0 lg:inset-x-auto lg:min-h-0 lg:max-h-none lg:w-[380px] lg:rounded-none lg:rounded-l-2xl lg:border-l lg:border-t-0",
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
              {/* "esc to close" hint · desktop only · phones don't have Esc */}
              <span className="ml-2 hidden lg:inline text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                esc to close
              </span>
              <button
                type="button"
                onClick={toggle}
                aria-label="close nick"
                className="ml-auto inline-flex h-10 w-10 lg:h-8 lg:w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/[0.15] active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </header>

            {/* Body · proactive coach chips + PageNick · scroll-isolated.
             *  Phase 5 FULL piece · operator sees what Nick noticed
             *  BEFORE they ask · then can either tap a chip's deep-link
             *  or ask a question via PageNick below. */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* Coach event chips · proactive surface (Phase 5 FULL) */}
              {coachEvents.length > 0 && (
                <section
                  aria-label="proactive coach events"
                  className="space-y-1.5"
                >
                  <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/70">
                    nick noticed
                  </p>
                  {coachEvents.map((event) => (
                    <CoachChip key={event.eventId} event={event} />
                  ))}
                </section>
              )}

              {/* Multi-turn chat · Phase 5 FULL · 2026-05-26.
               *  Thread state persists per-page in localStorage ·
               *  POSTs full history to /api/ai/side-pane-chat each
               *  turn · streams Nick's reply in. Operator can clear
               *  thread + start fresh anytime. */}
              <MultiTurnChat
                page={page}
                data={data}
                focus={focus}
                presets={presets ?? DEFAULT_PRESETS}
              />
            </div>

            {/* Footer hint · Phase 5 FULL is now live · multi-turn
             *  thread + proactive chip surfaces both shipped via the
             *  Coach Channel layer + new side-pane-chat endpoint. */}
            <footer className="px-4 py-2 border-t border-[var(--border-default)]/60 shrink-0">
              <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]/60">
                phase 5 full · multi-turn · proactive chips · per-device thread
              </p>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}

/* ─── Phase 5 FULL helper · coach event chip ──────────────────── */

function CoachChip({ event }: { event: CoachEvent }) {
  // Priority-gated styling · matches CoachEventBanner aesthetic
  // (P0 amber · P1 gold · P2 neutral). Compact pane variant ·
  // single-line title · body suppressed (operator can deep-link
  // for detail). Truncates long titles to keep the pane scannable.
  const tone =
    event.priority === "P0"
      ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-300/90"
      : event.priority === "P1"
        ? "border-[var(--gold)]/30 bg-[var(--gold)]/[0.05] text-[var(--gold)]"
        : "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.06] text-[var(--text-secondary)]";
  const Icon = event.priority === "P0" ? AlertTriangle : Sparkles;

  // Mobile-tightening #2 (2026-05-27): bumped padding + min-h-[44px]
  // so a tap lands cleanly on iPhone PWA. Single line clamp-2 stays · the
  // 44pt floor is met by the padding+icon+text on every chip.
  const body = (
    <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2.5 min-h-[44px]", tone)}>
      <Icon size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      <span className="text-[11px] leading-snug line-clamp-2 flex-1">{event.title}</span>
      {event.deepLink && (
        <ChevronRight size={12} strokeWidth={1.5} className="mt-0.5 shrink-0 opacity-60" />
      )}
    </div>
  );

  if (event.deepLink) {
    return (
      <Link
        href={event.deepLink}
        className="block active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 rounded-md"
      >
        {body}
      </Link>
    );
  }
  return body;
}
