"use client";

/**
 * ActiveAlertsCard: one line in the Brain Memory tab's Signals fold (wave D, 2026-10-24).
 *
 * It used to list every brain alert with its own Resolve and Mute buttons, a second copy of
 * /system/alerts, which reads the same `trpc.brain.activeAlerts` and owns resolve, mute and dismiss.
 * Now it says how many alerts are open and links there. Silent when there are none; a failed read
 * renders a failed line (the closed fold counts it as unreadable), never "no alerts".
 */

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { isRetrying, readState } from "@/lib/query-state";

interface AlertsPayload {
  sinceDays: number;
  counts: Record<string, number>;
}

/**
 * buildActiveAlerts caps every category at `limit` (lib/services/brain-domain.ts), so a category at the
 * cap may hold more. Asked for explicitly, so the line knows the cap it compares against.
 */
const ALERTS_PER_CATEGORY = 10;

export function ActiveAlertsCard() {
  const alertsQuery = trpc.brain.activeAlerts.useQuery({ limit: ALERTS_PER_CATEGORY });
  const payload = (alertsQuery.data as AlertsPayload | undefined) ?? null;
  const state = readState(alertsQuery);
  const note = (
    <ReadStateNote
      state={state}
      label="Brain alerts"
      onRetry={() => void alertsQuery.refetch()}
      retrying={isRetrying(alertsQuery)}
    />
  );

  if (state === "loading") return null;
  if (!payload) return note;

  const counts = Object.values(payload.counts);
  const total = counts.reduce((a, b) => a + b, 0);
  // A refresh that failed over cached data: the old count must not read as current.
  if (total === 0) return state === "stale" ? note : null;
  const capped = counts.some((n) => n >= ALERTS_PER_CATEGORY);

  return (
    <div className="space-y-1">
      {note}
      <Link
        href="/system/alerts"
        className="flex min-h-[44px] items-center justify-between gap-3 border-l-2 border-amber-400/60 pl-4 text-[15px] text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
      >
        <span>
          {capped ? `${total}+` : total} brain alert{total === 1 && !capped ? "" : "s"} open in the last {payload.sinceDays} days
        </span>
        <span className="shrink-0 font-mono text-[13px] text-fg-tertiary">Review in System</span>
      </Link>
    </div>
  );
}
