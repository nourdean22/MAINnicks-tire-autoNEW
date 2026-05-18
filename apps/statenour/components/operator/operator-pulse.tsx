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

interface WisdomLine {
  text: string;
  attribution: string;
  href: string | null;
}

interface PulseShape {
  surface: PulseSurface;
  pulse: PulseLine | null;
  forecast: PulseLine | null;
  drift: PulseLine | null;
  /** Phase F · context-matched wisdom · italic 4th line */
  wisdom: WisdomLine | null;
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
  // Phase G.2 fix · label by slot intent · pre-fix the labels were
  // assigned by filtered-index so a null forecast made drift render
  // as "forecast" (observed on /scoreboard 2026-05-18). Now each
  // present line carries its own canonical label.
  const slots: Array<{ key: "pulse" | "forecast" | "drift"; line: PulseLine }> = [];
  if (data.pulse) slots.push({ key: "pulse", line: data.pulse });
  if (data.forecast) slots.push({ key: "forecast", line: data.forecast });
  if (data.drift) slots.push({ key: "drift", line: data.drift });
  const hasAnyContent = slots.length > 0 || data.wisdom !== null;
  if (!hasAnyContent) return null;

  return (
    <section
      aria-label={`operator pulse · ${surface}`}
      className={[
        "mx-auto max-w-[64ch] space-y-1.5 px-3 py-2.5",
        className ?? "",
      ].join(" ")}
    >
      {slots.map(({ key: labelKey, line }) => {
        // Phase H.2 · one-tap deep · every pulse line gets a small
        // "ask nick →" link that deep-links to /reason with the pulse
        // text pre-filled and the engine auto-running. Closes the
        // see → ask-deep loop without the operator having to copy-paste.
        const reasonHref = `/reason?q=${encodeURIComponent(line.text)}`;
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
        return (
          <div key={labelKey} className="group relative flex items-start gap-2">
            {line.href ? (
              <Link
                href={line.href}
                className="flex-1 min-w-0 block rounded-sm transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:bg-white/[0.05]"
              >
                {body}
              </Link>
            ) : (
              <div className="flex-1 min-w-0 block rounded-sm">{body}</div>
            )}
            <Link
              href={reasonHref}
              className="shrink-0 self-center text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-[var(--gold)] transition"
              title="ask Nick to think deeply about this"
            >
              ask →
            </Link>
          </div>
        );
      })}
      {/* Phase F · wisdom · 4th line · italic · attribution to right.
          Renders only when the wisdom matcher found a context-relevant
          quote. Visually quieter than the action lines (no dot) so it
          reads as a reflection alongside the pulse rather than another
          to-do. */}
      {data.wisdom ? (
        (() => {
          const wisdomBody = (
            <div className="flex items-start gap-2.5 text-sm leading-snug pl-4">
              <span className="min-w-0 flex-1">
                <span className="mr-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  wisdom
                </span>
                <span className="italic text-[var(--text-secondary)]">
                  &ldquo;{data.wisdom.text}&rdquo;
                </span>
                <span className="ml-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] not-italic">
                  · {data.wisdom.attribution}
                </span>
              </span>
            </div>
          );
          return data.wisdom.href ? (
            <Link
              key="wisdom"
              href={data.wisdom.href}
              className="block rounded-sm transition hover:bg-white/[0.03] focus-visible:outline-none focus-visible:bg-white/[0.05]"
            >
              {wisdomBody}
            </Link>
          ) : (
            <div key="wisdom" className="block rounded-sm">
              {wisdomBody}
            </div>
          );
        })()
      ) : null}
    </section>
  );
}
