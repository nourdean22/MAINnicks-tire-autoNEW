"use client";

import { useState } from "react";
import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/glass-card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { trpc } from "@/lib/trpc/client";
import { notifyDataChanged } from "@/lib/events/data-change";
import { cn } from "@/lib/utils";

const SEVERITY_TONE = {
  info: "border-sky-400/25 text-sky-300 bg-sky-400/[0.04]",
  warn: "border-amber-400/30 text-amber-300 bg-amber-400/[0.05]",
  critical: "border-rose-400/35 text-rose-300 bg-rose-400/[0.06]",
} as const;

/**
 * The former /system/anti-patterns page was removed during System consolidation,
 * but the durable BrainMemory library and all three tRPC mutations stayed live.
 * This is the canonical operator surface now: anti-patterns are learned memory,
 * so they belong inside Brain rather than another System subpage.
 */
export function AntiPatternsPanel() {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();
  const query = trpc.system.antiPatterns.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const revisit = trpc.system.revisitAntiPattern.useMutation();
  const remove = trpc.system.deleteAntiPattern.useMutation();
  const { confirm, dialog } = useConfirmDialog();

  const data = query.data;
  const items = data?.items ?? [];
  const visible = expanded ? items : items.slice(0, 5);

  const refresh = async () => {
    await utils.system.antiPatterns.invalidate();
    await query.refetch();
  };

  const markRevisited = async (key: string) => {
    try {
      const result = await revisit.mutateAsync({ key });
      toast.success("Lesson revisited", {
        description: `${key} · ${result.revisitCount} revisit${result.revisitCount === 1 ? "" : "s"}`,
      });
      await refresh();
      notifyDataChanged("brain", {
        source: "anti-patterns-panel",
        detail: "revisit",
        id: key,
      });
    } catch (err) {
      toast.error("Could not mark revisited", {
        description: (err as Error).message,
      });
    }
  };

  const softRemove = async (key: string) => {
    const ok = await confirm({
      title: "Remove this anti-pattern?",
      body: "Soft-removes it from the active anti-pattern library. The history remains recoverable; this is not a hard delete.",
      confirmLabel: "Remove",
      cancelLabel: "Keep",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await remove.mutateAsync({ key });
      toast.success("Anti-pattern removed");
      await refresh();
      notifyDataChanged("brain", {
        source: "anti-patterns-panel",
        detail: "soft-remove",
        id: key,
      });
    } catch (err) {
      toast.error("Could not remove anti-pattern", {
        description: (err as Error).message,
      });
    }
  };

  return (
    <section id="anti-patterns" className="scroll-mt-24 space-y-3" aria-label="anti-pattern library">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/80">
            Learned failures
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">Anti-patterns</h3>
          <p className="mt-1 max-w-2xl text-xs text-[var(--text-secondary)]">
            Things you tried, what happened, and the lesson the brain should not make you relearn.
          </p>
        </div>
        {data ? (
          <div className="flex gap-2 text-[10px] font-mono text-[var(--text-tertiary)]">
            <span>{data.summary.total} total</span>
            <span>· {data.summary.bySeverity.critical} critical</span>
            <span>· {data.summary.bySeverity.warn} warn</span>
          </div>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <GlassCard className="p-4">
          <p className="text-sm text-amber-300">
            Anti-pattern library could not load — state unknown, not empty.
          </p>
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard className="p-4">
          <p className="text-sm text-[var(--text-secondary)]">
            No active anti-patterns are recorded.
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-2.5">
          {visible.map((item) => (
            <GlassCard key={item.key} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider",
                        SEVERITY_TONE[item.severity],
                      )}
                    >
                      {item.severity}
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                      {item.domain}
                    </span>
                    {item.revisitCount > 0 ? (
                      <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
                        revisited {item.revisitCount}×
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--text-primary)]">
                    {item.lesson}
                  </p>
                  {item.attempt || item.outcome ? (
                    <div className="mt-2 grid gap-2 text-[11px] text-[var(--text-secondary)] sm:grid-cols-2">
                      {item.attempt ? <p><span className="text-[var(--text-tertiary)]">Tried · </span>{item.attempt}</p> : null}
                      {item.outcome ? <p><span className="text-[var(--text-tertiary)]">Result · </span>{item.outcome}</p> : null}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => void markRevisited(item.key)}
                    disabled={revisit.isPending || remove.isPending}
                    className="inline-flex min-h-[48px] items-center gap-1.5 rounded-lg border border-[var(--border-default)] px-3 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--gold)]/40 hover:text-[var(--gold)] disabled:opacity-50"
                  >
                    <RotateCcw size={12} aria-hidden />
                    Revisit
                  </button>
                  <button
                    type="button"
                    onClick={() => void softRemove(item.key)}
                    disabled={revisit.isPending || remove.isPending}
                    className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg border border-rose-500/20 text-rose-300/80 transition hover:bg-rose-500/10 disabled:opacity-50"
                    aria-label={`Remove anti-pattern ${item.key}`}
                    title="Soft-remove from active library"
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              </div>
            </GlassCard>
          ))}

          {items.length > 5 ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="min-h-[48px] w-full rounded-lg border border-[var(--border-default)] text-[11px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
            >
              {expanded ? "Show fewer" : `Show all ${items.length}`}
            </button>
          ) : null}
        </div>
      )}

      {query.isError ? (
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-xs text-[var(--text-secondary)]"
        >
          <AlertTriangle size={13} aria-hidden />
          Retry library read
        </button>
      ) : null}
      {dialog}
    </section>
  );
}
