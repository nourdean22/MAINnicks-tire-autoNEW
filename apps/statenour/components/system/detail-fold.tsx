"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Countable = { querySelectorAll(selector: string): { length: number } };

/** Blocks inside a fold that fetch for themselves mark their failed state `data-read-failed`. */
export function countFailedReads(root: Countable): number {
  return root.querySelectorAll("[data-read-failed]").length;
}

/**
 * One closed disclosure for the detail blocks under a page's first-screen answer (wave E1,
 * 2026-10-24). A closed fold must not hide a failed read, so the summary adds "n unreadable":
 * `unreadable` is what the page itself knows (its own failed queries), and the fold counts the
 * `data-read-failed` markers its self-fetching children render. The children stay mounted while the
 * fold is closed (a native <details> only hides them), so both counts stay live.
 */
export function DetailFold({
  label = "Detail",
  unreadable = 0,
  children,
}: {
  label?: string;
  unreadable?: number;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [inside, setInside] = useState(0);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof MutationObserver === "undefined") return;
    const update = () => setInside(countFailedReads(body));
    const frame = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    observer.observe(body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const total = unreadable + inside;

  return (
    <details aria-label={label} className="group border-y border-edge-subtle">
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
