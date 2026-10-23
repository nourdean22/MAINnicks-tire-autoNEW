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
 *
 * 2026-09-16 · Visible Transformation: the state sentence IS the page's NOW
 * region — the one display line Home is allowed to shout (`.vt-verdict`).
 * The wordmark stays the document's h1 (base.css styles it unlayered).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BriefStateSection } from "@/lib/home/operator-brief";
import { cn } from "@/lib/utils/cn";

const DOT: Record<string, string> = {
  unknown: "bg-fg-tertiary",
  healthy: "bg-emerald-400",
  degraded: "bg-amber-400",
  broken: "bg-rose-400",
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
    <header aria-label="operator state" className="pt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Real h1: the page's one document-outline root. base.css styles h1
            in @layer base (28px Geist, sentence case) — keep it bare so the
            page title stays uniform across pages. */}
        <h1>Nour</h1>
        <p className="font-mono text-[11px] text-fg-tertiary">
          {dateStr}
          {timeStr && <span className="text-fg-secondary"> · {timeStr}</span>}
        </p>
      </div>

      {/* UI v3 W2 (2026-10-16): the verdict is the hero. It starts right under the wordmark, runs the
          full column instead of an 18ch measure, and steps up a size at each width, so from six feet
          Home reads as one sentence with a brief under it. The signal notch marks NOW, the one gold
          mark on the page that is not an action. */}
      <div className="mt-5 border-b border-edge-subtle pb-5">
        <div className="flex items-center gap-2">
          <span className="notch h-3" aria-hidden />
          <h2 className="vt-eyebrow text-fg-secondary">Now</h2>
        </div>

        {loading ? (
          <div className="mt-3 h-24 w-11/12 animate-pulse rounded-micro bg-raised sm:h-28" aria-hidden />
        ) : (
          state && (
            <p className="vt-verdict mt-3 max-w-none text-balance text-[2.25rem] leading-[1.04] tracking-tight sm:text-[2.75rem] xl:text-[3.5rem]">
              {state.summary}
            </p>
          )
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
          <Link
            href="/system"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-control text-[13px] text-fg-tertiary transition-colors duration-150 hover:text-fg"
            title={health?.detail || undefined}
          >
            <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", DOT[dotState])} />
            {HEALTH_LABEL[dotState]}
          </Link>
          {state && !state.queues.measured && !unreadable && (
            <span className="text-[13px] text-amber-300">
              some queues unread
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
