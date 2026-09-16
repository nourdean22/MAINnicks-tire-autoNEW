"use client";

/**
 * ChangeSetLine · the "since your last visit" sentence · 2026-09-15 (wave 3).
 *
 * One renderer for every surface that has a change cursor. Markup is Home's
 * ChangeLine, unchanged, so the first consumer looks exactly as before:
 * a failed read is amber and says "unknown, not quiet"; nothing changed and
 * nothing failed renders NOTHING (never "0 changes"); parts the server
 * could not read are named. `data-change-set` carries the state for tests.
 *
 * 2026-09-16 · Visible Transformation: a real h2 eyebrow, the sentence at
 * reading size; the strings and `data-change-set` states are unchanged
 * (tests/components/change-set-line-states.test.tsx).
 */

import Link from "next/link";
import { describeChangeSet, formatSince, type ChangeSet } from "@/lib/ui/change-cursor";

export interface ChangeSetLineProps {
  set: ChangeSet | null | undefined;
  status: "loading" | "error" | "ready";
  /** Optional trailing link ("Activity →"). */
  link?: { href: string; label: string };
  className?: string;
}

export function ChangeSetLine({ set, status, link, className }: ChangeSetLineProps) {
  if (status === "error") {
    return (
      <section aria-label="since last visit" className={className ?? "mt-10"} data-change-set="error">
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-amber-300/90">change read failed — unknown, not quiet</p>
      </section>
    );
  }
  if (status !== "ready" || !set) return null;

  const bits = describeChangeSet(set);
  if (bits.length === 0) return null;

  return (
    <section aria-label="since last visit" className={className ?? "mt-10"} data-change-set={bits.length}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="vt-eyebrow text-fg-secondary">
          Since {formatSince(set.since)}
          {set.clamped && <span className="text-fg-tertiary"> (last 7d)</span>}
        </h2>
        {link ? (
          <Link
            href={link.href}
            className="ml-auto inline-flex min-h-[44px] items-center gap-1 font-mono text-[12px] uppercase tracking-[0.12em] text-fg-tertiary transition-colors duration-150 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {link.label}
          </Link>
        ) : null}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-fg">{bits.join(" · ")}</p>
    </section>
  );
}
