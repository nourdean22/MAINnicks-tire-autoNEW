"use client";

import { trpc } from "@/lib/trpc/client";
import { AlertOctagon, RotateCcw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useState } from "react";

export function RecurringEnemiesCard() {
  const utils = trpc.useContext();
  const lessonsQ = trpc.systemBrain.antiPatterns.useQuery(undefined, {
    staleTime: 60_000,
  });

  const revisitMutation = trpc.systemBrain.revisitAntiPattern.useMutation({
    onSuccess: async () => {
      await utils.system.antiPatterns.invalidate();
    },
  });

  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  if (lessonsQ.isLoading) {
    return (
      <div className="h-[210px] rounded-surface border border-edge-subtle bg-content animate-pulse" />
    );
  }

  if (lessonsQ.isError) {
    return null; // Self-hide on error per house rules
  }

  const items = lessonsQ.data?.items ?? [];
  const enemies = [...items]
    .filter((item) => item.revisitCount > 0)
    .sort((a, b) => b.revisitCount - a.revisitCount)
    .slice(0, 3);

  if (enemies.length === 0) {
    return (
      <section
        aria-label="recurring-enemies-card"
        className="rounded-surface border border-edge-subtle bg-content p-3.5 flex flex-col justify-between min-h-[210px]"
      >
        <div className="flex items-center justify-between border-b border-edge-subtle pb-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            Recurring Enemies (Anti-Patterns)
          </p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
          <AlertOctagon className="h-6 w-6 text-fg-tertiary mb-2" />
          <p className="text-[12px] text-fg-secondary font-medium">No recurring enemies active.</p>
          <p className="text-[11px] text-fg-tertiary mt-0.5">Behavioral traps are currently contained.</p>
        </div>
      </section>
    );
  }

  const handleRevisit = async (key: string) => {
    try {
      setLoadingKey(key);
      await revisitMutation.mutateAsync({ key });
    } catch (err) {
      console.error("Failed to log enemy revisit:", err);
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <section
      aria-label="recurring-enemies-card"
      className="rounded-surface border border-edge-subtle bg-content p-3.5 flex flex-col justify-between min-h-[210px] space-y-3"
    >
      <div className="flex items-center justify-between border-b border-edge-subtle pb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Recurring Enemies
        </p>
        <span className="text-[11px] px-1.5 py-0.5 rounded-micro bg-amber-500/10 text-amber-300 font-medium">
          {enemies.length} Active
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto max-h-[140px] scrollbar-thin pr-1">
        {enemies.map((enemy) => {
          const isPending = loadingKey === enemy.key;
          return (
            <div
              key={enemy.key}
              className="flex items-center justify-between p-2 rounded-control bg-surface-interactive border border-edge-subtle hover:border-edge-strong transition-colors duration-[var(--motion-state)] group"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-fg text-[12px] truncate">
                    {enemy.key}
                  </span>
                  <span className="font-mono text-[11px] text-fg-tertiary">
                    {enemy.domain}
                  </span>
                </div>
                <p className="text-[11px] text-fg-tertiary truncate mt-0.5">
                  {enemy.lesson}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold tabular-nums px-2 py-0.5 rounded-micro bg-amber-500/10 text-amber-300 border border-amber-500/20 whitespace-nowrap">
                  LVL {enemy.revisitCount}
                </span>
                <button
                  id={`revisit-enemy-${enemy.key}`}
                  onClick={() => handleRevisit(enemy.key)}
                  disabled={isPending}
                  className="p-1 rounded-micro border border-edge-default bg-content text-fg-tertiary hover:text-fg hover:border-edge-strong transition-colors duration-[var(--motion-state)] disabled:opacity-40"
                  title="Log recurrence of this trap"
                >
                  <RotateCcw className={cn("h-3 w-3", isPending && "animate-spin")} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
