/**
 * NOUR OS Bridge — Live connection to the real NOUR OS brain.
 * Shows sync status, work order stats, and recent events pushed to NOUR OS.
 * No localStorage. No fake brain. This page is a window into the real system.
 */
import { trpc } from "@/lib/trpc";
import {
  Zap, ExternalLink, Activity, Wrench, AlertTriangle, CheckCircle2,
  Clock, Loader2, ArrowRight, Wifi, WifiOff, RefreshCw, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "./shared";

const NOUR_OS_URL = "https://autonicks.com/command";
const NOUR_OS_CHAT_URL = "https://autonicks.com/chat";

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function CommandCenterSection() {
  const { data: bridgeStatus, isLoading: bridgeLoading } = trpc.nourOsBridge.status.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const { data: recentEvents, isLoading: eventsLoading } = trpc.nourOsBridge.recentEvents.useQuery(
    { limit: 20 },
    { refetchInterval: 15_000 },
  );
  const { data: shopFloor, isLoading: shopFloorLoading } = trpc.nourOsBridge.shopFloor.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const pushMutation = trpc.nourOsBridge.pushShopFloor.useMutation({
    onSuccess: () => toast.success("Shop floor pushed to NOUR OS"),
    onError: (err) => toast.error(`Push failed: ${err.message}`),
  });

  const isHealthy = bridgeStatus && !bridgeStatus.lastError;

  return (
    <div className="space-y-6">
      {/* ─── NOUR OS LINK BANNER ─── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/15 via-card to-card border border-primary/30 rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary/20 flex items-center justify-center rounded-xl border border-primary/30">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">NOUR OS</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Your real brain lives at autonicks.com — tasks, decisions, loops, strategy.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={NOUR_OS_CHAT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-muted/50 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
            >
              Ask Nick
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href={NOUR_OS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Open NOUR OS
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* ─── BRIDGE SYNC STATUS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Bridge Status"
          value={bridgeLoading ? "..." : isHealthy ? "Healthy" : "Error"}
          icon={isHealthy ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          color={bridgeLoading ? "text-muted-foreground" : isHealthy ? "text-emerald-400" : "text-red-400"}
        />
        <StatCard
          label="Events Synced"
          value={bridgeStatus?.totalEventsSent ?? 0}
          icon={<Activity className="w-4 h-4" />}
          color="text-primary"
          trendLabel={`${bridgeStatus?.eventsInMemory ?? 0} in memory`}
        />
        <StatCard
          label="Last Sync"
          value={bridgeLoading ? "..." : timeAgo(bridgeStatus?.lastSyncTime)}
          icon={<Clock className="w-4 h-4" />}
          color="text-foreground"
        />
        <StatCard
          label="Events Local"
          value={bridgeStatus?.totalEventsLocal ?? 0}
          icon={<BarChart3 className="w-4 h-4" />}
          color="text-blue-400"
        />
      </div>

      {/* ─── WORK ORDER STATS (Shop Floor Snapshot) ─── */}
      {shopFloorLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
        </div>
      ) : shopFloor && (
        <div className="bg-card border border-emerald-500/20 rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
              <Wrench className="w-3.5 h-3.5 text-emerald-400" />
              Work Order Status — Shop Floor
            </h3>
            <button
              onClick={() => pushMutation.mutate()}
              disabled={pushMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold rounded-md transition-colors disabled:opacity-50"
            >
              {pushMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Push to NOUR OS
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-primary">{shopFloor.active}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Active</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-blue-400">{shopFloor.inProgress}</p>
              <p className="text-[10px] text-muted-foreground mt-1">In Progress</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className={`text-xl font-bold tracking-tight ${shopFloor.blocked > 0 ? "text-red-400" : "text-muted-foreground"}`}>{shopFloor.blocked}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Blocked</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className={`text-xl font-bold tracking-tight ${shopFloor.overdue > 0 ? "text-red-400 animate-pulse" : "text-muted-foreground"}`}>{shopFloor.overdue}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Overdue</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-amber-400">{shopFloor.readyForPickup}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Ready for Pickup</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-emerald-400">${Math.round(shopFloor.totalValueInProgress).toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Value In Progress</p>
            </div>
          </div>

          {/* Status breakdown bar */}
          {shopFloor.byStatus && Object.keys(shopFloor.byStatus).length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/20">
              <p className="text-[10px] font-semibold tracking-wider text-muted-foreground mb-2 uppercase">By Status</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(shopFloor.byStatus).map(([status, count]) => (
                  <span
                    key={status}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted/50 border border-border/30 rounded text-[11px] text-foreground/70 font-medium"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
                    {status.replace(/_/g, " ")}
                    <span className="font-bold text-foreground">{count as number}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── BRIDGE ERROR ─── */}
      {bridgeStatus?.lastError && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-red-400 tracking-wider uppercase">Bridge Error</p>
            <p className="text-[12px] text-red-300/80 truncate">{bridgeStatus.lastError}</p>
          </div>
        </div>
      )}

      {/* ─── RECENT EVENTS ─── */}
      <div className="bg-card/50 border border-border/40 rounded-lg p-5">
        <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mb-4 flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-primary" />
          Recent Events Pushed to NOUR OS
        </h3>
        {eventsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
          </div>
        ) : !recentEvents || recentEvents.length === 0 ? (
          <p className="text-sm text-foreground/40 py-6 text-center">No events recorded yet.</p>
        ) : (
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {recentEvents.map((event: any, i: number) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 transition-colors rounded"
              >
                <div className="shrink-0">
                  {event.success !== false ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/60" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400/60" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-foreground truncate">
                      {event.type || event.eventType || "event"}
                    </span>
                    {event.priority && (
                      <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {event.priority}
                      </span>
                    )}
                  </div>
                  {event.data && (
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {typeof event.data === "string" ? event.data : JSON.stringify(event.data).slice(0, 80)}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground/50 font-mono">
                  {event.timestamp ? timeAgo(event.timestamp) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
