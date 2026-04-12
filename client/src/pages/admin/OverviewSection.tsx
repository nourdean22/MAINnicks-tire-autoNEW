/**
 * OverviewSection — CEO command center. Everything at a glance.
 * Top row: 6 stat cards (Cars, Revenue, Jobs, Leads, Health Score, ALG Status)
 * Then: Shop pulse, priority queue, timeline, charts, activity.
 */
import React, { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  StatCard, ActivityIcon, StatusDot, CHART_COLORS, CHART_THEME, BOOKING_STATUS_CONFIG,
  type BookingStatus,
} from "./shared";
import {
  Activity, AlertTriangle, BarChart3, Bell, CalendarClock, CheckCircle2,
  ChevronRight, Clock, ExternalLink, FileSpreadsheet, FileText, Globe, Hash,
  Loader2, MessageSquare, Newspaper, PieChart, Phone, Send, Sparkles, Star,
  TrendingUp, Users, Wrench, XCircle, Zap, Timer, ArrowRight, PhoneCall, RotateCcw,
  Brain, Plug, Shield,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Legend,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "oklch(0.12 0.005 260)",
  border: "1px solid oklch(0.20 0.005 260)",
  borderRadius: "6px",
  fontFamily: "'Roboto Mono', monospace",
  fontSize: 11,
  padding: "8px 12px",
};

// ─── SLA TIMER HELPERS ─────────────────────────────────
function getTimeSince(dateStr: string | Date): { label: string; minutes: number; severity: "green" | "yellow" | "red" } {
  const created = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  let label: string;
  if (mins < 60) label = `${mins}m`;
  else if (hours < 24) label = `${hours}h ${mins % 60}m`;
  else label = `${days}d ${hours % 24}h`;

  // SLA thresholds: green <2h, yellow 2-8h, red >8h
  const severity = mins < 120 ? "green" : mins < 480 ? "yellow" : "red";
  return { label, minutes: mins, severity };
}

function SlaTimer({ dateStr }: { dateStr: string | Date }) {
  const { label, severity } = getTimeSince(dateStr);
  const colors = {
    green: "text-emerald-400 bg-emerald-500/10",
    yellow: "text-amber-400 bg-amber-500/10",
    red: "text-red-400 bg-red-500/10 animate-pulse",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wide ${colors[severity]}`}>
      <Timer className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ─── QUERY RESULT TYPES ───────────────────────────────
interface BookingItem {
  id: number;
  name: string;
  phone?: string | null;
  status: string;
  service?: string;
  vehicle?: string;
  createdAt: string | Date;
  preferredTime?: string;
  preferredDate?: string;
  priority?: string;
  urgency?: string;
  referenceCode?: string;
  adminNotes?: string;
  stage?: string;
  stageUpdatedAt?: string | Date;
}

interface LeadItem {
  id: number;
  name?: string;
  email?: string;
  phone?: string | null;
  status: string;
  source?: string;
  urgencyScore?: number;
  createdAt: string | Date;
}

interface CallbackItem {
  id: number;
  name?: string;
  phone?: string | null;
  status: string;
  reason?: string;
  createdAt: string | Date;
}

interface WorkOrderItem {
  id: number;
  status?: string;
  customerName?: string;
  customerId?: string | number;
  customerPhone?: string | null;
  serviceDescription?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  total?: string | number;
  createdAt: string | Date;
  promisedAt?: string | Date | null;
  blockerType?: string | null;
  assignedTech?: string;
  priority?: string;
}

interface NBAAction {
  type: string;
  urgency: number;
  message: string;
  phone?: string | null;
  actionUrl: string;
}

interface RevenueRecommendation {
  priority: string;
  type: string;
  text: string;
}

interface AtRiskWhale {
  name: string;
  phone?: unknown;
  totalSpent: number;
  visits?: unknown;
  daysSince: unknown;
}

interface ShopFloorData {
  revenueToday: number;
  invoicesToday: number;
  estimatesToday: number;
  avgTicket: number;
  conversionRate: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  invoicesThisWeek: number;
  estimatesThisWeek: number;
  totalCustomers: number;
  vipCustomers: number;
}

// ─── PRIORITY ACTION ITEM TYPE ─────────────────────────
interface ActionItem {
  id: string;
  type: "booking" | "lead" | "callback" | "workOrder";
  name: string;
  detail: string;
  phone?: string | null;
  urgency: number; // 1-5
  createdAt: string | Date;
  status: string;
  isVip?: boolean;
  totalVisits?: number;
  totalRevenue?: number;
}

// ─── WHAT TO DO NOW — Server-Driven Next Best Actions ─────
const NBA_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string; label: string }> = {
  hot_lead: { icon: <Users className="w-3.5 h-3.5" />, color: "text-amber-400", bgColor: "bg-amber-500/10", label: "LEAD" },
  pending_invoice: { icon: <FileText className="w-3.5 h-3.5" />, color: "text-emerald-400", bgColor: "bg-emerald-500/10", label: "INVOICE" },
  callback: { icon: <PhoneCall className="w-3.5 h-3.5" />, color: "text-blue-400", bgColor: "bg-blue-500/10", label: "CALLBACK" },
  vip_winback: { icon: <Star className="w-3.5 h-3.5" />, color: "text-purple-400", bgColor: "bg-purple-500/10", label: "VIP" },
};

const URGENCY_DOTS: Record<number, string> = {
  5: "bg-red-500",
  4: "bg-amber-500",
  3: "bg-yellow-500",
  2: "bg-blue-500",
  1: "bg-foreground/30",
};

function NextBestActions() {
  const { data, isLoading } = trpc.intelligence.nextBestActions.useQuery(undefined, {
    refetchInterval: 30000,
  });

  if (isLoading) return null;
  if (!data?.actions?.length) return null;

  return (
    <div className="bg-card border-2 border-red-500/30 rounded-lg p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-1.5 rounded bg-red-500/15">
          <Zap className="w-4 h-4 text-red-400" />
        </div>
        <h3 className="text-xs font-black tracking-widest text-red-400 uppercase">
          What To Do Now
        </h3>
        <span className="ml-1 text-[10px] bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold">
          {data.actions.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {data.actions.map((action: NBAAction, i: number) => {
          const cfg = NBA_TYPE_CONFIG[action.type] || NBA_TYPE_CONFIG.hot_lead;
          return (
            <div
              key={`${action.type}-${i}`}
              className="flex items-center gap-3 px-3 py-2.5 bg-background/50 border border-border/20 hover:border-primary/30 transition-all group"
            >
              {/* Urgency dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${URGENCY_DOTS[action.urgency] || URGENCY_DOTS[1]} ${action.urgency >= 4 ? "animate-pulse" : ""}`} />

              {/* Type icon */}
              <div className={`shrink-0 ${cfg.color}`}>{cfg.icon}</div>

              {/* Message */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground truncate">{action.message}</span>
                  <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 ${cfg.color} ${cfg.bgColor}`}>
                    {cfg.label}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                {action.phone && (
                  <a
                    href={`tel:${action.phone}`}
                    className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                    title="Call"
                    aria-label="Call customer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                )}
                {action.phone && (
                  <a
                    href={`sms:${action.phone}`}
                    className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded transition-all"
                    title="SMS"
                    aria-label="Send text message"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </a>
                )}
                <Link
                  href={action.actionUrl}
                  className="p-1.5 text-foreground/30 hover:text-primary hover:bg-primary/10 rounded transition-all"
                  title="View"
                  aria-label="View details"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OverviewSection() {
  const { data: stats, isLoading } = trpc.adminDashboard.stats.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: health } = trpc.adminDashboard.siteHealth.useQuery(undefined, {
    refetchInterval: 120000,
  });
  const { data: sheetInfo } = trpc.lead.sheetUrl.useQuery();
  const { data: bridgeStatus } = trpc.nourOsBridge.status.useQuery(undefined, { refetchInterval: 30000 });
  const { data: customerStats } = trpc.customers.stats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, { refetchInterval: 15000 });
  const { data: allBookings } = trpc.booking.list.useQuery(undefined, { refetchInterval: 30000 });
  const { data: allLeads } = trpc.lead.list.useQuery(undefined, { refetchInterval: 30000 });
  const { data: callbacks } = trpc.callback.list.useQuery(undefined, { refetchInterval: 30000 });
  // Nick AI intelligence — shop pulse for real-time awareness
  const { data: shopPulse } = trpc.nickActions.shopPulse.useQuery(undefined, { refetchInterval: 15000 });
  // Shop load indicator — cars in shop, active WOs, today's bookings, wait time
  const { data: shopLoad } = trpc.intelligence.shopLoad.useQuery(undefined, { refetchInterval: 30000 });
  // Work order stats from NOUR OS bridge
  const { data: workOrderStats } = trpc.nourOsBridge.shopFloor.useQuery(undefined, { refetchInterval: 30000 });
  // Active work orders for priority queue (blocked, overdue, urgent)
  const { data: activeWorkOrders } = trpc.workOrders.list.useQuery(
    { limit: 30 },
    { refetchInterval: 30000 },
  );

  // Customer intelligence — spend tiers, churn risk, recommendations
  const { data: custIntel } = trpc.customers.intelligence.useQuery(undefined, { refetchInterval: 300000 });
  // Revenue intelligence
  const { data: revIntel } = trpc.invoices.intelligence.useQuery({ period: "30d" }, { refetchInterval: 120000 });

  // ALG connection status
  const { data: algStatus } = trpc.autoLabor.status.useQuery(undefined, { staleTime: 60_000 });

  // Business health score from master report — expensive, cache 5min
  const { data: masterReport } = trpc.intelligence.masterReport.useQuery(undefined, { staleTime: 300_000, refetchInterval: 300_000 });

  const [actionFilter, setActionFilter] = useState<"all" | "booking" | "lead" | "callback" | "workOrder">("all");

  // Collect phones from queue items for VIP lookup
  const queuePhones = useMemo(() => {
    const phones: string[] = [];
    if (allBookings) allBookings.filter((b: BookingItem) => b.status === "new" && b.phone).forEach((b: BookingItem) => phones.push(b.phone!));
    if (allLeads) allLeads.filter((l: LeadItem) => (l.status === "new" || (l.urgencyScore && l.urgencyScore >= 4)) && l.phone).forEach((l: LeadItem) => phones.push(l.phone!));
    if (callbacks) (callbacks as CallbackItem[]).filter((c: CallbackItem) => (c.status === "new" || c.status === "pending") && c.phone).forEach((c: CallbackItem) => phones.push(c.phone!));
    return [...new Set(phones)].slice(0, 50);
  }, [allBookings, allLeads, callbacks]);

  const { data: vipData } = trpc.customers.vipLookup.useQuery(
    { phones: queuePhones },
    { enabled: queuePhones.length > 0, refetchInterval: 60000 }
  );
  const vipLookup = vipData?.lookup ?? {};

  // Priority action queue — merges unactioned bookings + urgent leads + pending callbacks
  const priorityQueue = useMemo((): ActionItem[] => {
    const items: ActionItem[] = [];

    // New/unconfirmed bookings
    if (allBookings) {
      allBookings
        .filter((b: BookingItem) => b.status === "new")
        .forEach((b: BookingItem) => {
          items.push({
            id: `booking-${b.id}`,
            type: "booking",
            name: b.name || "Unknown",
            detail: `${b.service || "General"} · ${b.preferredTime === "morning" ? "AM" : b.preferredTime === "afternoon" ? "PM" : "Flex"}`,
            phone: b.phone,
            urgency: b.priority === "high" ? 5 : b.priority === "medium" ? 3 : 2,
            createdAt: b.createdAt,
            status: b.status,
          });
        });
    }

    // New/urgent leads
    if (allLeads) {
      allLeads
        .filter((l: LeadItem) => l.status === "new" || (l.urgencyScore && l.urgencyScore >= 4))
        .forEach((l: LeadItem) => {
          items.push({
            id: `lead-${l.id}`,
            type: "lead",
            name: l.name || l.email || "Unknown",
            detail: `${l.source || "Direct"} · Score ${l.urgencyScore || 1}/5`,
            phone: l.phone,
            urgency: l.urgencyScore || 2,
            createdAt: l.createdAt,
            status: l.status,
          });
        });
    }

    // Pending callbacks
    if (callbacks) {
      (callbacks as CallbackItem[])
        .filter((c: CallbackItem) => c.status === "new" || c.status === "pending")
        .forEach((c: CallbackItem) => {
          items.push({
            id: `callback-${c.id}`,
            type: "callback",
            name: c.name || "Unknown",
            detail: `Callback request · ${c.reason || "General inquiry"}`,
            phone: c.phone,
            urgency: 4, // Callbacks are always medium-high priority
            createdAt: c.createdAt,
            status: c.status,
          });
        });
    }

    // Active work orders that need attention (blocked, overdue, or high priority)
    if (activeWorkOrders) {
      (activeWorkOrders as WorkOrderItem[]).forEach((wo: WorkOrderItem) => {
        const isBlocked = !!wo.blockerType;
        const isOverdue = wo.promisedAt && new Date(wo.promisedAt) < new Date();
        const isHighPriority = wo.priority === "urgent" || wo.priority === "high";

        // Only surface work orders that need operator attention
        if (!isBlocked && !isOverdue && !isHighPriority) return;

        const urgency = isOverdue ? 5 : isBlocked ? 4 : isHighPriority ? 3 : 2;
        const flags = [
          isOverdue && "OVERDUE",
          isBlocked && `Blocked: ${wo.blockerType}`,
          wo.assignedTech && `Tech: ${wo.assignedTech}`,
        ].filter(Boolean).join(" · ");

        items.push({
          id: `wo-${wo.id}`,
          type: "workOrder",
          name: wo.customerName || String(wo.customerId ?? "") || "Work Order",
          detail: `${wo.serviceDescription || wo.status?.replace(/_/g, " ") || "Service"}${flags ? ` · ${flags}` : ""}`,
          phone: wo.customerPhone,
          urgency,
          createdAt: wo.createdAt,
          status: wo.status || "unknown",
          totalRevenue: wo.total ? Number(wo.total) : undefined,
        });
      });
    }

    // Enrich with VIP data from customer lookup
    for (const item of items) {
      if (item.phone && vipLookup[item.phone]) {
        const info = vipLookup[item.phone];
        item.isVip = info.isVip;
        item.totalVisits = info.totalVisits;
        item.totalRevenue = item.totalRevenue || info.totalRevenue;
        // VIP customers get urgency boost
        if (info.isVip && item.urgency < 5) item.urgency = Math.min(5, item.urgency + 1);
      }
    }

    // Sort: highest urgency first, then oldest first (longest SLA)
    items.sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return items;
  }, [allBookings, allLeads, callbacks, activeWorkOrders, vipLookup]);

  const filteredQueue = actionFilter === "all" ? priorityQueue : priorityQueue.filter(i => i.type === actionFilter);

  // Today's bookings
  const todaysBookings = useMemo(() => {
    if (!allBookings) return [];
    const today = new Date().toISOString().split("T")[0];
    return allBookings
      .filter((b: BookingItem) => {
        const d = typeof b.createdAt === "string" ? b.createdAt : new Date(b.createdAt).toISOString();
        return b.preferredDate === today || d.startsWith(today);
      })
      .sort((a: BookingItem, b: BookingItem) => {
        const timeOrder: Record<string, number> = { morning: 0, afternoon: 1, "no-preference": 2 };
        return (timeOrder[a.preferredTime || ""] ?? 2) - (timeOrder[b.preferredTime || ""] ?? 2);
      });
  }, [allBookings]);

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
      </div>
    );
  }

  // ─── DERIVED DATA ────────────────────────────────────
  const shopFloor = (stats as typeof stats & { shopFloor?: ShopFloorData }).shopFloor;
  const todayRevenue = shopFloor?.revenueToday ?? shopPulse?.today?.revenue ?? 0;
  const jobsClosed = shopFloor?.invoicesToday ?? shopPulse?.today?.jobsClosed ?? 0;
  const activeLeads = stats.leads.new + stats.leads.contacted;
  const urgentLeads = stats.leads.urgent ?? 0;
  const healthScore = masterReport?.summary?.score ?? null;
  const algConnected = algStatus?.connected ?? null;
  const carsInShop = shopLoad?.activeWOs ?? workOrderStats?.active ?? 0;

  const serviceChartData = stats.bookings.byService.slice(0, 6).map((s, i) => ({
    name: s.service.length > 15 ? s.service.substring(0, 15) + "\u2026" : s.service,
    count: s.count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const leadSourceData = stats.leads.bySource.map((s, i) => ({
    name: s.source.charAt(0).toUpperCase() + s.source.slice(1),
    value: s.count,
    fill: CHART_COLORS[i % CHART_COLORS.length],
  }));

  const leadPipelineData = [
    { name: "New", value: stats.leads.new, fill: CHART_THEME.secondary },
    { name: "Contacted", value: stats.leads.contacted, fill: CHART_THEME.primary },
    { name: "Booked", value: stats.leads.booked, fill: CHART_THEME.tertiary },
    { name: "Closed", value: stats.leads.closed, fill: "#6B7280" },
    { name: "Lost", value: stats.leads.lost, fill: "#EF4444" },
  ].filter(d => d.value > 0);

  const typeIcons: Record<ActionItem["type"], React.ReactNode> = {
    booking: <CalendarClock className="w-3.5 h-3.5 text-blue-400" />,
    lead: <Users className="w-3.5 h-3.5 text-amber-400" />,
    callback: <PhoneCall className="w-3.5 h-3.5 text-emerald-400" />,
    workOrder: <Wrench className="w-3.5 h-3.5 text-primary" />,
  };

  const typeLabels: Record<ActionItem["type"], string> = {
    booking: "BOOKING",
    lead: "LEAD",
    callback: "CALLBACK",
    workOrder: "WORK ORDER",
  };

  const typeBadgeColors: Record<ActionItem["type"], string> = {
    booking: "text-blue-400 bg-blue-500/10",
    lead: "text-amber-400 bg-amber-500/10",
    callback: "text-emerald-400 bg-emerald-500/10",
    workOrder: "text-primary bg-primary/10",
  };

  return (
    <div className="space-y-6">
      {/* ─── TOP ROW: 6 COMMAND STAT CARDS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label="Cars in Shop"
          value={carsInShop}
          icon={<Wrench className="w-4 h-4" />}
          color={carsInShop > 0 ? "text-primary" : "text-muted-foreground"}
          trend={carsInShop > 5 ? "up" : "neutral"}
          trendLabel={shopLoad ? `~${Math.round(shopLoad.estimatedWait / 60)}h wait` : undefined}
        />
        <StatCard
          label="Today's Revenue"
          value={`$${Math.round(todayRevenue).toLocaleString()}`}
          icon={<TrendingUp className="w-4 h-4" />}
          color="text-emerald-400"
          trend={todayRevenue > 0 ? "up" : "neutral"}
          trendLabel={shopFloor ? `$${Math.round(shopFloor.revenueThisWeek).toLocaleString()} this week` : undefined}
        />
        <StatCard
          label="Jobs Closed Today"
          value={jobsClosed}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color={jobsClosed > 0 ? "text-emerald-400" : "text-muted-foreground"}
          trend={jobsClosed > 0 ? "up" : "neutral"}
          trendLabel={shopFloor ? `${shopFloor.invoicesThisWeek} this week` : undefined}
        />
        <StatCard
          label="Website Leads"
          value={activeLeads}
          icon={<Users className="w-4 h-4" />}
          color="text-blue-400"
          trend={urgentLeads > 0 ? "up" : "neutral"}
          trendLabel={urgentLeads > 0 ? `${urgentLeads} urgent` : `${stats.leads.thisWeek} this week`}
        />
        <StatCard
          label="Health Score"
          value={healthScore !== null ? `${healthScore}/100` : "--"}
          icon={<Brain className="w-4 h-4" />}
          color={
            healthScore === null ? "text-muted-foreground" :
            healthScore >= 70 ? "text-emerald-400" :
            healthScore >= 40 ? "text-amber-400" : "text-red-400"
          }
          trend={
            healthScore === null ? "neutral" :
            healthScore >= 70 ? "up" : healthScore >= 40 ? "neutral" : "down"
          }
          trendLabel={
            healthScore === null ? "Loading..." :
            healthScore >= 70 ? "Healthy" : healthScore >= 40 ? "Needs work" : "Critical"
          }
        />
        <StatCard
          label="ALG Status"
          value={algConnected === null ? "--" : algConnected ? "Connected" : "Offline"}
          icon={<Plug className="w-4 h-4" />}
          color={
            algConnected === null ? "text-muted-foreground" :
            algConnected ? "text-emerald-400" : "text-red-400"
          }
          trend={algConnected ? "up" : algConnected === false ? "down" : "neutral"}
          trendLabel={algStatus?.usingFallback ? "Using fallback" : algStatus?.totalLookups ? `${algStatus.totalLookups} lookups` : undefined}
        />
      </div>

      {/* ─── SHOP LOAD INDICATOR ─── */}
      {shopLoad && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground mr-1">SHOP LOAD</span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold">
            <Wrench className="w-3 h-3" />
            {shopLoad.activeWOs} Active WOs
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold">
            <CalendarClock className="w-3 h-3" />
            {shopLoad.todayBookings} Today
          </span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
            shopLoad.estimatedWait > 120 ? "bg-red-500/10 text-red-400" :
            shopLoad.estimatedWait > 60 ? "bg-amber-500/10 text-amber-400" :
            "bg-emerald-500/10 text-emerald-400"
          }`}>
            <Clock className="w-3 h-3" />
            {shopLoad.estimatedWait > 0 ? `~${Math.round(shopLoad.estimatedWait / 60)}h wait` : "No wait"}
          </span>
        </div>
      )}

      {/* ─── WHAT TO DO NOW — Server-Driven Priority Queue ─── */}
      <NextBestActions />

      {/* ─── NICK AI LIVE PULSE ─── */}
      {shopPulse && (
        <div className="bg-card border border-border/30 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">NICK AI LIVE PULSE</span>
            <div className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider ${
              shopPulse.shopStatus === "busy" ? "bg-emerald-500/15 text-emerald-400" :
              shopPulse.shopStatus === "steady" ? "bg-blue-500/15 text-blue-400" :
              shopPulse.shopStatus === "slow" ? "bg-amber-500/15 text-amber-400" :
              "bg-foreground/5 text-muted-foreground"
            }`}>{shopPulse.shopStatus.toUpperCase()}</div>
          </div>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold text-primary revenue-glow">${shopPulse.today.revenue.toLocaleString()}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">TODAY REV</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-emerald-400">{shopPulse.today.jobsClosed}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">JOBS</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-red-400">{shopPulse.today.customersWalked}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">WALKED</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-400">${shopPulse.today.avgTicket}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">AVG TICKET</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${shopPulse.thisWeek.walkRate > 40 ? "text-red-400" : shopPulse.thisWeek.walkRate > 25 ? "text-amber-400" : "text-emerald-400"}`}>{shopPulse.thisWeek.walkRate}%</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">WALK RATE</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-purple-400">${Math.round(shopPulse.thisWeek.revenue).toLocaleString()}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">WEEK REV</div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">{shopPulse.shopInsight}</div>
        </div>
      )}

      {/* ─── ALG SHOP FLOOR DATA — The Real Numbers ─── */}
      {shopFloor && (
        <div className="bg-card border border-emerald-500/20 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">AUTO LABOR GUIDE — SHOP FLOOR</span>
            <span className="ml-auto text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
              {shopFloor.totalCustomers} CUSTOMERS · {shopFloor.vipCustomers} VIP
            </span>
          </div>
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold text-primary">${Math.round(shopFloor.revenueToday).toLocaleString()}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">TODAY REV</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-emerald-400">{shopFloor.invoicesToday}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">INVOICES</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-amber-400">{shopFloor.estimatesToday}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">WALK-INS</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-400">${shopFloor.avgTicket}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">AVG TICKET</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${shopFloor.conversionRate >= 50 ? "text-emerald-400" : shopFloor.conversionRate >= 30 ? "text-amber-400" : "text-red-400"}`}>{shopFloor.conversionRate}%</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">CONVERSION</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-purple-400">${Math.round(shopFloor.revenueThisMonth).toLocaleString()}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">MONTH REV</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            Week: {shopFloor.invoicesThisWeek} invoices · ${Math.round(shopFloor.revenueThisWeek).toLocaleString()} revenue · {shopFloor.estimatesThisWeek} walk-in estimates
          </div>
        </div>
      )}

      {/* ─── WORK ORDERS — Revenue in Motion ─── */}
      {workOrderStats && (workOrderStats.active > 0 || workOrderStats.readyForPickup > 0) && (
        <div className="bg-card border border-primary/20 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Wrench className="w-4 h-4 text-primary" />
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">WORK ORDERS — REVENUE IN MOTION</span>
            {workOrderStats.overdue > 0 && (
              <span className="ml-auto text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 animate-pulse">
                {workOrderStats.overdue} OVERDUE
              </span>
            )}
            {workOrderStats.blocked > 0 && (
              <span className={`${workOrderStats.overdue > 0 ? "" : "ml-auto"} text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400`}>
                {workOrderStats.blocked} BLOCKED
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="text-center">
              <div className="text-lg font-bold text-primary">{workOrderStats.active}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">ACTIVE</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-400">{workOrderStats.inProgress}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">IN PROGRESS</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-amber-400">{workOrderStats.readyForPickup}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">READY PICKUP</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-emerald-400">${Math.round(workOrderStats.totalValueInProgress).toLocaleString()}</div>
              <div className="text-[9px] text-muted-foreground tracking-wider">VALUE IN SHOP</div>
            </div>
            <div className="text-center">
              <div className={`text-lg font-bold ${workOrderStats.overdue > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {workOrderStats.overdue > 0 ? workOrderStats.overdue : "0"}
              </div>
              <div className="text-[9px] text-muted-foreground tracking-wider">OVERDUE</div>
            </div>
          </div>
        </div>
      )}

      {/* ─── SECONDARY METRICS ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Action Queue" value={priorityQueue.length}
          icon={<AlertTriangle className="w-4 h-4" />}
          color={priorityQueue.length > 0 ? "text-red-400" : "text-emerald-400"}
          trend={priorityQueue.length > 0 ? "up" : "neutral"}
          trendLabel={priorityQueue.length > 0 ? "Needs attention" : "All clear"}
        />
        <StatCard
          label="Today's Bookings" value={todaysBookings.length}
          icon={<CalendarClock className="w-4 h-4" />} color="text-foreground"
          trend={todaysBookings.length > 0 ? "up" : "neutral"}
          trendLabel={`${stats.bookings.thisWeek} this week`}
        />
        <StatCard
          label="Chat Sessions" value={stats.chat.totalSessions}
          icon={<MessageSquare className="w-4 h-4" />} color="text-purple-400"
        />
        <StatCard
          label="Callbacks Pending" value={stats.callbacks?.new ?? 0}
          icon={<PhoneCall className="w-4 h-4" />}
          color={(stats.callbacks?.new ?? 0) > 0 ? "text-amber-400" : "text-muted-foreground"}
          trend={(stats.callbacks?.new ?? 0) > 0 ? "up" : "neutral"}
          trendLabel={`${stats.callbacks?.total ?? 0} total`}
        />
        <StatCard
          label="Calls from Site" value={stats.callTracking?.totalCalls ?? 0}
          icon={<Phone className="w-4 h-4" />} color="text-cyan-400"
        />
      </div>

      {/* ─── SMART RECOMMENDATIONS ─── */}
      {revIntel?.recommendations && revIntel.recommendations.length > 0 && (
        <div className="stat-card !p-4 !border-amber-500/20">
          <h3 className="text-[10px] font-bold tracking-wider text-amber-400 uppercase flex items-center gap-2 mb-3">
            <Sparkles className="w-3.5 h-3.5" /> What To Do Now
          </h3>
          <div className="space-y-2">
            {revIntel.recommendations.map((r: RevenueRecommendation, i: number) => (
              <div key={i} className={`flex items-start gap-2 p-2 rounded text-xs ${
                r.priority === "high" ? "bg-red-500/5 border border-red-500/15" : "bg-amber-500/5 border border-amber-500/10"
              }`}>
                <span className={`text-[8px] font-bold uppercase mt-0.5 shrink-0 ${
                  r.type === "revenue" ? "text-emerald-400" : r.type === "risk" ? "text-red-400" : "text-blue-400"
                }`}>{r.type}</span>
                <span className="text-foreground/70 flex-1">{r.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── MASTER INTELLIGENCE SUMMARY ─── */}
      {masterReport?.summary && (
        <div className="bg-card border border-violet-500/20 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Brain className="w-4 h-4 text-violet-400" />
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground">INTELLIGENCE SUMMARY</span>
            <div className={`ml-auto px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wider ${
              masterReport.summary.score >= 70 ? "bg-emerald-500/15 text-emerald-400" :
              masterReport.summary.score >= 40 ? "bg-amber-500/15 text-amber-400" :
              "bg-red-500/15 text-red-400"
            }`}>
              {masterReport.summary.score}/100
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {masterReport.summary.topAlert && (
              <div className="flex items-start gap-2 p-2.5 rounded bg-red-500/5 border border-red-500/15 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[8px] font-bold text-red-400 uppercase mb-0.5">Alert</p>
                  <p className="text-foreground/70">{masterReport.summary.topAlert}</p>
                </div>
              </div>
            )}
            {masterReport.summary.topOpportunity && (
              <div className="flex items-start gap-2 p-2.5 rounded bg-emerald-500/5 border border-emerald-500/15 text-xs">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[8px] font-bold text-emerald-400 uppercase mb-0.5">Opportunity</p>
                  <p className="text-foreground/70">{masterReport.summary.topOpportunity}</p>
                </div>
              </div>
            )}
            {masterReport.summary.topRisk && (
              <div className="flex items-start gap-2 p-2.5 rounded bg-amber-500/5 border border-amber-500/15 text-xs">
                <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[8px] font-bold text-amber-400 uppercase mb-0.5">Risk</p>
                  <p className="text-foreground/70">{masterReport.summary.topRisk}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── CUSTOMER INTELLIGENCE ─── */}
      {custIntel && (
        <div className="stat-card !p-4">
          <h3 className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-2 mb-3">
            <Users className="w-3.5 h-3.5 text-blue-400" /> Customer Intelligence
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
            <div className="text-center p-2 rounded-md bg-primary/5 border border-primary/15">
              <p className="text-xl font-bold text-primary">{custIntel.spendTiers.whales.count}</p>
              <p className="text-[8px] text-muted-foreground mt-0.5">Whales ($2K+)</p>
            </div>
            <div className="text-center p-2 rounded-md bg-blue-500/5 border border-blue-500/15">
              <p className="text-xl font-bold text-blue-400">{custIntel.spendTiers.regulars.count}</p>
              <p className="text-[8px] text-muted-foreground mt-0.5">Regulars</p>
            </div>
            <div className="text-center p-2 rounded-md bg-emerald-500/5 border border-emerald-500/15">
              <p className="text-xl font-bold text-emerald-400">{custIntel.spendTiers.oneTimers.count}</p>
              <p className="text-[8px] text-muted-foreground mt-0.5">One-Timers</p>
            </div>
            <div className="text-center p-2 rounded-md bg-red-500/5 border border-red-500/15">
              <p className="text-xl font-bold text-red-400">{custIntel.churnRisk.atRisk}</p>
              <p className="text-[8px] text-muted-foreground mt-0.5">Churn Risk</p>
            </div>
          </div>
          {custIntel.churnRisk.winbackTargets > 0 && (
            <div className="flex items-center gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/15 text-xs">
              <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-foreground/60">
                <span className="font-bold text-amber-400">{custIntel.churnRisk.winbackTargets}</span> dormant customers ·
                <span className="font-bold text-primary"> ${custIntel.churnRisk.winbackPotential.toLocaleString()}</span> potential revenue
              </span>
            </div>
          )}
          {custIntel.atRiskWhales.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[8px] text-red-400 font-bold uppercase">High-Value Going Quiet</p>
              {custIntel.atRiskWhales.slice(0, 3).map((w: AtRiskWhale, i: number) => (
                <div key={i} className="flex items-center gap-2 py-1 text-[11px]">
                  <span className="text-foreground/80 flex-1">{w.name}</span>
                  <span className="font-bold text-primary">${w.totalSpent.toLocaleString()}</span>
                  <span className="text-red-400 text-[9px] font-mono">{String(w.daysSince)}d</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── PRIORITY ACTION QUEUE ─── */}
      <div className="stat-card !p-5 !border-primary/20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-primary tracking-wide uppercase flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" />
            Priority Action Queue
            {priorityQueue.length > 0 && (
              <span className="ml-1 text-[10px] bg-red-500/15 text-red-400 px-1.5 py-0.5 rounded-full font-bold">
                {priorityQueue.length}
              </span>
            )}
          </h3>
          <div className="flex gap-1">
            {(["all", "booking", "lead", "callback", "workOrder"] as const).map(f => (
              <button
                key={f}
                onClick={() => setActionFilter(f)}
                className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                  actionFilter === f
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {f === "all" ? "All" : f === "workOrder" ? "Work Orders" : f.charAt(0).toUpperCase() + f.slice(1) + "s"}
              </button>
            ))}
          </div>
        </div>

        {filteredQueue.length === 0 ? (
          <div className="flex items-center gap-3 py-6 justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <span className="text-sm text-emerald-400 font-medium">All caught up — no pending actions</span>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {filteredQueue.slice(0, 15).map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2.5 bg-background/50 border border-border/20 hover:border-primary/30 transition-all group"
              >
                {/* Type icon */}
                <div className="shrink-0">{typeIcons[item.type]}</div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">{item.name}</span>
                    <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${typeBadgeColors[item.type]}`}>
                      {typeLabels[item.type]}
                    </span>
                    {item.urgency >= 4 && (
                      <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded text-red-400 bg-red-500/10 animate-pulse">
                        URGENT
                      </span>
                    )}
                    {item.isVip && (
                      <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded text-amber-400 bg-amber-500/10">
                        VIP
                      </span>
                    )}
                    {item.totalRevenue && item.totalRevenue > 500 && (
                      <span className="text-[9px] font-mono text-emerald-400/60">
                        ${item.totalRevenue.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-foreground/50">{item.detail}</span>
                </div>

                {/* SLA Timer */}
                <SlaTimer dateStr={item.createdAt} />

                {/* Quick call action */}
                {item.phone && (
                  <a
                    href={`tel:${item.phone}`}
                    className="shrink-0 p-1.5 text-foreground/20 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                    title={`Call ${item.phone}`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
            {filteredQueue.length > 15 && (
              <p className="text-[11px] text-muted-foreground text-center py-2">
                +{filteredQueue.length - 15} more items
              </p>
            )}
          </div>
        )}
      </div>

      {/* ─── QUICK ACTIONS ─── */}
      <div className="stat-card !p-5">
        <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-primary" />
          Quick Actions
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {[
            { href: "/admin/content", icon: <Sparkles className="w-4 h-4 text-primary" />, label: "AI Content" },
            { onClick: () => toast.info('Navigate to Customers \u2192 Send Next 50'), icon: <Send className="w-4 h-4 text-emerald-400" />, label: "Resume SMS" },
            { href: sheetInfo?.url || '#', external: true, icon: <ExternalLink className="w-4 h-4 text-amber-400" />, label: "CRM Sheet" },
            { href: "/estimate", icon: <TrendingUp className="w-4 h-4 text-cyan-400" />, label: "Estimator" },
            { href: "/booking", icon: <CalendarClock className="w-4 h-4 text-blue-400" />, label: "Book Appt" },
            { href: "/review", icon: <Star className="w-4 h-4 text-yellow-400" />, label: "Reviews" },
            { href: "/specials", icon: <Bell className="w-4 h-4 text-pink-400" />, label: "Specials" },
            { href: "/blog", icon: <Globe className="w-4 h-4 text-purple-400" />, label: "Blog" },
          ].map((action, i) => {
            const cls = "flex flex-col items-center gap-1.5 p-2.5 rounded-md border border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all text-center";
            if (action.onClick) {
              return (
                <button key={i} onClick={action.onClick} className={cls}>
                  {action.icon}
                  <span className="text-[10px] text-muted-foreground font-medium">{action.label}</span>
                </button>
              );
            }
            if (action.external) {
              return (
                <a key={i} href={action.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {action.icon}
                  <span className="text-[10px] text-muted-foreground font-medium">{action.label}</span>
                </a>
              );
            }
            return (
              <Link key={i} href={action.href!} className={cls}>
                {action.icon}
                <span className="text-[10px] text-muted-foreground font-medium">{action.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ─── TODAY'S TIMELINE ─── */}
      <div className="stat-card !p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-primary" />
            Today's Timeline
          </h3>
          {todaysBookings.length > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {todaysBookings.filter((b: BookingItem) => b.status === "completed").length}/{todaysBookings.length} done
            </span>
          )}
        </div>
        {todaysBookings.length === 0 ? (
          <p className="text-sm text-foreground/40 py-4">No bookings scheduled for today.</p>
        ) : (
          <div className="space-y-2">
            {todaysBookings.map((b: BookingItem) => {
              const cfg = BOOKING_STATUS_CONFIG[b.status as BookingStatus] || BOOKING_STATUS_CONFIG.new;
              const isCompleted = b.status === "completed";
              return (
                <div
                  key={b.id}
                  className={`flex items-center gap-3 px-3 py-2.5 border border-border/20 hover:border-primary/30 transition-colors ${
                    isCompleted ? "bg-emerald-500/5 opacity-60" : "bg-background/50"
                  }`}
                >
                  <div className="shrink-0">{cfg.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${isCompleted ? "line-through text-foreground/40" : "text-foreground"}`}>
                        {b.name}
                      </span>
                      <span className={`text-[10px] font-semibold tracking-wider px-1.5 py-0.5 ${cfg.bgColor} ${cfg.color}`}>
                        {cfg.label.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-[11px] text-foreground/50">
                      {b.service}{b.preferredTime ? ` · ${b.preferredTime === "morning" ? "Morning" : b.preferredTime === "afternoon" ? "Afternoon" : "Flex"}` : ""}
                      {b.vehicle ? ` · ${b.vehicle}` : ""}
                    </span>
                  </div>
                  {!isCompleted && <SlaTimer dateStr={b.createdAt} />}
                  {b.phone && (
                    <a href={`tel:${b.phone}`} className="shrink-0 text-foreground/30 hover:text-primary transition-colors">
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── ACTIVE WORK ORDERS ─── */}
      {activeWorkOrders && (activeWorkOrders as WorkOrderItem[]).length > 0 && (
        <div className="stat-card !p-5 !border-primary/15">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase flex items-center gap-2">
              <Wrench className="w-3.5 h-3.5 text-primary" />
              Active Work Orders
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono">
              {(activeWorkOrders as WorkOrderItem[]).filter((wo: WorkOrderItem) => wo.status === "completed" || wo.status === "invoiced").length}/{(activeWorkOrders as WorkOrderItem[]).length} done
            </span>
          </div>
          <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
            {(activeWorkOrders as WorkOrderItem[]).slice(0, 12).map((wo: WorkOrderItem) => {
              const isBlocked = !!wo.blockerType;
              const isOverdue = wo.promisedAt && new Date(wo.promisedAt) < new Date();
              const isDone = wo.status === "completed" || wo.status === "invoiced" || wo.status === "picked_up";
              const statusColor = isDone ? "text-emerald-400 bg-emerald-500/10" :
                isOverdue ? "text-red-400 bg-red-500/10" :
                isBlocked ? "text-amber-400 bg-amber-500/10" :
                wo.status === "in_progress" ? "text-blue-400 bg-blue-500/10" :
                "text-foreground/50 bg-foreground/5";

              return (
                <div
                  key={wo.id}
                  className={`flex items-center gap-3 px-3 py-2.5 border border-border/20 hover:border-primary/30 transition-colors ${
                    isDone ? "bg-emerald-500/5 opacity-60" : "bg-background/50"
                  }`}
                >
                  <Wrench className={`w-3.5 h-3.5 shrink-0 ${isDone ? "text-emerald-400/50" : isOverdue ? "text-red-400" : "text-primary/60"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium truncate ${isDone ? "line-through text-foreground/40" : "text-foreground"}`}>
                        {wo.customerName || wo.customerId || "Customer"}
                      </span>
                      <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusColor}`}>
                        {wo.status?.replace(/_/g, " ").toUpperCase()}
                      </span>
                      {isOverdue && !isDone && (
                        <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded text-red-400 bg-red-500/10 animate-pulse">OVERDUE</span>
                      )}
                      {isBlocked && !isDone && (
                        <span className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded text-amber-400 bg-amber-500/10">BLOCKED</span>
                      )}
                    </div>
                    <span className="text-[11px] text-foreground/50">
                      {wo.serviceDescription || "Service"}
                      {wo.vehicleMake ? ` · ${wo.vehicleMake} ${wo.vehicleModel || ""}` : ""}
                      {wo.total ? ` · $${Number(wo.total).toLocaleString()}` : ""}
                    </span>
                  </div>
                  {!isDone && wo.createdAt && <SlaTimer dateStr={wo.createdAt} />}
                  {wo.customerPhone && (
                    <a href={`tel:${wo.customerPhone}`} className="shrink-0 text-foreground/30 hover:text-primary transition-colors">
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── SMS CAMPAIGN ROI ─── */}
      {campaignStats && campaignStats.total > 0 && (
        <div className="stat-card !border-primary/15 !p-5">
          <h3 className="text-xs font-semibold text-primary tracking-wide uppercase mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            SMS Campaign ROI Estimator
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Texts Sent</span>
              <span className="text-2xl font-bold text-foreground tracking-tight">{campaignStats.sent}</span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Est. Responses (3%)</span>
              <span className="text-2xl font-bold text-blue-400 tracking-tight">{Math.round(campaignStats.sent * 0.03)}</span>
              <span className="text-[10px] text-muted-foreground block">potential customers</span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Avg Ticket Value</span>
              <span className="text-2xl font-bold text-emerald-400 tracking-tight">$350</span>
              <span className="text-[10px] text-muted-foreground block">industry average</span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">Potential Revenue</span>
              <span className="text-2xl font-bold text-primary tracking-tight">${(Math.round(campaignStats.sent * 0.03) * 350).toLocaleString()}</span>
              <span className="text-[10px] text-muted-foreground block">from {campaignStats.sent} texts</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border/20">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex justify-between mb-1.5">
                  <span className="text-[10px] text-muted-foreground">Campaign Progress</span>
                  <span className="text-[10px] font-semibold text-primary">{Math.round((campaignStats.sent / campaignStats.total) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${(campaignStats.sent / campaignStats.total) * 100}%` }} />
                </div>
              </div>
              <span className="text-[11px] text-muted-foreground">{campaignStats.remaining} remaining</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── CHARTS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Service Breakdown */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-5 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            Bookings by Service
          </h3>
          {serviceChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={serviceChartData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fill: "oklch(0.48 0.008 260)", fontSize: 10, fontFamily: "'Roboto Mono', monospace" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "oklch(0.60 0.008 260)", fontSize: 10, fontFamily: "'Roboto Mono', monospace" }} width={110} axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: CHART_THEME.primary }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {serviceChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-muted-foreground">
              <p className="text-sm">No booking data yet</p>
            </div>
          )}
        </div>

        {/* Lead Pipeline */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-5 flex items-center gap-2">
            <PieChart className="w-3.5 h-3.5 text-primary" />
            Lead Pipeline
          </h3>
          {leadPipelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <RPieChart>
                <Pie
                  data={leadPipelineData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {leadPipelineData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  formatter={(value: string) => <span style={{ fontSize: 11, color: "oklch(0.55 0.008 260)", fontFamily: "'Roboto Mono', monospace" }}>{value}</span>}
                />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
              </RPieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[240px] text-muted-foreground">
              <p className="text-sm">No lead data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── BOTTOM ROW: Links + Sources + Activity ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Quick Links */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-primary" />
            Quick Links
          </h3>
          <div className="space-y-1.5">
            {[
              { href: "/admin/content", icon: <Sparkles className="w-4 h-4 text-primary" />, title: "Generate Content", sub: "AI articles & notifications", internal: true },
              ...(sheetInfo?.configured ? [{ href: sheetInfo.url, icon: <FileSpreadsheet className="w-4 h-4 text-emerald-400" />, title: "Open CRM Sheet", sub: "Google Sheets CRM", internal: false }] : []),
              { href: "https://business.google.com/", icon: <Star className="w-4 h-4 text-blue-400" />, title: "Google Business", sub: "Reviews & profile", internal: false },
              { href: "https://search.google.com/search-console", icon: <Globe className="w-4 h-4 text-amber-400" />, title: "Search Console", sub: "Indexing & performance", internal: false },
            ].map((link, i) => {
              const cls = "flex items-center gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors group";
              const content = (
                <>
                  {link.icon}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground">{link.title}</p>
                    <p className="text-[11px] text-muted-foreground">{link.sub}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </>
              );
              if (link.internal) {
                return <Link key={i} href={link.href!} className={cls}>{content}</Link>;
              }
              return <a key={i} href={link.href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>;
            })}
          </div>
        </div>

        {/* Lead Sources */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            Lead Sources
          </h3>
          {leadSourceData.length > 0 ? (
            <div className="space-y-3.5">
              {leadSourceData.map((s, i) => {
                const pct = stats.leads.total > 0 ? Math.round((s.value / stats.leads.total) * 100) : 0;
                return (
                  <div key={s.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-medium text-foreground/70">{s.name}</span>
                      <span className="text-[11px] text-muted-foreground">{s.value} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-3 border-t border-border/20">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Avg Urgency Score</span>
                  <span className="text-lg font-bold text-primary">{stats.leads.avgUrgency}/5</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <p className="text-sm">No lead data yet</p>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-primary" />
            Recent Activity
          </h3>
          {stats.recentActivity.length > 0 ? (
            <div className="space-y-0">
              {stats.recentActivity.slice(0, 8).map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 py-2.5 border-b border-border/10 last:border-0">
                  <div className="mt-0.5 shrink-0">
                    <ActivityIcon type={item.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[12px] font-medium text-foreground truncate">{item.title}</p>
                      {item.status && <StatusDot status={item.status} />}
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                      {new Date(item.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <p className="text-sm">No activity yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── NOUR OS BRIDGE STATUS ─── */}
      {bridgeStatus && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-primary" />
            NOUR OS Bridge
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-emerald-400">{bridgeStatus.totalEventsLocal}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Events Local</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-primary">{bridgeStatus.totalEventsSent}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Events Synced</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-foreground">{bridgeStatus.eventsInMemory}</p>
              <p className="text-[10px] text-muted-foreground mt-1">In Memory</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className={`text-xl font-bold tracking-tight ${bridgeStatus.lastError ? "text-red-400" : "text-emerald-400"}`}>
                {bridgeStatus.lastError ? "Error" : "Healthy"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {bridgeStatus.lastSyncTime
                  ? `Last: ${new Date(bridgeStatus.lastSyncTime).toLocaleTimeString()}`
                  : "No sync yet"}
              </p>
            </div>
          </div>
          {bridgeStatus.lastError && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 text-[11px] text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{bridgeStatus.lastError}</span>
            </div>
          )}
        </div>
      )}

      {/* ─── SITE OVERVIEW ─── */}
      {health && (
        <div className="stat-card !p-5">
          <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-primary" />
            Site Overview
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { value: health.domains.length, label: "Domains", color: "text-foreground" },
              { value: `${health.sitemapPageCount}+`, label: "Sitemap Pages", color: "text-primary" },
              { value: health.totalBlogPosts, label: "Blog Posts", color: "text-foreground" },
              { value: stats.users.total, label: "Users", color: "text-foreground" },
              { value: stats.content.generationLogs, label: "AI Generations", color: "text-emerald-400" },
              { value: health.sheetsConfigured ? "Active" : "Inactive", label: "CRM Sheet", color: health.sheetsConfigured ? "text-emerald-400" : "text-red-400" },
            ].map((item, i) => (
              <div key={i} className="text-center p-3 rounded-md border border-border/30">
                <p className={`text-xl font-bold tracking-tight ${item.color}`}>{item.value}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
