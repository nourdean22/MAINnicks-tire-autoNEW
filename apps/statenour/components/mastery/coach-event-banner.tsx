"use client";

/**
 * CoachEventBanner · Mastery Layer Stage A surface · 2026-05-26
 *
 * The unified display surface for coach-channel events. Mounted on
 * each of the 5 daily-driver pages with a different `surface` prop
 * filter. Same component everywhere · operator gets consistent
 * affordances and styling across /tasks · /goals · /journal · /brain
 * · /scoreboard.
 *
 * Reads from `/api/coach/events?surface=X` via usePollingFetch (the
 * canonical polling primitive). Tab-visibility paused. Auto-cleanup.
 * Polls every 90s (faster than NickHealthSection's 120s because
 * coach events should feel responsive to recent crons firing).
 *
 * Visual language · editorial-minimalist · priority-gated accent:
 *   - P0 events → amber accent (system noticed something important)
 *   - P1 events → gold accent (worth attention)
 *   - P2 events → neutral border (advisory · low urgency)
 *
 * Auto-hides cleanly when there are zero events. No skeleton flash
 * on initial load (silent until first response arrives).
 *
 * Phase 1 of consumption · render-only, no dismiss UI yet. Operator
 * acks via the deep-link clicking through. Dismiss-by-tap lands in
 * a follow-up when POST /api/coach/events/:key/ack ships.
 */

import Link from "next/link";
import { useState, useCallback } from "react";
import { Sparkles, AlertTriangle, ChevronRight, X } from "lucide-react";
import { useCoachEvents } from "@/lib/hooks/use-coach-events";
// Wave-AO follow-up · import from the client-safe types module · the
// heavy ./coach-events module imports prisma and would break the
// client build if pulled in transitively (same v10.0.209 constraint
// as lib/ai/provider.ts).
import { buildCoachEventKey } from "@/lib/services/coach-events-types";
import type {
  CoachEvent,
  CoachEventPriority,
  CoachEventSurface,
} from "@/lib/services/coach-events-types";

interface CoachEventBannerProps {
  surface: CoachEventSurface;
  /** Cap of events to render in this banner. Default 3 · cards
   *  stack vertically · operator should be able to scan in one
   *  glance. Larger surfaces (admin/dashboard) can opt to 5. */
  limit?: number;
}

export function CoachEventBanner({ surface, limit = 3 }: CoachEventBannerProps) {
  // Shared, surface-keyed poller (de-duped with NickSidePane — they used to
  // each run a separate usePollingFetch against the same endpoint).
  const { events, reload } = useCoachEvents(surface, { limit });

  // Optimistic-dismissed event keys · hides them locally before the
  // poll refreshes. Server-side ack is fire-and-forget · failure
  // surfaces on next poll when the event reappears.
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback(
    (event: CoachEvent) => {
      const key = buildCoachEventKey(event.kind, event.subjectId);
      // Optimistic local hide.
      setDismissedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      // Fire-and-forget POST · failure-tolerant · next poll resyncs.
      void fetch(`/api/coach/events/${encodeURIComponent(key)}/ack`, {
        method: "POST",
        credentials: "include",
      })
        .then(() => reload())
        .catch(() => {
          /* silent · next poll will reflect server state */
        });
    },
    [reload],
  );

  // Silent until we have data · zero-event states render nothing.
  // Errors fail silent too · the channel is advisory · not surfacing
  // it shouldn't break the page (the original alert mechanisms still
  // run during the migration window).
  if (!events.length) return null;

  const visibleEvents = events.filter(
    (e) => !dismissedKeys.has(buildCoachEventKey(e.kind, e.subjectId)),
  );
  if (visibleEvents.length === 0) return null;

  return (
    <section
      aria-label={`coach events · ${surface}`}
      className="space-y-2"
      data-surface={surface}
    >
      {visibleEvents.map((event) => (
        <CoachEventCard
          key={event.eventId}
          event={event}
          onDismiss={event.dismissable ? () => handleDismiss(event) : undefined}
        />
      ))}
    </section>
  );
}

function CoachEventCard({
  event,
  onDismiss,
}: {
  event: CoachEvent;
  onDismiss?: () => void;
}) {
  const tone = toneForPriority(event.priority);
  const Icon = event.priority === "P0" ? AlertTriangle : Sparkles;

  const body = (
    <div className={["rounded-lg border px-3 py-2.5 transition-colors", tone.container].join(" ")}>
      <div className="flex items-start gap-2.5">
        <Icon
          size={13}
          strokeWidth={1.75}
          className={["mt-0.5 shrink-0", tone.icon].join(" ")}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={[
                "text-[9px] font-mono uppercase tracking-[0.18em]",
                tone.label,
              ].join(" ")}
            >
              {labelForKind(event)}
            </span>
            <span className="text-[9px] font-mono tabular-nums text-[var(--text-tertiary)]">
              · {event.priority}
            </span>
          </div>
          <p className="mt-1 text-[12px] font-medium text-[var(--text-primary)] leading-snug truncate">
            {event.title}
          </p>
          {event.body && (
            <p className="mt-1 text-[11px] text-[var(--text-secondary)] leading-snug line-clamp-2">
              {event.body}
            </p>
          )}
        </div>
        {event.deepLink && (
          <ChevronRight
            size={14}
            className="mt-1 shrink-0 text-[var(--text-tertiary)]"
            strokeWidth={1.5}
          />
        )}
      </div>
    </div>
  );

  // Wrapper · deep-link if available + dismiss button absolute-positioned.
  // Dismiss button stops click propagation so tapping X doesn't navigate.
  const wrapped = event.deepLink ? (
    <Link
      href={event.deepLink}
      className="block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 rounded-lg"
      aria-label={event.title}
    >
      {body}
    </Link>
  ) : (
    body
  );

  if (!onDismiss) return wrapped;

  return (
    <div className="relative group">
      {wrapped}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
        }}
        aria-label={`dismiss ${event.title}`}
        className={[
          // Mobile-tightening #2 (2026-05-27): bumped 7→9 (28→36pt) on
          // mobile · keeps the visual at 7 on desktop (lg:h-7 lg:w-7)
          // since hover-discovery isn't an issue on cursor surfaces.
          "absolute top-1.5 right-1.5 inline-flex h-11 w-11 lg:h-7 lg:w-7 items-center justify-center",
          "rounded-md border border-transparent",
          "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
          "hover:bg-[var(--bg-raised)]/[0.2] hover:border-[var(--border-default)]",
          "active:scale-90 transition-all focus-visible:outline-none",
          "focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          // Always visible on touch (no hover state on iOS PWA)
          "[@media(hover:none)]:opacity-100",
        ].join(" ")}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

/* ─── Style helpers ────────────────────────────────────────────── */

interface ToneClasses {
  container: string;
  icon: string;
  label: string;
}

function toneForPriority(priority: CoachEventPriority): ToneClasses {
  if (priority === "P0") {
    return {
      container: "border-amber-500/30 bg-amber-500/[0.04] hover:bg-amber-500/[0.07]",
      icon: "text-amber-300",
      label: "text-amber-300/80",
    };
  }
  if (priority === "P1") {
    return {
      container:
        "border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] hover:bg-[var(--gold)]/[0.07]",
      icon: "text-[var(--gold)]",
      label: "text-[var(--gold)]",
    };
  }
  return {
    container:
      "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.04] hover:bg-[var(--bg-raised)]/[0.08]",
    icon: "text-[var(--text-tertiary)]",
    label: "text-[var(--text-tertiary)]",
  };
}

function labelForKind(event: CoachEvent): string {
  switch (event.kind) {
    case "pricing-advisory":
      return "pricing advisory";
    case "prune-candidate":
      return "stale goal";
    case "drift-recovery":
      return "drift detected";
    case "idle-nudge":
      return "still on this?";
    case "goal-pace-shift":
      return "goal pace shift";
    case "mission-deadline-check":
      return "mission deadline";
    case "proactive-nick":
      return "nick coaching";
    case "anomaly":
      return "anomaly";
    case "system-alert":
      return "system alert";
    default:
      return "coach";
  }
}
