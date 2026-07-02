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
      <div className="h-[210px] rounded-lg border border-white/10 bg-white/2 animate-pulse" />
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
        className="rounded-lg border border-white/10 bg-white/2 p-3.5 flex flex-col justify-between min-h-[210px]"
      >
        <div className="flex items-center justify-between border-b border-white/6 pb-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Recurring Enemies (Anti-Patterns)
          </p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
          <AlertOctagon className="h-6 w-6 text-white/20 mb-2" />
          <p className="text-[11px] text-white/50 font-medium">No recurring enemies active.</p>
          <p className="text-[9px] text-white/30 mt-0.5">Behavioral traps are currently contained.</p>
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
      className="rounded-lg border border-amber-500/10 bg-amber-500/1 p-3.5 flex flex-col justify-between min-h-[210px] space-y-3"
    >
      <div className="flex items-center justify-between border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-semibold flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> Recurring Enemies
        </p>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-medium">
          {enemies.length} Active
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto max-h-[140px] scrollbar-thin pr-1">
        {enemies.map((enemy) => {
          const isPending = loadingKey === enemy.key;
          return (
            <div
              key={enemy.key}
              className="flex items-center justify-between p-2 rounded bg-white/1 border border-white/3 hover:border-amber-500/10 transition group"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-white/80 text-[11px] truncate">
                    {enemy.key}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-white/30">
                    {enemy.domain}
                  </span>
                </div>
                <p className="text-[10px] text-white/50 truncate mt-0.5">
                  {enemy.lesson}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
                  LVL {enemy.revisitCount}
                </span>
                <button
                  id={`revisit-enemy-${enemy.key}`}
                  onClick={() => handleRevisit(enemy.key)}
                  disabled={isPending}
                  className="p-1 rounded bg-white/3 border border-white/5 text-white/40 hover:text-amber-400 hover:border-amber-500/20 transition disabled:opacity-40"
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
