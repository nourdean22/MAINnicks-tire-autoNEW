"use client";

/**
 * HomeStatePulse · Wave AC Phase 3 · 2026-05-28.
 *
 * Thin status strip below the action shelf · cross-surface "where am
 * I right now" signal at a glance:
 *
 *   ● calm · nick 82/100 · ai 1% err
 *
 * Reads from the existing useSystemPulse hook · self-hides when the
 * underlying pulse is null (offline / first load).
 *
 * Distinct from <OperatorPulse> which renders full pulse cards · this
 * is the editorial one-line summary the Sam home page wants right
 * above the chat composer.
 */

import { useMemo } from "react";
import { useSystemPulse } from "@/lib/hooks/use-system-pulse";

export function HomeStatePulse() {
  const pulse = useSystemPulse();

  const tone = useMemo(() => {
    if (!pulse) return null;
    const freshFatal = pulse.errorsFatal6h ?? pulse.errorsFatal24h ?? 0;
    const freshCronFail = pulse.cronFails1h ?? pulse.cronFails24h ?? 0;
    if (freshFatal > 0 || freshCronFail > 0) return "alert" as const;
    if (
      (pulse.errors24h ?? 0) > 0 ||
      (pulse.actionsPending ?? 0) > 0 ||
      (pulse.aiErrorRate ?? 0) > 5
    ) {
      return "watch" as const;
    }
    return "calm" as const;
  }, [pulse]);

  if (!pulse || !tone) return null;

  return (
    <section
      aria-label="state pulse"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)]"
    >
      <span className="flex items-center gap-1.5">
        <span
          className={
            tone === "alert"
              ? "h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse"
              : tone === "watch"
                ? "h-1.5 w-1.5 rounded-full bg-amber-400"
                : "h-1.5 w-1.5 rounded-full bg-emerald-400"
          }
          aria-hidden
        />
        {tone}
      </span>
      {pulse.nickQualityAvg7d != null && (
        <>
          <span className="text-[var(--text-tertiary)]/40">·</span>
          <span>
            nick{" "}
            <span className="text-[var(--gold)] tabular-nums">
              {pulse.nickQualityAvg7d}/100
            </span>
          </span>
        </>
      )}
      {pulse.aiErrorRate != null && pulse.aiErrorRate > 0 && (
        <>
          <span className="text-[var(--text-tertiary)]/40">·</span>
          <span>
            ai{" "}
            <span
              className={
                pulse.aiErrorRate > 20
                  ? "text-rose-400 tabular-nums"
                  : pulse.aiErrorRate > 5
                    ? "text-amber-400 tabular-nums"
                    : "text-emerald-400 tabular-nums"
              }
            >
              {pulse.aiErrorRate}%
            </span>{" "}
            err
          </span>
        </>
      )}
      {pulse.actionsPending > 0 && (
        <>
          <span className="text-[var(--text-tertiary)]/40">·</span>
          <span>
            <span className="text-amber-400 tabular-nums">
              {pulse.actionsPending}
            </span>{" "}
            pending
          </span>
        </>
      )}
    </section>
  );
}
