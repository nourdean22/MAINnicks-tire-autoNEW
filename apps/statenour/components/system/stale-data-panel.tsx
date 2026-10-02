"use client";

import { AlertTriangle, Archive, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/panel";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

export function StaleDataPanel() {
  const query = trpc.system.staleData.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const cleanup = trpc.system.purgeStaleData.useMutation();
  const { confirm, dialog } = useConfirmDialog();

  const data = query.data;
  const active = data?.categories.filter((category) => category.count > 0) ?? [];
  const incomplete = (data?.degradedReads.length ?? 0) > 0;

  const cleanCategory = async (category: NonNullable<typeof data>["categories"][number]) => {
    const ok = await confirm({
      title: `Clean ${category.title}?`,
      body: `${category.count} row${category.count === 1 ? "" : "s"} currently match. ${category.purgeAction}. This runs only the existing policy for this category — not a bulk wipe.`,
      confirmLabel: "Apply cleanup",
      cancelLabel: "Keep",
      tone: "danger",
    });
    if (!ok) return;

    try {
      const result = await cleanup.mutateAsync({ category: category.id });
      toast.success("Stale-data cleanup complete", {
        description: result.mode === "single" ? result.result.note : undefined,
      });
      await query.refetch();
    } catch (err) {
      toast.error("Cleanup failed", { description: (err as Error).message });
    }
  };

  return (
    <section id="stale-data" className="scroll-mt-24" aria-label="stale data">
      <Panel className="border-edge-default p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-edge-default pb-4">
          <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-surface border border-edge-default bg-content">
              <Archive size={15} className="text-fg-secondary" aria-hidden />
            </span>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">
                Data hygiene
              </p>
              <h2 className="mt-0.5 text-sm font-semibold text-fg">Stale Data</h2>
              <p className="mt-1 max-w-2xl text-xs text-fg-secondary">
                Rows that still look live after aging out. Review the exact cleanup effect before changing anything.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching || cleanup.isPending}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-control border border-edge-default px-3 text-[11px] text-fg-secondary transition hover:border-edge-strong hover:text-fg disabled:opacity-50"
          >
            <RefreshCw size={12} className={query.isFetching ? "animate-spin" : ""} aria-hidden />
            Rescan
          </button>
        </div>

        {query.isLoading ? (
          <div className="mt-4 space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 w-full rounded-surface" />)}
          </div>
        ) : query.isError ? (
          <div className="mt-4 rounded-surface border border-rose-500/20 bg-rose-500/[0.04] p-4">
            <p className="text-sm text-rose-300">Stale-data scan failed — state unknown, not clean.</p>
          </div>
        ) : data ? (
          <div className="mt-4 space-y-3">
            <div
              className={cn(
                "rounded-surface border px-3 py-2 text-xs",
                incomplete
                  ? "border-amber-500/25 bg-amber-500/[0.04] text-amber-200"
                  : data.totalStaleRows > 0
                    ? "border-rose-500/20 bg-rose-500/[0.03] text-fg-secondary"
                    : "border-emerald-500/20 bg-emerald-500/[0.03] text-emerald-200",
              )}
            >
              {incomplete ? (
                <span className="inline-flex items-start gap-2">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                  Scan incomplete — {data.totalStaleRows} is a floor. Unread categories: {data.degradedReads.join(", ")}.
                </span>
              ) : data.totalStaleRows > 0 ? (
                <span>
                  {data.totalStaleRows} stale row{data.totalStaleRows === 1 ? "" : "s"} across {active.length} active categor{active.length === 1 ? "y" : "ies"}.
                </span>
              ) : (
                <span>Measured clean — no stale rows found across the eight guarded categories.</span>
              )}
            </div>

            {active.map((category) => (
              <div
                key={category.id}
                className="rounded-surface border border-edge-default bg-workspace p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-fg">{category.title}</h3>
                      <span className="rounded-micro border border-amber-500/25 bg-amber-500/[0.04] px-2 py-0.5 text-[11px] font-mono text-amber-300">
                        {category.count} stale
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
                      {category.description}
                    </p>
                    <p className="mt-2 text-[11px] text-fg-tertiary">
                      Cleanup effect · {category.purgeAction}
                    </p>
                    {category.examples.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {category.examples.slice(0, 3).map((example) => (
                          <span
                            key={String(example.id)}
                            className="rounded-micro border border-edge-default px-2 py-1 text-[11px] font-mono text-fg-tertiary"
                            title={example.label}
                          >
                            {example.label.slice(0, 42)} · {example.ageDays}d
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void cleanCategory(category)}
                    disabled={cleanup.isPending}
                    className="min-h-[48px] shrink-0 rounded-control border border-rose-500/25 px-3 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    Apply cleanup
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
      {dialog}
    </section>
  );
}
