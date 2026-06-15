"use client";

/**
 * HomeIdentityHeader · Wave AC.b · 2026-05-28.
 *
 * Always-on affordance at the top of /home. Pre-this-fix the home page
 * looked identical to /chat on a quiet morning because NicksHomeBrief +
 * HomeOneTapMoves + HomeStatePulse all self-hide on null data. Operator
 * saw "morning, Nour." + the composer and couldn't tell they were on
 * /home vs /chat.
 *
 * This header is unconditional · 1 row · low visual weight · gold
 * eyebrow + date + a tiny "nick is listening" pulse dot. It functions
 * as the home page's identity stamp · proves the surface even when no
 * dynamic content has loaded yet.
 *
 * Server-renderable · no fetch · no state. Renders the same on every
 * mount (just shows today's date so it stays fresh without re-renders).
 */

import { Brain } from "lucide-react";
import { today } from "@/lib/utils/datetime";
import { trpc } from "@/lib/trpc/client";

export function HomeIdentityHeader() {
  // Client-render the date string in a stable timezone-aware fashion.
  // We don't import the day-of-week label here — too local + would
  // need an i18n decision. The ISO date alone is the operator-grade
  // marker (matches the rest of the OS).
  const todayStr = today();
  
  const { data: inboxCount = 0 } = trpc.task.inboxCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  return (
    <section
      aria-label="home identity"
      className="flex items-center gap-2 px-1 pt-1"
    >
      <Brain
        size={12}
        className="text-[var(--gold)] shrink-0"
        strokeWidth={1.75}
      />
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
        nick · home
      </span>
      <span className="text-[var(--text-tertiary)]/40">·</span>
      <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
        {todayStr}
      </span>
      {inboxCount >= 10 && (
        <>
          <span className="text-[var(--text-tertiary)]/40">·</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.25 rounded bg-rose-500/10 border border-rose-500/20 text-[9px] font-semibold text-rose-400 animate-pulse uppercase tracking-wider font-mono">
            inbox backlog ({inboxCount})
          </span>
        </>
      )}
      <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-[var(--text-tertiary)]">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-emerald-400/80 animate-pulse"
        />
        ready
      </span>
    </section>
  );
}
