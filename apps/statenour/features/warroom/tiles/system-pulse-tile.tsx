"use client";

import { useSystemPulse } from "@/lib/hooks/use-system-pulse";

/**
 * War-Room · Slice 3 · System Pulse tile content.
 *
 * Reuses the shared `useSystemPulse` hook (30s de-duped poll via the
 * vanilla tRPC client; swallows errors → null). Neutral "loading" state
 * on null so a 401 / cold cache never crashes the widget.
 */
export function SystemPulseTile() {
  const pulse = useSystemPulse();

  if (!pulse) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="animate-pulse font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
          loading pulse…
        </span>
      </div>
    );
  }

  const metrics = [
    { label: "cron fails 24h", value: pulse.cronFails24h, warn: pulse.cronFails24h > 0 },
    { label: "ai error rate", value: `${Math.round(pulse.aiErrorRate * 100)}%`, warn: pulse.aiErrorRate > 0.1 },
    { label: "actions pending", value: pulse.actionsPending, warn: pulse.actionsPending > 0 },
    { label: "devices offline", value: `${pulse.devicesOffline}/${pulse.devicesTotal}`, warn: pulse.devicesOffline > 0 },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg border border-[var(--glass-border)] bg-white/[0.02] px-2.5 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{m.label}</p>
          <p
            className={`mt-1 text-lg font-medium tabular-nums ${m.warn ? "text-amber-400" : "text-[var(--text-primary)]"}`}
          >
            {m.value}
          </p>
        </div>
      ))}
    </div>
  );
}
