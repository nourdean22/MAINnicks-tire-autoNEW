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
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import AdminAlertBar, { type AdminAlert } from "@/components/admin/AdminAlertBar";
import { SkeletonOverview } from "@/components/admin/AdminSkeletons";

// 2026-05-23 · Phase 3 split · SlaTimer + types moved to ./today/.
import { SlaTimer } from "./today/SlaTimer";
// wave-181.x Today Phase 2 · MorningBrief header · 3-line auto-summary
// composed from existing tRPC queries. Renders above the KPI strip so
// the operator's first eye-grab is "what changed overnight" — not
// "what are these numbers."
import { MorningBrief } from "./today/MorningBrief";
// wave-181.x Today Phase 4 · WaveMetricWins tile · surfaces
// closed-loop daily measurements (did shipped work move the needle?).
// Renders only when wave_metrics has ≥1 measurement (clarity-gate ·
// no fake empty state) · placed between Priority Queue + chevron so
// it's above the fold for ops scanning post-shipment lift.
import { WaveMetricWins } from "./today/WaveMetricWins";
// wave-2 money-visibility · "what's at risk before it costs money today" ·
// derives from the same overviewMediumBundle (cache-shared · no new query).
import { MoneyScorecard } from "./today/MoneyScorecard";
import type {
  BookingItem, LeadItem, CallbackItem, WorkOrderItem,
  NBAAction, AtRiskWhale, ShopFloorData, ActionItem,
} from "./today/types";
// lead-source hygiene — a callback-form lead linked to a callback_requests
// row is the SAME person as the callback item pushed below; skip it so the
// queue doesn't list one caller twice. Voice leads (callbackId null) stay.
import { isCallbackDuplicateLead } from "@shared/leadSource";
import { NextBestActions } from "./today/NextBestActions";

export default function OverviewSection() {
  const utils = trpc.useUtils();

  // ─── Priority Action Queue — row mutations ─────────────
  const refetchQueues = () => {
    utils.booking.list.invalidate();
    utils.lead.list.invalidate();
    utils.callback.list.invalidate();
    utils.workOrders.list.invalidate();
    // forensic-audit MEDIUM · the priority queue + today's bookings render from
    // overviewMediumBundle (line ~170), which was never invalidated — so the
    // queue kept showing the acted-on row for up to the bundle's refetchInterval
    // and the operator thought the tap failed. Invalidate it too.
    utils.adminDashboard.overviewMediumBundle.invalidate();
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
        // 2026-05-23 · wave 181.92 moved work-order management under
        // Customers. Rather than toast-stranding the operator, take them
        // there directly with the WO highlighted so they can finish the
        // mark-done flow.
        navigateToAdminSection("customers");
        toast.info(`Marking WO done — finish in Customers section`);
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
        // 2026-05-23 · same as mark-done — navigate to where the WO
        // actually lives rather than dead-end the operator.
        navigateToAdminSection("customers");
        toast.info(`Deleting WO — finish in Customers section`);
        break;
    }
  }
  function handleOpenSection(item: ActionItem) {
    // 2026-05-23 · bookings live on the overview already — dispatching
    // "go to overview" while on overview was a no-op (the user's
    // "nothing happens" complaint). Open the drilldown instead so the
    // tap surfaces actionable detail. Other types navigate to their
    // home section.
    if (item.type === "booking") {
      openDrilldown({ kind: "today_bookings" });
      return;
    }
    const sectionMap: Record<Exclude<ActionItem["type"], "booking">, AdminSection> = {
      lead: "leads",
      callback: "callTrackingView",
      workOrder: "customers",  // work orders live under customers
    };
    const target = sectionMap[item.type];
    navigateToAdminSection(target, { highlightId: item.entityId });
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
          // Skip callback-linked duplicates — the same person is already
          // pushed below as their callback_requests item (canonical).
          if (isCallbackDuplicateLead(l)) return false;
          return l.status === "new" || (l.urgencyScore && l.urgencyScore >= 4);
        })
        .forEach((l: LeadItem) => {
          items.push({
            id: `lead-${l.id}`,
            entityId: l.id,
            type: "lead",
            name: l.name || l.email || "Unknown",
            // Display-only clamp (wave-187 UrgencyBadge precedent) — legacy
            // out-of-range urgencyScores rendered nonsense like "Score 42/5".
            detail: `${l.source || "Direct"} · Score ${Math.min(5, Math.max(1, l.urgencyScore || 1))}/5`,
            phone: l.phone,
            urgency: Math.min(5, Math.max(1, l.urgencyScore || 2)),
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
        message: "ALG (Auto Labor Guide) integration offline. Estimate and customer data may be stale.",
        // wave-187 — ALG connection + sync/probe controls live on ShopDriver HQ,
        // not Integrations (which is just the tire/labor calculator). Match the
        // ALG status pill below (settingsTab=shopdriver) so "Fix" lands operator
        // on the actual reconnect controls.
        href: "/admin?tab=settings&settingsTab=shopdriver",
        ctaLabel: "Fix",
        dismissable: false,
      });
    }
    if (algStatus?.staleDays && algStatus.staleDays > 1) {
      out.push({
        id: "alg-stale",
        severity: "crit",
        message: `ALG (Auto Labor Guide) sync is stale by ${algStatus.staleDays} days. Estimate and customer data may be out of sync.`,
        href: "/admin?tab=settings&settingsTab=shopdriver",
        ctaLabel: "Fix",
        dismissable: false,
      });
    }
    return out;
  }, [algConnectedForAlerts, algStatus]);

  if (isLoading || !stats) {
    return <SkeletonOverview />;
  }

  // ─── DERIVED DATA ────────────────────────────────────
  // ALG mirror — estimate counts + customer data.
  const algFloor = (stats as typeof stats & { shopFloor?: ShopFloorData }).shopFloor;
  const jobsClosed = algFloor?.invoicesToday ?? 0;
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

      {/* wave-181.x Today Phase 2 · Morning Brief header
          3-line auto-summary · "what happened overnight" surface ·
          composed from existing tRPC queries (no new server work).
          Renders ABOVE the KPI strip so the operator's first eye-grab
          is the narrative, not raw numbers. */}
      <MorningBrief
        priorityQueueLength={priorityQueue.length}
        urgentLeads={urgentLeads}
      />

      <MoneyScorecard />

      {/* ─── 4 STAT PILLS · the always-visible scoreboard ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* JOBS CLOSED TODAY */}
        <button
          type="button"
          onClick={() => openDrilldown({ kind: "jobs_closed_today" })}
          className="text-left p-4 bg-card border border-border/40 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors"
          aria-label="Open jobs closed today detail"
        >
          <div className={`text-2xl font-bold tabular-nums ${jobsClosed > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{jobsClosed}</div>
          <div className="text-[10px] text-muted-foreground tracking-wider uppercase mt-1">Jobs Closed</div>
          <div className="text-[10px] text-muted-foreground/70 tracking-wider mt-1">Today</div>
        </button>

        {/* IN SHOP + estimated wait */}
        <button
          type="button"
          onClick={() => openDrilldown({ kind: "cars_in_shop" })}
          className="text-left p-4 bg-card border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-colors"
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
          className="text-left p-4 bg-card border border-border/40 hover:border-red-500/40 hover:bg-red-500/5 transition-colors"
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
          className="text-left p-4 bg-card border border-border/40 hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors"
          aria-label="Open hot leads detail"
        >
          <div className={`text-2xl font-bold tabular-nums ${urgentLeads > 0 ? "text-red-400" : activeLeads > 0 ? "text-blue-400" : "text-muted-foreground"}`}>{activeLeads}</div>
          <div className="text-[10px] text-muted-foreground tracking-wider uppercase mt-1">Hot Leads</div>
          {urgentLeads > 0 && (
            <div className="text-[10px] text-red-400 tracking-wider mt-1">{urgentLeads} urgent</div>
          )}
        </button>
      </div>

      {/* ─── PRIORITY ACTION QUEUE · the action surface ─── */}
      <div id="priority-action-queue" className="stat-card !p-5 !border-primary/20 transition-all">
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
              // 2026-05-23 · whole row is the navigate target (mobile · the
              // icon was a 14px button which is half iOS min touch target).
              // Inner anchors + action buttons stopPropagation so taps on
              // call/sms/done/delete don't ALSO trigger the row navigate.
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => handleOpenSection(item)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenSection(item); } }}
                className="flex items-center gap-3 px-3 py-2.5 bg-background/50 border border-border/20 hover:border-primary/30 transition-all group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={`Open ${item.type}: ${item.name}`}
              >
                <span className="shrink-0">
                  {typeIcons[item.type]}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {item.name}
                    </span>
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
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 text-foreground/40 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                      title={`Call ${item.phone}`}
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {item.phone && (
                    <MessageCustomerLink
                      phone={item.phone}
                      body={`Hi ${item.name.split(" ")[0]}, it's Nick's Tire. Following up on your ${item.type}.`}
                      className="p-1.5 text-foreground/40 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all"
                      title="Open in-admin SMS chat"
                      ariaLabel={`Send SMS to ${item.name}`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </MessageCustomerLink>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleMarkDone(item); }}
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
                    onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
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

      {/* wave-181.x Today Phase 4 · AI Insights strip · hoisted from
          inside the (collapsed) Shop Stats panel to above-the-fold.
          Operator sees the top alert/opportunity/risk WITHOUT having
          to expand the More Detail chevron. Self-hides when no
          insights present (clarity-gate · don't fake empty state). */}
      {masterReport?.summary && (masterReport.summary.topAlert || masterReport.summary.topOpportunity || masterReport.summary.topRisk) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {masterReport.summary.topAlert && (
            <div className="flex items-start gap-2 p-3 rounded bg-red-500/5 border border-red-500/20 text-xs">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-bold text-red-400 uppercase tracking-[0.15em] mb-0.5">Alert</p>
                <p className="text-foreground/75 text-[12px] leading-snug">{masterReport.summary.topAlert}</p>
              </div>
            </div>
          )}
          {masterReport.summary.topOpportunity && (
            <div className="flex items-start gap-2 p-3 rounded bg-emerald-500/5 border border-emerald-500/20 text-xs">
              <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-[0.15em] mb-0.5">Opportunity</p>
                <p className="text-foreground/75 text-[12px] leading-snug">{masterReport.summary.topOpportunity}</p>
              </div>
            </div>
          )}
          {masterReport.summary.topRisk && (
            <div className="flex items-start gap-2 p-3 rounded bg-amber-500/5 border border-amber-500/20 text-xs">
              <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[9px] font-bold text-amber-400 uppercase tracking-[0.15em] mb-0.5">Risk</p>
                <p className="text-foreground/75 text-[12px] leading-snug">{masterReport.summary.topRisk}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* wave-181.x Today Phase 4 · WaveMetricWins tile
          Renders ONLY when closedLoop.recent returns ≥1 measurement.
          Self-hides when wave_metrics is empty (first day after
          framework ship · before any cron has measured). */}
      <WaveMetricWins />

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

              {/* 3 secondary ops stats — invoice/revenue removed (separate register system) */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => openDrilldown({ kind: "jobs_closed_today" })}
                  className="text-left p-2 rounded hover:bg-emerald-500/5 transition-colors"
                >
                  <div className="text-lg font-bold text-emerald-400">{jobsClosed}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Jobs Closed</div>
                </button>
                <button
                  type="button"
                  onClick={() => openDrilldown({ kind: "walk_aways" })}
                  className="text-left p-2 rounded hover:bg-red-500/5 transition-colors"
                >
                  <div className="text-lg font-bold text-red-400">{shopPulse?.today?.customersWalked ?? 0}</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Walked</div>
                </button>
                <button
                  type="button"
                  onClick={() => openDrilldown({ kind: "fresh_leads" })}
                  className={`text-left p-2 rounded transition-colors ${
                    algFloor.conversionRate >= 50 ? "hover:bg-emerald-500/5" :
                    algFloor.conversionRate >= 30 ? "hover:bg-amber-500/5" : "hover:bg-red-500/5"
                  }`}
                  aria-label="Open leads conversion detail"
                >
                  <div className={`text-lg font-bold ${algFloor.conversionRate >= 50 ? "text-emerald-400" : algFloor.conversionRate >= 30 ? "text-amber-400" : "text-red-400"}`}>{algFloor.conversionRate}%</div>
                  <div className="text-[9px] text-muted-foreground tracking-wider uppercase">Conversion</div>
                </button>
              </div>

              {/* Week summary — no revenue numbers (separate register) */}
              <div className="text-[11px] text-muted-foreground pt-2 border-t border-border/15">
                Week: {algFloor.estimatesThisWeek} walk-in est.
              </div>

              {/* wave-181.x Today Phase 4 · AI insights MOVED above-the-fold.
                  They're rendered as a top-level strip between the Priority
                  Queue and the WaveMetricWins tile so the operator sees
                  Alert/Opportunity/Risk without expanding More Detail.
                  Score badge (line ~880) stays here as the Shop Stats
                  health anchor. */}

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
              className="bg-card border border-primary/20 p-4 cursor-pointer hover:ring-1 hover:ring-primary/40 transition-shadow"
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
                <button
                  type="button"
                  onClick={() => navigateToAdminSection("customers")}
                  className="text-center p-2 rounded-md bg-primary/5 border border-primary/15 hover:bg-primary/10 transition-colors"
                  aria-label="Open customers"
                >
                  <p className="text-base font-bold text-primary">{custIntel.spendTiers.whales.count}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Whales ($2K+)</p>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToAdminSection("customers")}
                  className="text-center p-2 rounded-md bg-blue-500/5 border border-blue-500/15 hover:bg-blue-500/10 transition-colors"
                  aria-label="Open customers"
                >
                  <p className="text-base font-bold text-blue-400">{custIntel.spendTiers.regulars.count}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Regulars</p>
                </button>
                <button
                  type="button"
                  onClick={() => navigateToAdminSection("customers")}
                  className="text-center p-2 rounded-md bg-emerald-500/5 border border-emerald-500/15 hover:bg-emerald-500/10 transition-colors"
                  aria-label="Open customers"
                >
                  <p className="text-base font-bold text-emerald-400">{custIntel.spendTiers.oneTimers.count}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">One-Timers</p>
                </button>
                <button
                  type="button"
                  onClick={() => openDrilldown({ kind: "lapsed_vips" })}
                  className="text-center p-2 rounded-md bg-red-500/5 border border-red-500/15 hover:bg-red-500/10 transition-colors"
                  aria-label="Open churn risk detail"
                >
                  <p className="text-base font-bold text-red-400">{custIntel.churnRisk.atRisk}</p>
                  <p className="text-[8px] text-muted-foreground mt-0.5">Churn Risk</p>
                </button>
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
