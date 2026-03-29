/**
 * Activity Feed — real-time view of all shop activity (bookings, leads, SMS, reviews, etc.)
 */
import { trpc } from "@/lib/trpc";
import { Loader2, RefreshCw, CalendarClock, Users, Phone, MessageSquare, Star, Car, Send, Clock } from "lucide-react";

type ActivityItem = {
  id: string;
  type: "booking" | "lead" | "sms" | "review" | "callback" | "estimate";
  title: string;
  detail: string;
  time: Date;
  status?: string;
};

export default function ActivitySection() {
  const { data: stats, isLoading: statsLoading } = trpc.adminDashboard.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: bookings, refetch: refetchBookings } = trpc.booking.list.useQuery();
  const { data: leads } = trpc.lead.list.useQuery();

  // Build unified activity feed from all sources
  const activities: ActivityItem[] = [];

  // Add bookings
  bookings?.forEach(b => {
    activities.push({
      id: `booking-${b.id}`,
      type: "booking",
      title: `${b.name} — ${b.service}`,
      detail: b.vehicle || "Vehicle not specified",
      time: new Date(b.createdAt),
      status: b.status,
    });
  });

  // Add leads
  leads?.forEach(l => {
    activities.push({
      id: `lead-${l.id}`,
      type: "lead",
      title: `${l.name} — ${l.source}`,
      detail: l.problem || l.vehicle || "No details",
      time: new Date(l.createdAt),
      status: l.status,
    });
  });

  // Sort by time, newest first
  activities.sort((a, b) => b.time.getTime() - a.time.getTime());

  const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    booking: { icon: <CalendarClock className="w-4 h-4" />, color: "text-blue-400 bg-blue-500/10", label: "BOOKING" },
    lead: { icon: <Users className="w-4 h-4" />, color: "text-amber-400 bg-amber-500/10", label: "LEAD" },
    sms: { icon: <Send className="w-4 h-4" />, color: "text-emerald-400 bg-emerald-500/10", label: "SMS" },
    review: { icon: <Star className="w-4 h-4" />, color: "text-primary bg-primary/10", label: "REVIEW" },
    callback: { icon: <Phone className="w-4 h-4" />, color: "text-purple-400 bg-purple-500/10", label: "CALLBACK" },
    estimate: { icon: <Car className="w-4 h-4" />, color: "text-cyan-400 bg-cyan-500/10", label: "ESTIMATE" },
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-2xl text-foreground tracking-wider">ACTIVITY FEED</h2>
          <p className="text-foreground/50 text-[12px] mt-1">Real-time view of all shop activity</p>
        </div>
        <button
          onClick={() => { refetchBookings(); }}
          className="flex items-center gap-1.5 bg-foreground/5 border border-border/30 px-3 py-2 text-foreground/50 hover:text-primary hover:border-primary/30 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="font-mono text-[10px]">REFRESH</span>
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Today's Bookings</span>
          <span className="font-bold text-2xl text-blue-400">{stats?.bookings.new ?? 0}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Active Leads</span>
          <span className="font-bold text-2xl text-amber-400">{(stats?.leads.new ?? 0) + (stats?.leads.urgent ?? 0)}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">Chat Sessions</span>
          <span className="font-bold text-2xl text-emerald-400">{stats?.chat?.totalSessions ?? 0}</span>
        </div>
        <div className="bg-card border border-border/30 p-4">
          <span className="font-mono text-[10px] text-foreground/40 tracking-wide block mb-1">This Week</span>
          <span className="font-bold text-2xl text-primary">{stats?.bookings?.thisWeek ?? 0}</span>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm text-foreground tracking-wide mb-6">RECENT ACTIVITY</h3>

        {activities.length === 0 ? (
          <div className="text-center py-12">
            <Clock className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-foreground/40 text-[12px]">No activity yet</p>
          </div>
        ) : (
          <div className="space-y-0">
            {activities.slice(0, 50).map((activity, i) => {
              const config = typeConfig[activity.type] || typeConfig.lead;
              return (
                <div key={activity.id} className="flex gap-4 py-3 border-b border-border/10 last:border-0">
                  {/* Timeline dot */}
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 flex items-center justify-center ${config.color}`}>
                      {config.icon}
                    </div>
                    {i < activities.length - 1 && <div className="w-px flex-1 bg-border/20 mt-1" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] tracking-wider ${config.color} mr-2`}>
                          {config.label}
                        </span>
                        <span className="font-bold text-xs text-foreground tracking-wider">{activity.title}</span>
                      </div>
                      <span className="font-mono text-[10px] text-foreground/30 whitespace-nowrap">{formatTime(activity.time)}</span>
                    </div>
                    <p className="text-foreground/50 text-xs mt-0.5 truncate">{activity.detail}</p>
                    {activity.status && (
                      <span className={`inline-flex items-center mt-1 px-2 py-0.5 text-[9px] tracking-wider border ${
                        activity.status === "new" ? "text-blue-400 bg-blue-500/10 border-blue-500/20" :
                        activity.status === "confirmed" || activity.status === "booked" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                        activity.status === "completed" || activity.status === "closed" ? "text-foreground/40 bg-foreground/5 border-border/30" :
                        "text-amber-400 bg-amber-500/10 border-amber-500/20"
                      }`}>
                        {activity.status.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
