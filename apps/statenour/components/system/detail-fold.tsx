"use client";

import { useEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** What marks a FAILED read inside a row: a `data-read-failed` line, ReadStateNote, EmptyState, UnmeasuredLine. */
export const READ_FAILED_SELECTOR = '[data-read-failed], [data-read-state="error"], [data-provenance="ERROR"]';
/** A paused read (no connection) is not a failed one: counted apart, in amber. */
export const READ_OFFLINE_SELECTOR = '[data-read-state="offline"]';
/** A refresh that failed over cached data: the row still shows numbers, but old ones. Counted apart, in amber. */
export const READ_STALE_SELECTOR = '[data-read-state="stale"]';

const has = (row: Element, sel: string) => row.matches(sel) || !!row.querySelector(sel);

type FoldCount = { rows: number; unreadable: number; offline: number; stale: number };

/**
 * Each row lands in at most one bucket, worst first: failed, then offline, then stale. Shared by the
 * System Detail fold and BrainFold (which imports it from here), so the two cannot disagree about a closed block.
 */
export function countFoldRows(body: Element): FoldCount {
  const rows = [...body.children];
  const failed = (row: Element) => has(row, READ_FAILED_SELECTOR);
  const offline = (row: Element) => !failed(row) && has(row, READ_OFFLINE_SELECTOR);
  return {
    rows: rows.length,
    unreadable: rows.filter(failed).length,
    offline: rows.filter(offline).length,
    stale: rows.filter((row) => !failed(row) && !offline(row) && has(row, READ_STALE_SELECTOR)).length,
  };
}

/** What the Detail fold re-measures on, beyond added and removed rows. */
const WATCHED = ["data-read-failed", "data-read-state", "data-provenance"];

/**
 * Count something in a subtree that changes after mount. Null until measured (unknown, not zero).
 * Watches child changes AND the `data-read-failed` attribute: a block whose ok and failed branches
 * are the same element type (section to section) is reused by React, so the marker arrives as an
 * attribute change and no node is added.
 * `T` and `attributes` are optional (Brain folds measure rows, failed and offline together and watch the
 * offline marker too); the defaults keep this hook's original behaviour.
 */
export function useObservedCount<T = number>(
  measure: (root: HTMLDivElement) => T,
  attributes: string[] = ["data-read-failed"],
): [RefObject<HTMLDivElement | null>, T | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState<T | null>(null);
  const attributesRef = useRef(attributes);
  const measureRef = useRef(measure);
  measureRef.current = measure;

  useEffect(() => {
    const body = ref.current;
    if (!body || typeof MutationObserver === "undefined") return;
    const update = () => setCount(measureRef.current(body));
    const frame = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    observer.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: attributesRef.current });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return [ref, count];
}

/**
 * One closed disclosure for the blocks under a page's first-screen answer (wave E1, 2026-10-24). A
 * closed fold must not hide a failed read, so the summary adds "n unreadable": `unreadable` is what the
 * caller itself knows (its own failed queries), and the fold counts the failed, offline and stale markers
 * its self-fetching children render (BrainFold's rows and selectors). The children stay mounted while the fold is closed (a native <details>
 * only hides them), so both counts stay live. `open` is the initial state only when passed.
 */
export function DetailFold({
  label = "Detail",
  unreadable = 0,
  open,
  className,
  children,
}: {
  label?: string;
  unreadable?: number;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [bodyRef, inside] = useObservedCount(countFoldRows, WATCHED);
  const total = unreadable + (inside?.unreadable ?? 0);

  return (
    <details aria-label={label} open={open} className={cn("group border-y border-edge-subtle", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>
          {label}
          {total > 0 && <span className="text-red-300"> ({total} unreadable)</span>}
          {inside && inside.offline > 0 && <span className="text-amber-300"> ({inside.offline} offline)</span>}
          {inside && inside.stale > 0 && <span className="text-amber-300"> ({inside.stale} stale)</span>}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
      </summary>
      <div ref={bodyRef} className="space-y-6 pb-6 pt-4">
        {children}
      </div>
    </details>
  );
}
