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
import { useSystemPulse, type SystemPulse } from "@/lib/hooks/use-system-pulse";

export type StatePulseTone = "alert" | "watch" | "degraded" | "calm";

/**
 * Derive the strip's tone from a pulse snapshot.
 *
 * PURE and exported so the decision can be pinned directly — the component
 * around it needs React and the hook's module-level cache, and the decision
 * needs neither.
 *
 * THE DEGRADED BRANCH IS THE POINT. When the Neon quota circuit is open,
 * buildSystemPulse returns without running a single query: every count below is
 * zero because nothing was measured. Those zeros used to fall straight through
 * to "calm", so the operator's most-seen status signal rendered a green dot and
 * the literal word CALM while asserting zero cron failures, zero fatal errors
 * and zero pending autonomous actions — at the exact moment none of them had
 * been looked at.
 *
 * Precedence is deliberate: a REAL alarm still outranks "we could not measure".
 * A fatal error that was actually recorded is worse news than an unread table,
 * and burying it under a degraded badge would be a new false-green.
 */
export function deriveStatePulseTone(pulse: SystemPulse | null): StatePulseTone | null {
  if (!pulse) return null;
  const freshFatal = pulse.errorsFatal6h ?? pulse.errorsFatal24h ?? 0;
  const freshCronFail = pulse.cronFails1h ?? pulse.cronFails24h ?? 0;
  if (freshFatal > 0 || freshCronFail > 0) return "alert";
  // Undefined means a payload minted before this field was read — treat as
  // measured, matching the previous behaviour rather than painting every
  // cached snapshot degraded.
  if (pulse.dbQuotaExhausted === true) return "degraded";
  if (
    (pulse.errors24h ?? 0) > 0 ||
    (pulse.actionsPending ?? 0) > 0 ||
    (pulse.aiErrorRate ?? 0) > 5
  ) {
    return "watch";
  }
  return "calm";
}

export function HomeStatePulse() {
  const pulse = useSystemPulse();

  const tone = useMemo(() => deriveStatePulseTone(pulse), [pulse]);

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
                : // Neutral, NOT green. Green is a claim that the system was
                  // measured and is well; degraded is the absence of a reading.
                  tone === "degraded"
                  ? "h-1.5 w-1.5 rounded-full bg-slate-400"
                  : "h-1.5 w-1.5 rounded-full bg-emerald-400"
          }
          aria-hidden
        />
        <span title={tone === "degraded" ? "database quota circuit open — these counts were not measured" : undefined}>
          {tone === "degraded" ? "unmeasured" : tone}
        </span>
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
