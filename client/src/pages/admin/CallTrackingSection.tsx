/**
 * Call Tracking Section — shows all logged phone click events with source attribution.
 */
import { trpc } from "@/lib/trpc";
import { StatCard, CHART_COLORS } from "./shared";
import { Phone, PhoneCall, MapPin, Loader2, Clock } from "lucide-react";

export default function CallTrackingSection() {
  const { data: stats, isLoading: statsLoading } = trpc.adminDashboard.stats.useQuery();
  const { data: calls, isLoading: callsLoading } = trpc.callTracking.list.useQuery();

  if (statsLoading || callsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const callTracking = stats?.callTracking;

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Calls Tracked"
          value={callTracking?.totalCalls ?? 0}
          icon={<PhoneCall className="w-4 h-4" />}
        />
        <StatCard
          label="This Week"
          value={callTracking?.thisWeek ?? 0}
          icon={<Clock className="w-4 h-4" />}
          trend={(callTracking?.thisWeek ?? 0) > 0 ? "up" : "neutral"}
          trendLabel="phone clicks"
        />
        <StatCard
          label="Callback Requests"
          value={stats?.callbacks?.total ?? 0}
          icon={<Phone className="w-4 h-4" />}
          trendLabel={`${stats?.callbacks?.new ?? 0} pending`}
          trend={(stats?.callbacks?.new ?? 0) > 0 ? "up" : "neutral"}
        />
        <StatCard
          label="Top Source Page"
          value={callTracking?.byPage?.[0]?.page ?? "—"}
          icon={<MapPin className="w-4 h-4" />}
        />
      </div>

      {/* Calls by Page */}
      {callTracking?.byPage && callTracking.byPage.length > 0 && (
        <div className="border border-border/30 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Calls by Page</h3>
          <div className="space-y-3">
            {callTracking.byPage.map((p, i) => {
              const maxCount = callTracking.byPage[0]?.count ?? 1;
              const pct = Math.round((p.count / maxCount) * 100);
              return (
                <div key={p.page}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground/80">{p.page}</span>
                    <span className="text-xs text-muted-foreground">{p.count} calls</span>
                  </div>
                  <div className="h-2 bg-foreground/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Call Event Log */}
      <div className="border border-border/30 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border/20">
          <h3 className="text-sm font-semibold text-foreground">Recent Call Events</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">Every phone number click on the website is logged here with source attribution.</p>
        </div>
        {!calls || calls.length === 0 ? (
          <div className="p-8 text-center">
            <PhoneCall className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No call events yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Phone clicks will appear here as visitors tap the call button on your site.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-foreground/[0.03]">
                  <th className="text-left p-3 font-medium text-muted-foreground">Phone</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Page</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Source</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Medium</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Campaign</th>
                  <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call: any) => (
                  <tr key={call.id} className="border-t border-border/10 hover:bg-foreground/[0.02]">
                    <td className="p-3 font-mono text-foreground">{call.phoneNumber}</td>
                    <td className="p-3 text-foreground/70">{call.sourcePage || "—"}</td>
                    <td className="p-3">
                      {call.utmSource ? (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">{call.utmSource}</span>
                      ) : (
                        <span className="text-foreground/30">direct</span>
                      )}
                    </td>
                    <td className="p-3 text-foreground/70">{call.utmMedium || "—"}</td>
                    <td className="p-3 text-foreground/70">{call.utmCampaign || "—"}</td>
                    <td className="p-3 text-muted-foreground">{new Date(call.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
