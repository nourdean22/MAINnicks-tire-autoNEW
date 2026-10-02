"use client";

/**
 * HorizonLine — section 5: temporal context, one pointer per scope, never a
 * task list. A personal OS that only optimizes the next action lets you
 * execute perfectly today and still drift strategically — this line keeps
 * TODAY / WEEK / LATER visible at the cost of one row of type.
 *
 * Slots are context pointers, deliberately OUTSIDE the attention budget
 * (see operator-brief.ts doctrine §3): they assert "this exists on your
 * timeline", never "act on this now". Each carries its source (MIT ·
 * calendar · due date · goal horizon) as a receipt. Empty slots render
 * nothing; a fully empty measured horizon renders nothing at all.
 *
 * 2026-09-16 · Visible Transformation: drawn as a timeline (a rule with one
 * dot per scope) instead of a label row; a real h2 eyebrow; rows keep the
 * 44px tap contract (tests/home/horizon-line-target.test.tsx).
 */

import Link from "next/link";
import type { BriefHorizonSection } from "@/lib/home/operator-brief";

const SCOPE_LABEL: Record<string, string> = {
  now: "Now",
  today: "Today",
  week: "Week",
  later: "Later",
};

export function HorizonLine({ horizon }: { horizon: BriefHorizonSection | null }) {
  if (!horizon) return null;
  if (!horizon.measured) {
    return (
      <section aria-label="horizon">
        <h2 className="vt-eyebrow text-fg-secondary">Horizon</h2>
        <p className="mt-3 font-mono text-[12px] uppercase tracking-[0.12em] text-amber-300/90">
          horizon unmeasured — reads failed
        </p>
      </section>
    );
  }
  if (horizon.slots.length === 0) return null;

  return (
    <section aria-label="horizon">
      <h2 className="vt-eyebrow text-fg-secondary">Horizon</h2>
      <ol className="mt-4 border-l border-edge">
        {horizon.slots.map((slot) => (
          <li key={slot.scope} className="relative flex min-h-[44px] items-start gap-3 pl-5">
            <span aria-hidden className="absolute -left-[3.5px] top-[19px] h-1.5 w-1.5 rounded-full bg-fg-tertiary" />
            <span className="w-12 shrink-0 pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
              {SCOPE_LABEL[slot.scope] ?? slot.scope}
            </span>
            {/* No title attr: the source is already the visible span beside
                this, and a title would shadow the accessible name in some
                serializers. */}
            <Link
              href={slot.href}
              className="block min-w-0 flex-1 truncate py-3 text-[15px] text-fg transition-colors duration-150 hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {slot.label}
            </Link>
            <span className="shrink-0 pt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary/80">
              {slot.source}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
