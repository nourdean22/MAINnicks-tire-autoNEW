"use client";

/**
 * BrainFold: one closed native disclosure on the Brain Memory tab (wave D, 2026-10-24).
 *
 * The children stay MOUNTED while the fold is closed (a closed <details> keeps its content in the DOM),
 * so every block still runs its own read and the summary can count it. The summary reads the same body
 * node the fold hides: rows = the blocks that rendered (each block is one root element or nothing), and
 * "(n unreadable)" = the rows holding a failed-read marker, so a closed fold never hides a failure.
 * Until the body reports, the count is unknown and the summary shows the title alone.
 *
 * Pattern from components/home/context-rail.tsx (count from the rendered body via MutationObserver).
 * Not extracted into a shared helper: that file is Home's (another lane), and its fold is held open at
 * xl, which this one is not.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** What marks a failed read inside a row: this file's line, ReadStateNote, EmptyState, UnmeasuredLine. */
export const READ_FAILED_SELECTOR =
  '[data-read-failed], [data-read-state="error"], [data-read-state="offline"], [data-provenance="ERROR"]';

export function countFoldRows(body: Element): { rows: number; unreadable: number } {
  const rows = [...body.children];
  const unreadable = rows.filter((row) => row.matches(READ_FAILED_SELECTOR) || row.querySelector(READ_FAILED_SELECTOR)).length;
  return { rows: rows.length, unreadable };
}

export function BrainFold({ title, children }: { title: string; children: ReactNode }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<{ rows: number; unreadable: number } | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => setCount(countFoldRows(body));
    update();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(update);
    observer.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-read-failed", "data-read-state", "data-provenance"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <details className="group border-t border-edge">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-[15px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {count && <span className="font-mono tabular-nums text-fg-tertiary"> ({count.rows})</span>}
          {count && count.unreadable > 0 && <span className="text-red-300"> ({count.unreadable} unreadable)</span>}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="shrink-0 transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
      </summary>
      <div ref={bodyRef} className="space-y-6 pb-6 pt-3">
        {children}
      </div>
    </details>
  );
}

/**
 * A reading that could not be taken. Distinct from a reading of zero, and from a block that hides
 * because there is genuinely nothing to show. Carries the marker a closed BrainFold counts.
 */
export function ReadingUnavailable({ label }: { label: string }) {
  return (
    <p data-read-failed="" role="alert" className="border-l-2 border-red-400/60 py-1 pl-4 text-[13px] text-red-300">
      {label} couldn&apos;t load: state unknown, not empty.
    </p>
  );
}
