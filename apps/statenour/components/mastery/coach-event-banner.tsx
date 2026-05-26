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
import { Sparkles, AlertTriangle, ChevronRight } from "lucide-react";
import { usePollingFetch } from "@/hooks/use-polling-fetch";
import type {
  CoachEvent,
  CoachEventPriority,
  CoachEventSurface,
} from "@/lib/services/coach-events";

interface CoachEventBannerProps {
  surface: CoachEventSurface;
  /** Cap of events to render in this banner. Default 3 · cards
   *  stack vertically · operator should be able to scan in one
   *  glance. Larger surfaces (admin/dashboard) can opt to 5. */
  limit?: number;
}

interface CoachEventsResponse {
  events: CoachEvent[];
}

export function CoachEventBanner({ surface, limit = 3 }: CoachEventBannerProps) {
  const { data, error } = usePollingFetch<CoachEventsResponse>(
    `/api/coach/events?surface=${encodeURIComponent(surface)}&limit=${limit}`,
    { intervalMs: 90_000 },
  );

  // Silent until we have data · zero-event states render nothing.
  // Errors fail silent too · the channel is advisory · not surfacing
  // it shouldn't break the page (the original alert mechanisms still
  // run during the migration window).
  if (error || !data?.events?.length) return null;

  return (
    <section
      aria-label={`coach events · ${surface}`}
      className="space-y-2"
      data-surface={surface}
    >
      {data.events.map((event) => (
        <CoachEventCard key={event.eventId} event={event} />
      ))}
    </section>
  );
}

function CoachEventCard({ event }: { event: CoachEvent }) {
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

  if (event.deepLink) {
    return (
      <Link
        href={event.deepLink}
        className="block focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 rounded-lg"
        aria-label={event.title}
      >
        {body}
      </Link>
    );
  }
  return body;
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
