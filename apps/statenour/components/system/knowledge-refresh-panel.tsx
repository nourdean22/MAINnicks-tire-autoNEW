"use client";

/**
 * KnowledgeRefreshPanel — the operator's only manual trigger for the
 * 8-subsystem ingest fan-out plus the prompt-cache hot flush.
 *
 * 2026-08-16 · relocated from the retired /knowledge page. It never had
 * anything to do with that page's file browser: it fires
 * `operator.knowledgeRefresh`, which fans out to the /api/cron/* ingest routes
 * (industry RSS, ALG stories, insights, Gmail, Calendar, Drive, knowledge
 * sync, embeddings) and then hot-flushes the prompt cache — see
 * lib/services/knowledge-refresh.ts. Its old host read a filesystem corpus
 * that has not existed since the monorepo import, which made the pairing look
 * intentional: the page showed zero files and offered a "refresh" that could
 * never have produced any.
 *
 * /system/crons is the correct home — it is the cron command deck and already
 * owns manual job triggering (RUN NOW per row). This is the same fan-out at a
 * coarser grain.
 */

import { useState } from "react";
import { Panel } from "@/components/panel";
import { cn } from "@/lib/utils/cn";
import { Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

interface RefreshSubsystem {
  id: string;
  ok: boolean;
  status: number;
  durationMs: number;
  summary: string;
}

export function KnowledgeRefreshPanel() {
  const [results, setResults] = useState<RefreshSubsystem[] | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refreshMutation = trpc.operator.knowledgeRefresh.useMutation();
  const refreshing = refreshMutation.isPending;

  const runRefresh = async () => {
    setRefreshError(null);
    try {
      const json = await refreshMutation.mutateAsync();
      setResults(json.results);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel>
      <div className="flex items-center justify-between mb-2 gap-2">
        {/* <p role="heading"> not <h2> — see contradiction-slot.tsx for the
            unlayered-base.css cascade trap. This markup rode along from the
            retired /knowledge page with the same latent bug. */}
        <p role="heading" aria-level={2} className="text-sm font-semibold text-white flex items-center gap-1">
          <Sparkles className="h-4 w-4" /> Knowledge corpus refresh
        </p>
        <button
          onClick={runRefresh}
          disabled={refreshing}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs font-medium transition min-h-[44px] sm:min-h-[32px]",
            refreshing
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15",
          )}
        >
          {refreshing ? "refreshing…" : "refresh now"}
        </button>
      </div>
      <p className="text-[10px] text-zinc-500 mb-2">
        Pulls fresh data from all sources (Industry RSS, ALG, Insights, Gmail, Calendar, Drive,
        Knowledge sync, Embeddings) and hot-flushes the prompt cache. ~60s total.
      </p>
      {refreshError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-300 mb-2">
          {refreshError}
        </div>
      )}
      {results && (
        <div className="space-y-1">
          {results.map((r) => (
            <div
              key={r.id}
              className={cn(
                "flex items-center justify-between rounded-md border px-2 py-1 text-xs",
                r.ok
                  ? "border-emerald-500/20 bg-emerald-500/[0.03] text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/[0.05] text-rose-200",
              )}
            >
              <span className="font-mono">{r.id}</span>
              <span className="text-[10px] opacity-75 truncate max-w-[55%]">{r.summary}</span>
              <span className="text-[10px] tabular-nums opacity-50">{r.durationMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
