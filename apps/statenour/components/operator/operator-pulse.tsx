"use client";

/**
 * OperatorPulse · Phase E (2026-05-18 PM)
 *
 * The forward-looking intelligence strip mounted at the top of the
 * four mastery surfaces (/tasks · /goals · /scoreboard · / home).
 * Composed server-side by lib/services/operator-pulse.ts · this
 * component is a passive display.
 *
 * Anatomy (max 3 lines · each self-hides when no signal):
 *
 *   ● pulse-line   · right-now-the-move-is-X-because-Y
 *   ○ forecast     · at-current-pace-where-are-we-headed
 *   ▲ drift        · what's-silently-rotting (optional)
 *
 * Leading dot color encodes tone:
 *   gold     · top-leverage move (highest-ROI task with goal hookup)
 *   emerald  · ahead of pace / calm scoreboard
 *   amber    · trailing / at-risk / drifting
 *   neutral  · informational
 *
 * Auto-refresh on data-changed events so a check-off updates the
 * pulse line without waiting for a poll.
 *
 * Aesthetic per docs/aesthetic-principles.md:
 *   · text-[var(--text-primary)] body
 *   · text-[var(--text-tertiary)] for labels and meta
 *   · gold ONLY on the leading dot of high-leverage moves
 *   · no chips · no rounded shadows · single-column readability
 *   · 60ch reading width on desktop · full width on mobile
 *
 * Built 2026-05-18 PM · response to "evolve the task page, my todo
 * list, goals and missions, stats · more useful, intelligent, clever"
 * brainstorm. ONE primitive · four surfaces · zero new schema.
 */

import { useEffect } from "react";
import Link from "next/link";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";

type PulseTone = "gold" | "amber" | "emerald" | "neutral";
type PulseSurface = "tasks" | "goals" | "scoreboard" | "home";

interface PulseLine {
  text: string;
  href: string | null;
  tone: PulseTone;
}

interface PulseShape {
  surface: PulseSurface;
  pulse: PulseLine | null;
  forecast: PulseLine | null;
  drift: PulseLine | null;
  composedAt: string;
}

const TONE_DOT: Record<PulseTone, string> = {
  gold: "bg-[var(--gold)]",
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
  neutral: "bg-white/30",
};

const TONE_RING: Record<PulseTone, string> = {
  gold: "shadow-[0_0_0_2px_rgba(253,185,19,0.18)]",
  amber: "shadow-[0_0_0_2px_rgba(251,191,36,0.18)]",
  emerald: "shadow-[0_0_0_2px_rgba(52,211,153,0.18)]",
  neutral: "shadow-none",
};

export function OperatorPulse({
  surface,
  className,
}: {
  surface: PulseSurface;
  className?: string;
}) {
  // useAuthedFetch auto-unwraps the {data: ...} envelope · this route
  // returns the snapshot directly (no envelope) so the type below is
  // PulseShape and the hook returns it as-is. Avoids the double-wrap
  // class of bugs (see HomeNarrator 2026-05-18 PM bugfix).
  const { data, reload } = useAuthedFetch<PulseShape>(
    `/api/operator/pulse?surface=${surface}`,
  );

  // Re-fetch on cross-surface data changes · check-off on /tasks should
  // refresh /home's pulse line without waiting for the next poll. The
  // 500ms debounce gives the server-side auto-learn write time to land
  // before we re-compose.
  useEffect(() => {
    const off = onDataChanged(
      ["tasks", "goals", "score", "brain", "commitments", "any"],
      () => {
        setTimeout(reload, 500);
      },
    );
    return off;
  }, [reload]);

  if (!data) return null;
  const lines = [data.pulse, data.forecast, data.drift].filter(
    (l): l is PulseLine => l !== null,
  );
  if (lines.length === 0) return null;

  return (
    <section
      aria-label={`operator pulse · ${surface}`}
      className={[
        "mx-auto max-w-[64ch] space-y-1.5 px-3 py-2.5",
        className ?? "",
      ].join(" ")}
    >
      {lines.map((line, i) => {
        const labelKey = i === 0 ? "pulse" : i === 1 ? "forecast" : "drift";
        const body = (
          <span className="flex items-start gap-2.5 text-sm leading-snug">
            <span
              aria-hidden
              className={[
                "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                TONE_DOT[line.tone],
                TONE_RING[line.tone],
              ].join(" ")}
            />
            <span className="min-w-0 flex-1">
              <span className="mr-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                {labelKey}
              </span>
              <span className="text-[var(--text-primary)]">{line.text}</span>
            </span>
          </span>
        );
        return line.href ? (
          <Link
            key={labelKey}
            href={line.href}
            className="block rounded-sm transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:bg-white/[0.05]"
          >
            {body}
          </Link>
        ) : (
          <div key={labelKey} className="block rounded-sm">
            {body}
          </div>
        );
      })}
    </section>
  );
}
