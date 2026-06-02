// ─── ALG PROBE BUDGET PANEL ───────────────────────────────
// Shows demand-driven probe activity. Replaces the "every 5 min cron"
// model that was kicking Moe out of ShopDriver.

import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

export default function AlgProbeBudgetPanel() {
  const utils = trpc.useUtils();
  const { data: probeData } = trpc.shopdriver.recentProbes.useQuery({ limit: 12 }, { staleTime: 30_000 });
  const requestProbe = trpc.shopdriver.requestProbe.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.outcome === "success"
          ? `Probe complete · ${result.recordsProcessed} records`
          : result.outcome === "skipped_recent"
            ? "Skipped — data is already fresh (<5 min)"
            : result.outcome === "dedup"
              ? "Deduped — another probe just fired"
              : `Probe ${result.outcome}`,
      );
      utils.shopdriver.recentProbes.invalidate();
    },
    onError: (err: { message: string }) => toast.error("Probe failed: " + err.message),
  });

  const probes = probeData?.probes ?? [];
  const state = probeData?.state;
  const lastFresh = state?.lastProbeFinishedAt ? new Date(state.lastProbeFinishedAt) : null;
  const ageSec = state?.secondsSinceLastFinish ?? null;

  const outcomeColor: Record<string, string> = {
    success: "text-emerald-400",
    auth_failed: "text-red-400",
    empty: "text-amber-400",
    dedup: "text-foreground/40",
    skipped_recent: "text-foreground/40",
    error: "text-red-400",
  };
  const reasonColor: Record<string, string> = {
    admin_login: "text-blue-400",
    chat_query: "text-purple-400",
    manual_refresh: "text-primary",
    overnight: "text-emerald-400",
    health_check: "text-foreground/50",
  };

  return (
    <div className="bg-card border border-border/30 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-foreground tracking-wide">ALG PROBE BUDGET</h3>
          <p className="text-foreground/50 text-[11px] mt-0.5">
            Demand-driven probe scheduler. Probes only fire on login, chat queries, manual refresh, or 3 AM ET overnight.
          </p>
        </div>
        <button
          onClick={() => requestProbe.mutate({ reason: "manual_refresh" })}
          disabled={requestProbe.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 font-bold text-xs tracking-wide hover:bg-primary/90 disabled:opacity-50"
        >
          {requestProbe.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          REFRESH FROM ALG
        </button>
      </div>

      {/* State summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Last Fresh</p>
          <p className="text-foreground font-medium">{ageSec !== null ? `${Math.round(ageSec / 60)} min ago` : "—"}</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">In Flight</p>
          <p className="text-foreground font-medium">{state?.inFlight ? "Yes" : "No"}</p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Probes (24h)</p>
          <p className="text-foreground font-medium">
            {probes.filter((p: { startedAt: string | Date }) => new Date(p.startedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)).length}
          </p>
        </div>
        <div className="border border-border/20 p-2.5">
          <p className="text-foreground/40 uppercase tracking-wider mb-1">Last Outcome</p>
          <p className={`font-medium ${probes[0] ? (outcomeColor[probes[0].outcome] || "text-foreground") : "text-foreground/40"}`}>
            {probes[0]?.outcome?.toUpperCase() || "—"}
          </p>
        </div>
      </div>

      {/* Recent probes */}
      {probes.length > 0 && (
        <details className="border-t border-border/10 pt-3">
          <summary className="cursor-pointer text-[11px] font-medium tracking-[0.15em] text-foreground/50 hover:text-foreground/80">
            RECENT PROBES · LAST {probes.length}
          </summary>
          <div className="mt-2 space-y-1">
            {probes.map((p: { id: number; reason: string; outcome: string; recordsProcessed: number; durationMs: number; detail: string | null; startedAt: string | Date }) => {
              const date = new Date(p.startedAt);
              const t = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: false });
              const d = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <div key={p.id} className="flex items-center gap-3 text-[11px] py-1 border-b border-border/10">
                  <span className="text-foreground/40 w-24 shrink-0">{d} {t}</span>
                  <span className={`font-medium tracking-[0.12em] w-20 shrink-0 ${reasonColor[p.reason] || "text-foreground/60"}`}>{p.reason.replace("_", " ").toUpperCase()}</span>
                  <span className={`font-medium tracking-[0.12em] w-16 shrink-0 ${outcomeColor[p.outcome] || "text-foreground/60"}`}>{p.outcome.toUpperCase()}</span>
                  <span className="text-foreground/50 w-20 shrink-0">{p.recordsProcessed} rec · {p.durationMs}ms</span>
                  {p.detail && <span className="text-foreground/40 truncate flex-1 italic">{p.detail}</span>}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
