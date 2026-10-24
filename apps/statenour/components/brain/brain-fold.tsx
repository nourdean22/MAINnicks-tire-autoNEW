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
 * The body is measured by useObservedCount from components/system/detail-fold.tsx (wave E1), with the
 * offline, provenance and id markers added to what it watches.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useObservedCount } from "@/components/system/detail-fold";

/** What marks a FAILED read inside a row: this file's line, ReadStateNote, EmptyState, UnmeasuredLine. */
export const READ_FAILED_SELECTOR = '[data-read-failed], [data-read-state="error"], [data-provenance="ERROR"]';
/** A paused read (no connection) is not a failed one: counted apart, in amber. */
export const READ_OFFLINE_SELECTOR = '[data-read-state="offline"]';

const has = (row: Element, sel: string) => row.matches(sel) || !!row.querySelector(sel);

export function countFoldRows(body: Element): { rows: number; unreadable: number; offline: number } {
  const rows = [...body.children];
  return {
    rows: rows.length,
    unreadable: rows.filter((row) => has(row, READ_FAILED_SELECTOR)).length,
    offline: rows.filter((row) => !has(row, READ_FAILED_SELECTOR) && has(row, READ_OFFLINE_SELECTOR)).length,
  };
}

/** The element the URL hash names, when it sits inside `body`. */
function hashTarget(body: Element): Element | null {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // a malformed escape: use the raw id
  }
  const el = document.getElementById(id);
  return el && body.contains(el) ? el : null;
}

/** The markers a Brain fold re-measures on, beyond added and removed rows. */
const WATCHED = ["data-read-failed", "data-read-state", "data-provenance", "id"];

export function BrainFold({ title, children }: { title: string; children: ReactNode }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Shared with the System detail fold (wave E1): one observer, measured from the hidden body.
  const [bodyRef, count] = useObservedCount(countFoldRows, WATCHED);
  const openedFor = useRef("");

  // A deep link (#pin-<id>, #pinned-context, #recall-preview, #anti-patterns) into a closed fold would
  // scroll to a hidden box. Open once per hash, so closing it again sticks. Re-checked whenever the body
  // re-measures (a row that renders late) and on hashchange.
  useEffect(() => {
    const body = bodyRef.current;
    const details = detailsRef.current;
    if (!body || !details) return;
    const openForHash = () => {
      const hash = window.location.hash;
      if (!hash || hash === openedFor.current) return;
      const el = hashTarget(body);
      if (!el) return;
      openedFor.current = hash;
      if (!details.open) details.open = true;
      el.scrollIntoView?.({ block: "start" });
    };
    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, [bodyRef, count]);

  return (
    <details ref={detailsRef} className="group border-t border-edge">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-[15px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>
          {title}
          {count && <span className="font-mono tabular-nums text-fg-tertiary"> ({count.rows})</span>}
          {count && count.unreadable > 0 && <span className="text-red-300"> ({count.unreadable} unreadable)</span>}
          {count && count.offline > 0 && <span className="text-amber-300"> ({count.offline} offline)</span>}
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
