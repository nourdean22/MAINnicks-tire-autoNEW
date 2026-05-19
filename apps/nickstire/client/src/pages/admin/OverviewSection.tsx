/**
 * OverviewSection — "Today" command surface for the operator.
 *
 * 2026-05-19 rebuild · audit verdict applied.
 * BEFORE: 16 cards · ~1,160 lines of JSX · 16 distinct tRPC queries.
 *         A wall of information, not an action surface.
 * AFTER:  4 stat pills + NBA strip + Priority Queue above the fold.
 *         5 cards (Timeline · Shop Stats · WO detail · Cohort · Activity)
 *         collapse under a "More detail" chevron.
 *
 * Killed entirely: 6-card secondary metrics grid · 8-button Quick Actions ·
 * Active WO list (duplicates queue) · SMS Campaign ROI Estimator (fabricated
 * math) · Bookings-by-Service bar chart · Lead Pipeline donut · Quick Links ·
 * Lead Sources panel · NOUR OS Bridge events card · Site Overview card ·
 * Core Web Vitals panel (already lives in Site Health section).
 *
 * The operator at the bay reads the scoreboard in 1 second, taps the queue
 * to clear an item, and never scrolls.
 */
import React, { useMemo, useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  ActivityIcon, StatusDot, BOOKING_STATUS_CONFIG,
  navigateToAdminSection, openCustomerDrawer,
  type BookingStatus, type AdminSection,
} from "./shared";
import {
  Activity, AlertTriangle, CalendarClock, CheckCircle2,
  ChevronDown, ChevronUp, Clock, FileText,
  MessageSquare, Phone, Star,
  TrendingUp, Users, Wrench, XCircle, Zap, Timer, PhoneCall, RotateCcw,
  Plug, Shield, ChevronRight,
} from "lucide-react";
import { openDrilldown } from "@/components/admin/DrilldownDrawer";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import AdminAlertBar, { type AdminAlert } from "@/components/admin/AdminAlertBar";
import { SkeletonOverview } from "@/components/admin/AdminSkeletons";

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

interface AtRiskWhale {
  id: number;
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
  /** Numeric entity ID — needed to call mutations (mark-done, delete) */
  entityId: number;
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
  vip_winback: { icon: <Star className="w-3.5 h-3.5" />, color: "text-amber-400", bgColor: "bg-amber-500/10", label: "VIP" },
};

// 2026-05-19 · canonical palette · was bg-yellow-500 for urgency 3 ·
// folded into amber (the only warning color in the palette).
const URGENCY_DOTS: Record<number, string> = {
  5: "bg-red-500",
  4: "bg-amber-500",
  3: "bg-amber-400",
  2: "bg-foreground/40",
  1: "bg-foreground/30",
};

function NextBestActions() {
  const { data, isLoading } = trpc.intelligence.nextBestActions.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 25_000, // wave-171: prevent stale=true on every refetch tick
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
              <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
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
  const utils = trpc.useUtils();

  // ─── Priority Action Queue — row mutations ─────────────
  const refetchQueues = () => {
    utils.booking.list.invalidate();
    utils.lead.list.invalidate();
    utils.callback.list.invalidate();
    utils.workOrders.list.invalidate();
  };
  const bookingUpdateStatus = trpc.booking.updateStatus.useMutation({
    onSuccess: () => { toast.success("Booking updated"); refetchQueues(); },
    onError: (e) => toast.error(e.message),
  });
  const bookingDelete = trpc.booking.delete.useMutation({
    onSuccess: () => { toast.success("Booking deleted"); refetchQueues(); },
    onError: (e) => toast.error(e.message),
  });
  const leadUpdate = trpc.lead.update.useMutation({
    onSuccess: () => { toast.success("Lead updated"); refetchQueues(); },
    onError: (e) => toast.error(e.message),
  });
  const leadDelete = trpc.lead.delete.useMutation({
    onSuccess: () => { toast.success("Lead deleted"); refetchQueues(); },
    onError: (e) => toast.error(e.message),
  });
  const callbackUpdateStatus = trpc.callback.updateStatus.useMutation({
    onSuccess: () => { toast.success("Callback updated"); refetchQueues(); },
    onError: (e) => toast.error(e.message),
  });
  async function handleMarkDone(item: ActionItem) {
    const ok = await confirmDialog({
      title: "Mark as done?",
      message: `Mark ${item.type} for ${item.name} as done/contacted.`,
      confirmLabel: "Mark done",
    });
    if (!ok) return;
    switch (item.type) {
      case "booking":
        bookingUpdateStatus.mutate({ id: item.entityId, status: "confirmed" });
        break;
      case "lead":
        leadUpdate.mutate({ id: item.entityId, status: "contacted", contacted: 1 });
        break;
      case "callback":
        callbackUpdateStatus.mutate({ id: item.entityId, status: "completed" });
        break;
      case "workOrder":
        toast.info("Open Work Orders section to manage WO status");
        break;
    }
  }
  async function handleDelete(item: ActionItem) {
    const ok = await confirmDialog({
      title: `Delete ${item.type}?`,
      message: `Remove ${item.type} for ${item.name}. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    switch (item.type) {
      case "booking": bookingDelete.mutate({ id: item.entityId }); break;
      case "lead": leadDelete.mutate({ id: item.entityId }); break;
      case "callback":
        callbackUpdateStatus.mutate({ id: item.entityId, status: "completed" });
        break;
      case "workOrder":
        toast.info("Open Work Orders section to delete WO");
        break;
    }
  }
  function handleOpenSection(item: ActionItem) {
    const sectionMap: Record<ActionItem["type"], AdminSection> = {
      booking: "overview",     // bookings live in overview's queue
      lead: "leads",
      callback: "callTrackingView",
      workOrder: "customers",  // work orders live under customers
    };
    const target = sectionMap[item.type];
    window.dispatchEvent(new CustomEvent("admin:navigate-section", {
      detail: { section: target, highlightId: item.entityId },
    }));
  }

  // ─── DATA HOOKS ─────────────────────────────────────────
  // Backbone bundle · 1 round-trip vs 5 separate queries pre-bundle.
  const { data: bundle, isLoading } = trpc.adminDashboard.overviewMediumBundle.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 25_000,
  });
  const stats = bundle?.stats ?? null;
  const allBookings = bundle?.bookings ?? null;
  const allLeads = bundle?.leads ?? null;
  const callbacks = bundle?.callbacks ?? null;

  // Shop pulse · walked-customers count + shop status badge + insight one-liner.
  const { data: shopPulse } = trpc.nickActions.shopPulse.useQuery(undefined, { refetchInterval: 15000 });
  // Shop load · cars in shop + wait time (drives the IN SHOP pill).
  const { data: shopLoad } = trpc.intelligence.shopLoad.useQuery(undefined, { refetchInterval: 30000, staleTime: 25_000 });
  // WO stats from NOUR OS bridge · drives the Work Orders detail card.
  const { data: workOrderStats } = trpc.nourOsBridge.shopFloor.useQuery(undefined, { refetchInterval: 30000, staleTime: 25_000 });
  // Active WOs · feeds the priority queue's WO source.
  const { data: activeWorkOrders } = trpc.workOrders.list.useQuery(
    { limit: 30 },
    { refetchInterval: 30000 },
  );
  // Customer intelligence · drives the Cohort + At-Risk Whales collapsed card.
  const { data: custIntel } = trpc.customers.intelligence.useQuery(undefined, { refetchInterval: 300000 });
  // ALG connection status · drives the alert bar + pill.
  const { data: algStatus } = trpc.autoLabor.status.useQuery(undefined, { staleTime: 60_000 });
  // Master report · drives the AI insights (Alert/Opportunity/Risk) + Score in collapsed Shop Stats.
  const { data: masterReport } = trpc.intelligence.masterReport.useQuery(undefined, { staleTime: 300_000, refetchInterval: 300_000 });

  const [actionFilter, setActionFilter] = useState<"all" | "booking" | "lead" | "callback" | "workOrder">("all");

  // 2026-05-19 Today rebuild · "More detail" collapse state. Above-fold
  // surface = AlertBar + ALG pill + 4 stat pills + NBA strip + Priority
  // Queue. Everything else (Timeline · Shop Stats · WO detail · Cohort ·
  // Activity) lives below this chevron. Defaults closed on mobile per
  // audit ("the operator's job is to clear the queue, not scroll past
  // intelligence panels"). Persisted to localStorage.
  const [showDetail, setShowDetail] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("nickstire.todayShowDetail") === "1";
  });
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("nickstire.todayShowDetail", showDetail ? "1" : "0");
    }
  }, [showDetail]);

  // Collect phones from queue items for VIP lookup.
  const queuePhones = useMemo(() => {
    const phones: string[] = [];
    if (allBookings) allBookings.filter((b: BookingItem) => b.status === "new" && b.phone).forEach((b: BookingItem) => phones.push(b.phone!));
    if (allLeads) {
      allLeads
        .filter((l: LeadItem) => {
          if (!l.phone) return false;
          if (l.status !== "new" && l.status !== "contacted") return false;
          return l.status === "new" || (l.urgencyScore && l.urgencyScore >= 4);
        })
        .forEach((l: LeadItem) => phones.push(l.phone!));
    }
    if (callbacks) (callbacks as CallbackItem[]).filter((c: CallbackItem) => (c.status === "new" || c.status === "pending") && c.phone).forEach((c: CallbackItem) => phones.push(c.phone!));
    return [...new Set(phones)].slice(0, 50);
  }, [allBookings, allLeads, callbacks]);

  const { data: vipData } = trpc.customers.vipLookup.useQuery(
    { phones: queuePhones },
    { enabled: queuePhones.length > 0, refetchInterval: 60000 }
  );
  const vipLookup = vipData?.lookup ?? {};

  // Priority action queue — merges unactioned bookings + urgent leads + pending callbacks + needs-attention WOs.
  const priorityQueue = useMemo((): ActionItem[] => {
    const items: ActionItem[] = [];

    if (allBookings) {
      allBookings
        .filter((b: BookingItem) => b.status === "new")
        .forEach((b: BookingItem) => {
          items.push({
            id: `booking-${b.id}`,
            entityId: b.id,
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

    const ACTIONABLE_LEAD_STATUS = new Set(["new", "contacted"]);
    if (allLeads) {
      allLeads
        .filter((l: LeadItem) => {
          if (!ACTIONABLE_LEAD_STATUS.has(l.status)) return false;
          return l.status === "new" || (l.urgencyScore && l.urgencyScore >= 4);
        })
        .forEach((l: LeadItem) => {
          items.push({
            id: `lead-${l.id}`,
            entityId: l.id,
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

    if (callbacks) {
      (callbacks as CallbackItem[])
        .filter((c: CallbackItem) => c.status === "new" || c.status === "pending")
        .forEach((c: CallbackItem) => {
          items.push({
            id: `callback-${c.id}`,
            entityId: c.id,
            type: "callback",
            name: c.name || "Unknown",
            detail: `Callback request · ${c.reason || "General inquiry"}`,
            phone: c.phone,
            urgency: 4,
            createdAt: c.createdAt,
            status: c.status,
          });
        });
    }

    if (activeWorkOrders) {
      (activeWorkOrders as WorkOrderItem[]).forEach((wo: WorkOrderItem) => {
        const isBlocked = !!wo.blockerType;
        const isOverdue = wo.promisedAt && new Date(wo.promisedAt) < new Date();
        const isHighPriority = wo.priority === "urgent" || wo.priority === "high";
        if (!isBlocked && !isOverdue && !isHighPriority) return;
        const urgency = isOverdue ? 5 : isBlocked ? 4 : isHighPriority ? 3 : 2;
        const flags = [
          isOverdue && "OVERDUE",
          isBlocked && `Blocked: ${wo.blockerType}`,
          wo.assignedTech && `Tech: ${wo.assignedTech}`,
        ].filter(Boolean).join(" · ");

        items.push({
          id: `wo-${wo.id}`,
          entityId: wo.id,
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

    for (const item of items) {
      if (item.phone && vipLookup[item.phone]) {
        const info = vipLookup[item.phone];
        item.isVip = info.isVip;
        item.totalVisits = info.totalVisits;
        item.totalRevenue = item.totalRevenue || info.totalRevenue;
        if (info.isVip && item.urgency < 5) item.urgency = Math.min(5, item.urgency + 1);
      }
    }

    items.sort((a, b) => {
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return items;
  }, [allBookings, allLeads, callbacks, activeWorkOrders, vipLookup]);

  const filteredQueue = actionFilter === "all" ? priorityQueue : priorityQueue.filter(i => i.type === actionFilter);

  // Today's bookings · for collapsed Timeline card.
  const todayKey = new Date().toISOString().split("T")[0];
  const todaysBookings = useMemo(() => {
    if (!allBookings) return [];
    return allBookings
      .filter((b: BookingItem) => {
        const d = typeof b.createdAt === "string" ? b.createdAt : new Date(b.createdAt).toISOString();
        return b.preferredDate === todayKey || d.startsWith(todayKey);
      })
      .sort((a: BookingItem, b: BookingItem) => {
        const timeOrder: Record<string, number> = { morning: 0, afternoon: 1, "no-preference": 2 };
        return (timeOrder[a.preferredTime || ""] ?? 2) - (timeOrder[b.preferredTime || ""] ?? 2);
      });
  }, [allBookings, todayKey]);

  // Operational alerts · empty when clear. CRITICAL: useMemo MUST be called
  // above the early-return guard below to keep hook order stable.
  const algConnectedForAlerts = algStatus?.connected ?? null;
  const adminAlerts: AdminAlert[] = useMemo(() => {
    const out: AdminAlert[] = [];
    if (algConnectedForAlerts === false) {
      out.push({
        id: "alg-offline",
        severity: "crit",
        message: "ALG (Auto Labor Guide) integration offline. Revenue + invoice numbers are stale.",
        href: "/admin?tab=settings&settingsTab=integrations",
        ctaLabel: "Fix",
        dismissable: false,
      });
    }
    return out;
  }, [algConnectedForAlerts]);

  if (isLoading || !stats) {
    return <SkeletonOverview />;
  }

  // ─── DERIVED DATA ────────────────────────────────────
  // ALG RULES ALL — every money + invoice-count number descends from the
  // ALG mirror. Unit note: admin-stats.ts converts cents → dollars already.
  const algFloor = (stats as typeof stats & { shopFloor?: ShopFloorData }).shopFloor;
  const todayRevenue = algFloor?.revenueToday ?? 0;
  const weekRevenue = algFloor?.revenueThisWeek ?? 0;
  const monthRevenue = algFloor?.revenueThisMonth ?? 0;
  const jobsClosed = algFloor?.invoicesToday ?? 0;
  const weekInvoiceCount = algFloor?.invoicesThisWeek ?? 0;
  const activeLeads = stats.leads.new + stats.leads.contacted;
  const urgentLeads = stats.leads.urgent ?? 0;
  const algConnected = algStatus?.connected ?? null;

  // Prefer shopLoad.activeWOs (strict "physically in shop right now").
  const carsInShop = shopLoad?.activeWOs ?? workOrderStats?.inProgress ?? 0;

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
    <div className="space-y-4">
      {/* Operational alerts · zero-height when clear */}
      <AdminAlertBar alerts={adminAlerts} />

      {/* ALG status pill · small inline · click → fix integrations if offline */}
      <div className="flex items-center justify-end">
        <Link
          href="/admin?tab=settings&settingsTab=shopdriver"
          className={`inline-flex items-center gap-2 text-[11px] font-mono tracking-wider uppercase px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${
            algConnected === null
              ? "border-border/30 text-muted-foreground hover:text-foreground"
              : algConnected
              ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10"
              : "border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20"
          }`}
        >
          <Plug className="w-3 h-3" />
          ALG{" "}
          {algConnected === null
            ? "—"
            : algConnected
            ? algStatus?.usingFallback
              ? "Fallback"
              : algStatus?.totalLookups
              ? `Connected · ${algStatus.totalLookups} lookups`
              : "Connected"
            : "Offline — fix integrations"}
        </Link>
      </div>

      {/* ─── 4 STAT PILLS · the always-visible scoreboard ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* TODAY REV + EOD pace projection */}
        <button
          type="button"
          onClick={() => openDrilldown({ kind: "revenue_today" })}
          className="text-left p-4 rounded-lg bg-card border border-border/40 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors"
          aria-label="Open today's revenue detail"
        >
          <div className="text-2xl font-bold text-primary tabular-nums">${Math.round(todayRevenue).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground tracking-wider uppercase mt-1">Today Rev</div>
          {(() => {
            const now = new Date();
            const startHour = 8;
            const endHour = 18;
            const totalH = endHour - startHour;
            const elapsed = Math.max(0.5, Math.min(totalH, now.getHours() + now.getMinutes() / 60 - startHour));
            if (todayRevenue > 0 && now.getHours() >= startHour && now.getHours() < endHour) {
              const eod = Math.round((todayRevenue / elapsed) * totalH);
              return <div className="text-[10px] text-muted-foreground/70 tracking-wider mt-1">~${eod.toLocaleString()} EOD pace</div>;
            }
            return null;
          })()}
        </button>

        {/* IN SHOP + estimated wait */}
        <button
          type="button"
          onClick={() => openDrilldown({ kind: "cars_in_shop" })}
          className="text-left p-4 rounded-lg bg-card border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-colors"
          aria-label="Open cars in shop detail"
        >
          <div className={`text-2xl font-bold tabular-nums ${carsInShop > 0 ? "text-primary" : "text-muted-foreground"}`}>{carsInShop}</div>
          <div className="text-[10px] text-muted-foreground tracking-wider uppercase mt-1">In Shop</div>
          {shopLoad && shopLoad.estimatedWait > 0 && (
            <div className={`text-[10px] tracking-wider mt-1 ${
              shopLoad.estimatedWait > 120 ? "text-red-400" :
              shopLoad.estimatedWait > 60 ? "text-amber-400" : "text-muted-foreground/70"
            }`}>~{Math.round(shopLoad.estimatedWait / 60)}h wait</div>
          )}
        </button>

        {/* QUEUE · click scrolls to action queue below */}
        <button
          type="button"
          onClick={() => {
            const target = document.getElementById("priority-action-queue");
            if (target) {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
              target.classList.add("ring-2", "ring-primary/60");
              setTimeout(() => target.classList.remove("ring-2", "ring-primary/60"), 1500);
            }
          }}
          className="text-left p-4 rounded-lg bg-card border border-border/40 hover:border-red-500/40 hover:bg-red-500/5 transition-colors"
          aria-label="Scroll to priority action queue"
        >
          <div className={`text-2xl font-bold tabular-nums ${priorityQueue.length > 0 ? "text-red-400" : "text-emerald-400"}`}>{priorityQueue.length}</div>
          <div className="text-[10px] text-muted-foreground tracking-wider uppercase mt-1">Queue</div>
          <div className="text-[10px] text-muted-foreground/70 tracking-wider mt-1">{priorityQueue.length > 0 ? "Needs attention" : "All clear"}</div>
        </button>

        {/* HOT LEADS · urgent breakout */}
        <button
          type="button"
          onClick={() => openDrilldown({ kind: "fresh_leads" })}
          className="text-left p-4 rounded-lg bg-card border border-border/40 hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors"
          aria-label="Open hot leads detail"
        >
          <div className={`text-2xl font-bold tabular-nums ${urgentLeads > 0 ? "text-red-400" : activeLeads > 0 ? "text-blue-400" : "text-muted-foreground"}`}>{activeLeads}</div>
          <div className="text-[10px] text-muted-foreground tracking-wider uppercase mt-1">Hot Leads</div>
          {urgentLeads > 0 && (
            <div className="text-[10px] text-red-400 tracking-wider mt-1">{urgentLeads} urgent</div>
          )}
        </button>
      </div>

      {/* ─── WHAT TO DO NOW · server-ranked NBA strip ─── */}
      <NextBestActions />

      {/* ─── PRIORITY ACTION QUEUE · the action surface ─── */}
      <div id="priority-action-queue" className="stat-card !p-5 !border-primary/20 transition-all rounded-xl">
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
                <button
                  type="button"
                  onClick={() => handleOpenSection(item)}
                  className="shrink-0 cursor-pointer hover:scale-110 transition-transform"
                  title={`Open ${item.type} in ${item.type === "callback" ? "overview" : item.type + "s"} section`}
                >
                  {typeIcons[item.type]}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenSection(item)}
                      className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors text-left cursor-pointer"
                      title="Open in section"
                    >
                      {item.name}
                    </button>
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

                <SlaTimer dateStr={item.createdAt} />

                <div className="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
                  {item.phone && (
                    <a
                      href={`tel:${item.phone}`}
                      className="p-1.5 text-foreground/40 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                      title={`Call ${item.phone}`}
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {item.phone && (
                    <a
                      href={`sms:${item.phone}?body=${encodeURIComponent(
                        `Hi ${item.name.split(" ")[0]}, it's Nick's Tire. Following up on your ${item.type}.`
                      )}`}
                      className="p-1.5 text-foreground/40 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all"
                      title="Send SMS"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => handleMarkDone(item)}
                    disabled={
                      (bookingUpdateStatus.isPending && bookingUpdateStatus.variables?.id === item.entityId) ||
                      (leadUpdate.isPending && leadUpdate.variables?.id === item.entityId) ||
                      (callbackUpdateStatus.isPending && callbackUpdateStatus.variables?.id === item.entityId)
                    }
                    className="p-1.5 text-foreground/40 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all disabled:opacity-30"
                    title="Mark contacted / done"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    disabled={bookingDelete.isPending || leadDelete.isPending || callbackUpdateStatus.isPending}
                    className="p-1.5 text-foreground/40 hover:text-red-400 hover:bg-red-500/10 rounded transition-all disabled:opacity-30"
                    title="Delete / remove from queue"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </button>
                </div>
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

      {/* ─── MORE DETAIL chevron · default closed on mobile ─── */}
      <button
        type="button"
        onClick={() => setShowDetail(s => !s)}
        className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-card border border-border/30 hover:border-border/60 hover:bg-foreground/[0.02] transition-colors text-muted-foreground hover:text-foreground"
        aria-expanded={showDetail}
      >
        {showDetail ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        <span className="text-[12px] font-medium tracking-wider uppercase">
          {showDetail ? "Hide detail" : "More detail"}
        </span>
      </button>

      {showDetail && (
        <div className="space-y-4 pt-2">
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

          {/* ─── SHOP STATS · secondary ops + week/month + AI insights ─── */}
          {algFloor && (
            <div className="stat-card !p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Shop Stats</h3>
                {masterReport?.summary?.score !== undefined && (
                  <div className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider ${
                    masterReport.summary.score >= 70 ? "bg-emerald-500/15 text-emerald-400" :
                    masterReport.summary.score >= 40 ? "bg-amber-500/15 text-amber-400" :
                    "bg-red-500/15 text-red-400"
                  }`}>
                    Score {masterReport.summary.score}/100
                  </div>
                )}
              </div>

              {/* 4 secondary ops stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <button
                  type="button"
                  onClick={() => openDrilldown({ kind: "jobs_closed_today" })}
                  className="text-left p-2 rounded hover:bg-emerald-500/5 transition-colors"
                >
                  <div className="text-lg font-bold text-emerald-400">{jobsClosed}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Invoices</div>
                  <div className="text-[8px] text-muted-foreground/70 tracking-wider mt-0.5">{weekInvoiceCount} wk</div>
                </button>
                <button
                  type="button"
                  onClick={() => openDrilldown({ kind: "walk_aways" })}
                  className="text-left p-2 rounded hover:bg-red-500/5 transition-colors"
                >
                  <div className="text-lg font-bold text-red-400">{shopPulse?.today?.customersWalked ?? 0}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Walked</div>
                </button>
                <div className="p-2">
                  <div className="text-lg font-bold text-blue-400">${algFloor.avgTicket}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Avg Ticket</div>
                </div>
                <div className="p-2">
                  <div className={`text-lg font-bold ${algFloor.conversionRate >= 50 ? "text-emerald-400" : algFloor.conversionRate >= 30 ? "text-amber-400" : "text-red-400"}`}>{algFloor.conversionRate}%</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Conversion</div>
                </div>
              </div>

              {/* Week / Month rollup */}
              <div className="text-[11px] text-muted-foreground pt-2 border-t border-border/15">
                Week: {weekInvoiceCount} invoices · ${Math.round(weekRevenue).toLocaleString()} · {algFloor.estimatesThisWeek} walk-in est. · Month: ${Math.round(monthRevenue).toLocaleString()}
              </div>

              {/* AI insights — Alert / Opportunity / Risk */}
              {masterReport?.summary && (masterReport.summary.topAlert || masterReport.summary.topOpportunity || masterReport.summary.topRisk) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border/15">
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
              )}

              {/* Shop insight one-liner */}
              {shopPulse?.shopInsight && (
                <div className="text-[10px] text-muted-foreground italic pt-2 border-t border-border/15">{shopPulse.shopInsight}</div>
              )}
            </div>
          )}

          {/* ─── WORK ORDERS — Revenue in Motion ─── */}
          {workOrderStats && (workOrderStats.active > 0 || workOrderStats.readyForPickup > 0) && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigateToAdminSection("customers")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigateToAdminSection("customers"); }}
              className="bg-card border border-primary/20 rounded-lg p-4 cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow"
              aria-label="Open customers / work orders"
            >
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

          {/* ─── CUSTOMER COHORT + AT-RISK WHALES ─── */}
          {custIntel && (
            <div className="stat-card !p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">Customer Cohort</h3>
                {algFloor && (
                  <span className="ml-auto text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">
                    {algFloor.totalCustomers} CUST · {algFloor.vipCustomers} VIP
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <div className="text-center p-2 rounded-md bg-primary/5 border border-primary/15">
                  <p className="text-base font-bold text-primary">{custIntel.spendTiers.whales.count}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Whales ($2K+)</p>
                </div>
                <div className="text-center p-2 rounded-md bg-blue-500/5 border border-blue-500/15">
                  <p className="text-base font-bold text-blue-400">{custIntel.spendTiers.regulars.count}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Regulars</p>
                </div>
                <div className="text-center p-2 rounded-md bg-emerald-500/5 border border-emerald-500/15">
                  <p className="text-base font-bold text-emerald-400">{custIntel.spendTiers.oneTimers.count}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">One-Timers</p>
                </div>
                <div className="text-center p-2 rounded-md bg-red-500/5 border border-red-500/15">
                  <p className="text-base font-bold text-red-400">{custIntel.churnRisk.atRisk}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Churn Risk</p>
                </div>
              </div>
              {custIntel.churnRisk.winbackTargets > 0 && (
                <div className="flex items-center gap-2 p-2 rounded bg-amber-500/5 border border-amber-500/15 text-xs">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-foreground/60">
                    <span className="font-bold text-amber-400">{custIntel.churnRisk.winbackTargets}</span> dormant ·
                    <span className="font-bold text-primary"> ${custIntel.churnRisk.winbackPotential.toLocaleString()}</span> winback potential
                  </span>
                </div>
              )}
              {custIntel.atRiskWhales && custIntel.atRiskWhales.length > 0 && (
                <div className="pt-2 border-t border-border/15">
                  <p className="text-[8px] text-red-400 font-bold uppercase mb-1">High-Value Going Quiet</p>
                  {custIntel.atRiskWhales.slice(0, 3).map((w: AtRiskWhale) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => openCustomerDrawer(w.id)}
                      className="w-full flex items-center gap-2 py-0.5 text-[11px] hover:bg-primary/5 rounded px-1 transition-colors text-left"
                      aria-label={`Open customer drawer — ${w.name}`}
                    >
                      <span className="text-foreground/80 flex-1 truncate">{w.name}</span>
                      <span className="font-bold text-primary">${w.totalSpent.toLocaleString()}</span>
                      <span className="text-red-400 text-[9px] font-mono">{String(w.daysSince)}d</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── RECENT ACTIVITY ─── */}
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
      )}
    </div>
  );
}
