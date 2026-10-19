"use client";

/**
 * OutboxRedriveRow · one compact row on /system (wave 2V, 2026-10-19).
 *
 * The Fleet page was the only UI for system.outboxRedrive, and the outbox dead-letter Telegram alert
 * (app/api/cron/outbox-drain) points here. Nour cut the page, not the ability to redrive.
 *
 * States (empty-vs-error): loading and a failed read are UNKNOWN, never 0; a successful read of 0
 * dead-lettered hides the row; N > 0 shows the count and a Redrive button. The redrive is a two-tap
 * in-DOM confirm (window.confirm is silently suppressed in the iOS PWA): the first tap arms, only the
 * second calls the mutation, and an armed button disarms after a few seconds.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils/cn";

const DISARM_MS = 5000;

export function OutboxRedriveRow() {
  const health = trpc.system.outboxHealth.useQuery(undefined, { refetchInterval: 60_000 });
  const redrive = trpc.system.outboxRedrive.useMutation();
  const [armed, setArmed] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const rowClass = "flex min-h-[44px] items-center justify-between gap-3 border-y border-edge py-1 text-[15px]";

  if (health.isError) {
    return (
      <div className={rowClass} data-outbox-state="unknown">
        <span className="text-amber-100">Outbox: unknown, the read failed</span>
      </div>
    );
  }
  if (health.isLoading || !health.data) {
    return (
      <div className={rowClass} data-outbox-state="loading">
        <span className="text-fg-tertiary">Outbox: reading…</span>
      </div>
    );
  }

  const dead = health.data.dead;
  if (dead === 0 && !receipt) return null;

  const onTap = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    redrive.mutate(
      { limit: 200 },
      {
        onSuccess: (res: { redriven: number }) => {
          setReceipt(`Redriven ${res.redriven}`);
          void health.refetch();
        },
      },
    );
  };

  return (
    <div className={rowClass} data-outbox-state={dead > 0 ? "dead" : "clean"}>
      <span className="text-rose-200">
        {dead > 0 ? `Outbox: ${dead} dead-lettered` : "Outbox: clean"}
        {receipt ? <span className="ml-2 font-mono text-[11px] text-fg-tertiary">{receipt}</span> : null}
      </span>
      {dead > 0 && (
        <button
          type="button"
          onClick={onTap}
          disabled={redrive.isPending}
          className={cn(
            "inline-flex min-h-[44px] shrink-0 items-center rounded-control border px-4 text-[13px] font-medium transition-colors duration-[var(--motion-state)]",
            armed
              ? "border-transparent bg-accent text-[var(--text-inverse)]"
              : "border-edge-default text-fg-secondary hover:border-edge-strong hover:text-fg",
          )}
        >
          {armed ? `Tap again to redrive ${dead}` : "Redrive"}
        </button>
      )}
    </div>
  );
}
