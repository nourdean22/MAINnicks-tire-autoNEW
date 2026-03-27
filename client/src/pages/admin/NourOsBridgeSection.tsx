/**
 * NOUR OS BRIDGE — Sync status, recent events, system health
 * Shows the connection between Nick's Tire and the NOUR OS brain.
 */
import { trpc } from "@/lib/trpc";
import {
  Brain, Activity, CheckCircle2, XCircle, Clock, Zap,
  RefreshCw, Loader2, ArrowUpRight, Server,
} from "lucide-react";

export default function NourOsBridgeSection() {
  const statusQuery = trpc.nourOsBridge.status.useQuery(undefined, { refetchInterval: 30000 });
  const eventsQuery = trpc.nourOsBridge.recentEvents.useQuery({ limit: 20 }, { refetchInterval: 30000 });

  const status = statusQuery.data;
  const events = eventsQuery.data ?? [];
  const isLoading = statusQuery.isLoading;

  const eventTypeLabels: Record<string, { label: string; color: string }> = {
    "nickstire:booking": { label: "Booking", color: "text-blue-400" },
    "nickstire:booking:complete": { label: "Completed", color: "text-emerald-400" },
    "nickstire:lead": { label: "Lead", color: "text-amber-400" },
    "nickstire:tire_order": { label: "Tire Order", color: "text-purple-400" },
    "nickstire:invoice": { label: "Invoice", color: "text-cyan-400" },
    "nickstire:callback": { label: "Callback", color: "text-orange-400" },
    "nickstire:review": { label: "Review", color: "text-yellow-400" },
    "nickstire:revenue": { label: "Revenue", color: "text-emerald-400" },
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/40" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatusCard
          label="Events (Local)"
          value={status?.totalEventsLocal ?? 0}
          icon={<Activity className="w-4 h-4" />}
          color="text-blue-400"
        />
        <StatusCard
          label="Events (Sent)"
          value={status?.totalEventsSent ?? 0}
          icon={<ArrowUpRight className="w-4 h-4" />}
          color="text-emerald-400"
        />
        <StatusCard
          label="In Memory"
          value={status?.eventsInMemory ?? 0}
          icon={<Brain className="w-4 h-4" />}
          color="text-purple-400"
        />
        <StatusCard
          label="Sync Status"
          value={status?.lastError ? "Error" : status?.lastSyncTime ? "OK" : "Idle"}
          icon={status?.lastError ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          color={status?.lastError ? "text-red-400" : "text-emerald-400"}
        />
      </div>

      {/* Connection Info */}
      <div className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4 space-y-3">
        <h3 className="text-sm font-medium text-foreground/60 flex items-center gap-2">
          <Server className="w-4 h-4" /> Connection
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-foreground/40">Local Path:</span>{" "}
            <code className="text-foreground/70 text-xs">{status?.localPath ?? "N/A"}</code>
          </div>
          <div>
            <span className="text-foreground/40">Cloud URL:</span>{" "}
            <code className="text-foreground/70 text-xs">{status?.cloudUrl ?? "N/A"}</code>
          </div>
          <div>
            <span className="text-foreground/40">Last Sync:</span>{" "}
            <span className="text-foreground/70">{status?.lastSyncTime ?? "Never"}</span>
          </div>
          {status?.lastError && (
            <div>
              <span className="text-red-400">Last Error:</span>{" "}
              <span className="text-red-300 text-xs">{status.lastError}</span>
            </div>
          )}
        </div>
      </div>

      {/* Recent Events */}
      <div className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground/60 flex items-center gap-2">
            <Zap className="w-4 h-4" /> Recent Events
          </h3>
          <button
            onClick={() => { statusQuery.refetch(); eventsQuery.refetch(); }}
            className="text-xs text-foreground/40 hover:text-foreground/70 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {events.length === 0 ? (
          <div className="text-center py-8 text-foreground/30">
            <Brain className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No events yet. Events will appear here when bookings, leads, and orders flow through the system.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {events.map((event: any, i: number) => {
              const typeInfo = eventTypeLabels[event.type] ?? { label: event.type, color: "text-foreground/60" };
              return (
                <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-foreground/5 text-sm">
                  <Clock className="w-3.5 h-3.5 text-foreground/30 shrink-0" />
                  <span className="text-foreground/40 text-xs w-36 shrink-0">
                    {event.timestamp?.slice(0, 19).replace("T", " ")}
                  </span>
                  <span className={`font-medium w-24 shrink-0 ${typeInfo.color}`}>{typeInfo.label}</span>
                  <span className="text-foreground/60 truncate">
                    {event.data?.customer || event.data?.customerName || event.data?.service || ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/[0.02] p-4">
      <div className="flex items-center gap-2 text-foreground/40 text-xs mb-2">
        {icon} {label}
      </div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
