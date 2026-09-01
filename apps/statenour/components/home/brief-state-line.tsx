"use client";

/**
 * BriefStateLine — section 1 of the Command Surface: one line of ground
 * truth. Replaces the old identity-header card + health chip + pulse strip
 * (three surfaces, ~10 queries between them) with the server brief's state
 * section: date · measured health dot · one deterministic sentence.
 *
 * Truth rules carried over verbatim:
 *   · the dot is grey until the hub is MEASURED — unknown is never green
 *     (lib/home/health-state.ts, the 2026-08-04 false-green rule)
 *   · "operationally clear" is a claim the SERVER composes only when every
 *     queue read succeeded and returned zero
 *   · the clock ticks client-side but starts empty and fills in an effect,
 *     so the first client render matches SSR (home-hydration-safety.test).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BriefStateSection } from "@/lib/home/operator-brief";
import { cn } from "@/lib/utils/cn";

const DOT: Record<string, string> = {
  unknown: "bg-zinc-500",
  healthy: "bg-emerald-400",
  degraded: "bg-amber-400",
  broken: "bg-rose-400 motion-safe:animate-pulse",
};

const HEALTH_LABEL: Record<string, string> = {
  unknown: "not yet measured",
  healthy: "system healthy",
  degraded: "system degraded",
  broken: "needs attention",
};

export function BriefStateLine({
  state,
  loading,
  unreadable,
}: {
  state: BriefStateSection | null;
  loading: boolean;
  unreadable: boolean;
}) {
  // Hydration-safe clock: SSR renders the empty string; the effect fills it
  // after mount and keeps it current.
  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
      );
      setDateStr(
        now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      );
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const health = state?.health ?? null;
  const dotState = unreadable ? "unknown" : (health?.state ?? "unknown");

  return (
    <header aria-label="operator state" className="border-b border-edge pb-5 pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        {/* Real h1: the page's one document-outline root. base.css styles h1
            unlayered (display font, 1.75rem, uppercase) and BEATS utilities —
            don't add size/tracking classes here, they'd silently lose. */}
        <h1>Nour</h1>
        <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-fg-tertiary">
          {dateStr}
          {timeStr && <span className="text-fg-secondary"> · {timeStr}</span>}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href="/system"
          className="inline-flex min-h-[32px] items-center gap-2 rounded-md text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          title={health?.detail || undefined}
        >
          <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", DOT[dotState])} />
          {HEALTH_LABEL[dotState]}
        </Link>
        {state && !state.queues.measured && !unreadable && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400/90">
            some queues unread
          </span>
        )}
      </div>

      {loading ? (
        <div className="mt-4 h-6 w-4/5 animate-pulse rounded bg-raised" aria-hidden />
      ) : (
        state && (
          <p className="mt-4 text-balance text-xl font-medium leading-snug tracking-tight text-fg sm:text-2xl">
            {state.summary}
          </p>
        )
      )}
    </header>
  );
}
