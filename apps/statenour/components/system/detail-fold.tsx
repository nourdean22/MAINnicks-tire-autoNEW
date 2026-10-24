"use client";

import { useEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Countable = { querySelectorAll(selector: string): { length: number } };

/** Blocks inside a fold that fetch for themselves mark their failed state `data-read-failed`. */
export function countFailedReads(root: Countable): number {
  return root.querySelectorAll("[data-read-failed]").length;
}

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
 * caller itself knows (its own failed queries), and the fold counts the `data-read-failed` markers its
 * self-fetching children render. The children stay mounted while the fold is closed (a native <details>
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
  const [bodyRef, inside] = useObservedCount(countFailedReads);
  const total = unreadable + (inside ?? 0);

  return (
    <details aria-label={label} open={open} className={cn("group border-y border-edge-subtle", className)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg [&::-webkit-details-marker]:hidden">
        <span>
          {label}
          {total > 0 && <span className="text-red-300"> ({total} unreadable)</span>}
        </span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
      </summary>
      <div ref={bodyRef} className="space-y-6 pb-6 pt-4">
        {children}
      </div>
    </details>
  );
}
