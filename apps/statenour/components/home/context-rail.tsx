"use client";

/**
 * ContextRail: Home's right-hand rail (Horizon, Waiting on others, Since last visit).
 *
 * 2026-10-23 · appearance wave B. On a phone the three lines stacked under the brief as three more
 * blocks, so the verdict, Nick and the brief shared the first screens with context nobody asked for.
 * Below xl the rail is now ONE native disclosure, "Context (N)", closed; from xl it is held open with its
 * summary hidden, so the wide rail reads exactly as before. Same pattern as the Journal's Insights fold
 * (app/(mastery)/journal/_components/journal-insights-view.tsx, audit 09-F25).
 *
 * N counts the lines that actually rendered. Each line returns null while loading or empty, so a typed
 * "3" would be an invented number: the count is read from the same body node the fold hides. Until the
 * lines report, N is unknown, not zero, and with none rendered the rail shows no summary and no rule
 * (a lone stub of its left rule at xl was the 2026-09-16 hermetic-render bug). The aside is always
 * mounted: tests/e2e/desktop-density.spec.ts measures it as the second grid column.
 */

import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useMinWidth } from "@/hooks/use-min-width";
import { cn } from "@/lib/utils/cn";

/**
 * Whether the rail's lines are on screen right now: the fold is open, or the viewport is xl where it is held
 * open. A line that records "seen" (ChangeLine's last-visit cursor) reads this, so a closed fold never marks
 * unread changes as read. Outside a rail the default is true.
 */
export const ContextShownContext = createContext(true);

/** Lines that rendered: every line is one root element, or nothing. */
export function countContextLines(body: { children: ArrayLike<unknown> }): number {
  return body.children.length;
}

export function ContextRail({ children }: { children: ReactNode }) {
  const wide = useMinWidth(1280);
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // null until measured: before the lines report, the count is unknown, not zero.
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof MutationObserver === "undefined") return;
    const update = () => setCount(countContextLines(body));
    const frame = requestAnimationFrame(update);
    const observer = new MutationObserver(update);
    observer.observe(body, { childList: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const filled = !!count;

  return (
    <aside
      aria-label="context"
      data-home-column="context"
      className={cn(
        "mt-12 pt-2 xl:sticky xl:top-8 xl:mt-0 xl:pl-10",
        filled && "border-t border-edge xl:border-l xl:border-t-0",
      )}
    >
      <details open={wide || open} onToggle={(e) => setOpen(e.currentTarget.open)} hidden={!filled} className="group">
        {filled && (
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg xl:hidden [&::-webkit-details-marker]:hidden">
            <span>
              Context
              <span className="font-mono tabular-nums text-fg-tertiary"> ({count})</span>
            </span>
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-180" />
          </summary>
        )}
        <div ref={bodyRef} data-context-body className="mt-6 xl:mt-0">
          <ContextShownContext.Provider value={wide || open}>{children}</ContextShownContext.Provider>
        </div>
      </details>
    </aside>
  );
}
