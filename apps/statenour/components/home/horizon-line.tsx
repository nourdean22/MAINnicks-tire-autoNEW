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
      <section aria-label="horizon" className="mt-8 border-t border-edge pt-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-amber-300/90">
          horizon unmeasured — reads failed
        </p>
      </section>
    );
  }
  if (horizon.slots.length === 0) return null;

  return (
    <section aria-label="horizon" className="mt-8 border-t border-edge pt-4">
      <p
        role="heading"
        aria-level={2}
        className="text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-fg-secondary"
      >
        Horizon
      </p>
      <ul className="mt-2 space-y-1">
        {horizon.slots.map((slot) => (
          <li key={slot.scope} className="flex min-h-[36px] items-baseline gap-3">
            <span className="w-12 shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-tertiary">
              {SCOPE_LABEL[slot.scope] ?? slot.scope}
            </span>
            {/* No title attr: the source is already the visible span beside
                this, and a title would shadow the accessible name in some
                serializers. */}
            <Link
              href={slot.href}
              className="min-w-0 truncate text-[13px] text-fg-secondary transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              {slot.label}
            </Link>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-tertiary/70">
              {slot.source}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
