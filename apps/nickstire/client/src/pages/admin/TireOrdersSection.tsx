import { useState, useMemo } from "react";
import {
  Disc, Wrench, Truck, Calendar, DollarSign, AlertTriangle, User, Car,
  Check, X, ChevronDown, ChevronUp, RefreshCw, FileText, CheckCircle2,
  Clock, ArrowRight, Loader2, Link
} from "lucide-react";
import {
  Section, Panel, MetricGrid, StatCard, SearchInput, TabBar, FilterChips, StatusDot
} from "./shared";
import {
  formatDate, formatDateTime, formatRelativeDate, formatDollars
} from "./shared/format";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  getQuoteConfidence, getRiskFlags, getNextAction, getFulfillmentTimeline
} from "@shared/tireCommerce";
import GatewayPill from "@/components/admin/GatewayPill";
// 2026-06-10 cockpit consolidation · in-DOM confirm (window.confirm is
// silently suppressed in the iOS PWA) for the cancel-with-refund guard
// ported from the retired Money → Tire Orders tab.
import { confirmDialog } from "@/components/admin/ConfirmDialog";

// Sort rank for getNextAction priorities — most urgent first.
const PRIORITY_RANK: Record<"urgent" | "high" | "normal" | "low", number> = {
  urgent: 0, high: 1, normal: 2, low: 3,
};

type OrderStatusFilter =
  | "all"
  | "received"
  | "confirmed"
  | "ordered"
  | "in_transit"
  | "delivered"
  | "scheduled"
  | "installed"
  | "cancelled";

const STATUS_TABS: { id: OrderStatusFilter; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "All Orders", icon: <Disc className="w-3.5 h-3.5" /> },
  { id: "received", label: "New Requests", icon: <Clock className="w-3.5 h-3.5" /> },
  { id: "confirmed", label: "Confirmed", icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: "ordered", label: "Ordered", icon: <Truck className="w-3.5 h-3.5" /> },
  { id: "in_transit", label: "In Transit", icon: <Truck className="w-3.5 h-3.5" /> },
  { id: "delivered", label: "Delivered", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { id: "scheduled", label: "Scheduled", icon: <Calendar className="w-3.5 h-3.5" /> },
  { id: "installed", label: "Installed", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  { id: "cancelled", label: "Cancelled", icon: <X className="w-3.5 h-3.5" /> },
];

export default function TireOrdersSection() {
  const [activeTab, setActiveTab] = useState<OrderStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">("all");
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // Queries — 60s auto-refresh so the cockpit stays current on the
  // counter screen without manual syncs.
  const { data: listData, isLoading, isError, refetch: refetchOrders } = trpc.gatewayTire.listOrders.useQuery({
    status: activeTab === "all" ? undefined : activeTab,
    search: searchQuery || undefined,
    limit: 100,
  }, { refetchInterval: 60_000 });

  const { data: stats, refetch: refetchStats } = trpc.gatewayTire.orderStats.useQuery(undefined, { refetchInterval: 60_000 });
  const { data: gatewayStatus } = trpc.gatewayTire.status.useQuery();

  // ─── Money-protection surfaces (ported from the retired Money →
  // Tire Orders tab, 2026-06-10 cockpit consolidation) ───────────────
  // Payment-infrastructure health (booleans only) — surfaces the silent
  // half-configured state where Stripe charges succeed but webhook
  // events are dropped. Env changes need a deploy, so 5 min is plenty.
  const { data: health } = trpc.payments.health.useQuery(undefined, {
    refetchInterval: 5 * 60_000,
  });
  // Cancelled-order money risks: paid-but-cancelled (refund owed) and
  // cancelled-with-open-checkout (customer can still pay a dead order).
  const { data: risks } = trpc.gatewayTire.cancellationRisks.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  // Paid orders whose email AND Telegram hand-off both failed — the
  // most urgent thing in the shop when non-empty.
  const { data: backlog } = trpc.nickActions.paymentAlertBacklog.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const resolveAlert = trpc.nickActions.resolvePaymentAlert.useMutation({
    onSuccess: () => { utils.nickActions.paymentAlertBacklog.invalidate(); toast.success("Alert resolved"); },
    onError: (e) => toast.error(`Resolve failed: ${e.message}`),
  });

  const refundOrderMutation = trpc.gatewayTire.refundOrder.useMutation({
    onSuccess: () => {
      toast.success("Refund processed successfully");
      refetchOrders();
      utils.gatewayTire.cancellationRisks.invalidate();
    },
    onError: (err) => {
      toast.error(`Refund failed: ${err.message}`);
    },
  });

  const handleRefund = async (orderId: number, orderNumber: string, customerName: string, amount: number) => {
    const reason = window.prompt(`Enter refund reason for order ${orderNumber} (${customerName}):`, "Customer cancellation");
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error("Refund reason is required");
      return;
    }

    const ok = await confirmDialog({
      title: "Confirm Stripe Refund",
      message: `Are you sure you want to refund $${amount.toFixed(2)} to ${customerName} for order ${orderNumber}? This will issue a real refund in Stripe and update the database status to refunded.`,
      confirmLabel: "Issue Refund",
      tone: "danger",
    });

    if (!ok) return;

    refundOrderMutation.mutate({ orderId, reason });
  };

  // Mutation for updating order fields
  const updateOrderMutation = trpc.gatewayTire.updateOrder.useMutation({
    onSuccess: () => {
      toast.success("Order updated successfully");
      refetchOrders();
      refetchStats();
    },
    onError: (err) => {
      toast.error(`Update failed: ${err.message}`);
    },
  });

  const handleRefresh = () => {
    refetchOrders();
    refetchStats();
  };

  // Filter orders on client for fields not handled by backend query,
  // then sort by next-action priority (urgent first) so the operator's
  // next move is always at the top — a paid order needing a Gateway
  // order must never sit below the fold.
  const filteredOrders = useMemo(() => {
    if (!listData?.orders) return [];
    const filtered = listData.orders.filter((order: any) => {
      // Payment filter
      if (paymentFilter === "paid" && order.paymentStatus !== "paid") return false;
      if (paymentFilter === "unpaid" && order.paymentStatus === "paid") return false;

      // Confidence filter
      if (confidenceFilter !== "all") {
        const conf = getQuoteConfidence(order);
        if (conf.grade !== confidenceFilter) return false;
      }

      return true;
    });
    return [...filtered].sort((a: any, b: any) => {
      const ra = PRIORITY_RANK[getNextAction(a).priority];
      const rb = PRIORITY_RANK[getNextAction(b).priority];
      if (ra !== rb) return ra - rb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [listData, paymentFilter, confidenceFilter]);

  // Priority color borders & text colors
  const getPriorityStyles = (priority: "urgent" | "high" | "normal" | "low") => {
    switch (priority) {
      case "urgent":
        return {
          border: "border-red-500/40 bg-red-500/[0.02]",
          badge: "bg-red-500/10 text-red-400 border-red-500/20",
          glow: "shadow-[0_0_12px_rgba(239,68,68,0.05)]",
        };
      case "high":
        return {
          border: "border-amber-500/30 bg-amber-500/[0.01]",
          badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
          glow: "",
        };
      case "normal":
        return {
          border: "border-border/30",
          badge: "bg-primary/10 text-primary border-primary/20",
          glow: "",
        };
      default:
        return {
          border: "border-border/20",
          badge: "bg-foreground/5 text-foreground/40 border-border/10",
          glow: "",
        };
    }
  };

  const getConfidenceBadgeStyles = (grade: "high" | "medium" | "low") => {
    switch (grade) {
      case "high":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "medium":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default:
        return "bg-red-500/10 text-red-400 border-red-500/20";
    }
  };

  const getRiskFlagLabel = (flag: string): string => {
    return flag
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  };

  const getRiskFlagStyles = (flag: string) => {
    if (["cancelled_or_unavailable", "unpaid_balance", "payment_pending", "manual_supplier_order_required"].includes(flag)) {
      return "bg-red-500/10 text-red-400 border-red-500/20";
    }
    if (["ready_for_install"].includes(flag)) {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    }
    if (["missing_email", "invoice_pending"].includes(flag)) {
      return "bg-foreground/5 text-foreground/50 border-border/20";
    }
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  };

  return (
    <Section
      title="Tire Commerce Command Center"
      subtitle="Online tire orders, Gateway follow-up, payments, and install readiness."
      icon={<Disc className="w-5 h-5 text-primary" />}
      actions={
        <div className="flex items-center gap-3">
          <GatewayPill />
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border/30 hover:border-border/60 text-foreground/60 hover:text-foreground text-xs font-semibold rounded bg-card/50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync
          </button>
        </div>
      }
    >
      {/* ─── Money-protection banners (ported from the retired Money →
          Tire Orders tab). Render ABOVE the metrics: red payment-risk
          warnings must never sit below the fold. Each appears only when
          its condition is real — no duplicate or decorative warnings. ─── */}
      {health?.stripe.halfConfigured && (
        <div className="mb-4 border border-red-500/40 bg-red-500/10 rounded p-3 flex items-start gap-2 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
          <span>
            <strong>Stripe is half-configured:</strong> STRIPE_SECRET_KEY is set but
            STRIPE_WEBHOOK_SECRET is missing — customers CAN pay, but paid events are
            being <strong>dropped</strong> (orders only flip to paid if the customer
            returns to the site). Set STRIPE_WEBHOOK_SECRET on Railway.
          </span>
        </div>
      )}
      {health && !health.stripe.secretKeySet && (
        <div className="mb-4 border border-amber-500/40 bg-amber-500/10 rounded p-3 flex items-start gap-2 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>
            <strong>Online payment is OFF:</strong> STRIPE_SECRET_KEY is not set —
            the customer "Pay Now" button degrades to call-to-pay. Orders still work.
          </span>
        </div>
      )}
      {health && !health.sheetsConfigured && (
        <div className="mb-4 border border-amber-500/40 bg-amber-500/10 rounded p-3 flex items-start gap-2 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>
            <strong>Sheets sync is OFF:</strong> GOOGLE_SHEETS_CRM_ID is not set —
            orders are NOT mirrored to the CRM spreadsheet (this cockpit + the DB
            remain the source of truth).
          </span>
        </div>
      )}
      {backlog && backlog.count > 0 && (
        <div className="mb-4 border border-red-500/40 bg-red-500/10 rounded p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2 text-red-400 font-bold tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            {backlog.count} PAID ORDER{backlog.count === 1 ? "" : "S"} WITH FAILED HAND-OFF — FULFIL MANUALLY
          </div>
          {backlog.items.map((b) => (
            <div key={b.id} className="flex items-start justify-between gap-3 text-foreground/80">
              <span>
                {b.tireOrderNumber ? `${b.tireOrderNumber} - ` : ""}{b.summary}
                <span className="text-foreground/40"> ({b.failureReason})</span>
              </span>
              <button
                onClick={() => resolveAlert.mutate({ id: b.id })}
                disabled={resolveAlert.isPending}
                className="shrink-0 px-2 py-1 border border-red-500/40 rounded text-red-300 text-[10px] font-bold hover:bg-red-500/20 disabled:opacity-50"
              >
                MARK HANDLED
              </button>
            </div>
          ))}
        </div>
      )}
      {risks && risks.refundNeeded.length > 0 && (
        <div className="mb-4 border border-red-500/40 bg-red-500/10 rounded p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2 text-red-400 font-bold tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            {risks.refundNeeded.length} CANCELLED ORDER{risks.refundNeeded.length === 1 ? "" : "S"} PAID ONLINE — AUTO-REFUND AVAILABLE
          </div>
          {risks.refundNeeded.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 text-foreground/80">
              <span>
                {r.orderNumber} - {r.customerName} - ${r.totalAmount.toFixed(2)}
              </span>
              <button
                onClick={() => handleRefund(r.id, r.orderNumber, r.customerName, r.totalAmount)}
                disabled={refundOrderMutation.isPending}
                className="shrink-0 px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-[10px] font-bold disabled:opacity-50 transition-colors"
              >
                AUTO-REFUND
              </button>
            </div>
          ))}
        </div>
      )}
      {risks && risks.staleSessions.length > 0 && (
        <div className="mb-4 border border-amber-500/40 bg-amber-500/10 rounded p-3 space-y-1 text-xs">
          <div className="flex items-center gap-2 text-amber-300 font-bold tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            {risks.staleSessions.length} CANCELLED ORDER{risks.staleSessions.length === 1 ? "" : "S"} WITH AN OPEN CHECKOUT LINK
          </div>
          {risks.staleSessions.map((r) => (
            <div key={r.id} className="text-foreground/80">
              {r.orderNumber} - {r.customerName} — the Stripe checkout page may still be payable (~24h); expire the session in Stripe if in doubt
            </div>
          ))}
        </div>
      )}

      {/* Metric Tiles Grid */}
      <MetricGrid cols={6}>
        <StatCard
          label="New Requests"
          value={stats?.received ?? 0}
          icon={<Clock className="w-4 h-4" />}
          color="text-amber-400"
        />
        <StatCard
          label="Confirmed"
          value={stats?.confirmed ?? 0}
          icon={<Wrench className="w-4 h-4" />}
          color="text-blue-400"
        />
        <StatCard
          label="Ordered/In Transit"
          value={(stats?.ordered ?? 0) + (stats?.inTransit ?? 0)}
          icon={<Truck className="w-4 h-4" />}
          color="text-indigo-400"
        />
        <StatCard
          label="Ready to Install"
          value={(stats?.delivered ?? 0) + (stats?.scheduled ?? 0)}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="text-cyan-400"
        />
        <StatCard
          label="Installed"
          value={stats?.installed ?? 0}
          icon={<CheckCircle2 className="w-4 h-4" />}
          color="text-emerald-400"
        />
        <StatCard
          label="Tire Revenue"
          value={formatDollars(stats?.totalRevenue ?? 0)}
          icon={<DollarSign className="w-4 h-4" />}
          color="text-primary"
        />
      </MetricGrid>

      {/* Tabs / Filter Navigation */}
      <div className="space-y-4">
        <TabBar tabs={STATUS_TABS} activeTab={activeTab} onChange={setActiveTab} variant="pill" size="compact" />

        {/* Query Filters */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by name, phone, order #, size..."
            className="flex-1"
          />

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">Payment:</span>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as any)}
              className="bg-card border border-border/30 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="all">All Payments</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">Confidence:</span>
            <select
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value as any)}
              className="bg-card border border-border/30 rounded px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
            >
              <option value="all">All Confidence</option>
              <option value="high">High Grade</option>
              <option value="medium">Medium Grade</option>
              <option value="low">Low Grade</option>
            </select>
          </div>
        </div>

        {/* Filter Chips */}
        <FilterChips
          chips={[
            { label: "Status", value: activeTab, default: "all", onClear: () => setActiveTab("all") },
            { label: "Payment", value: paymentFilter, default: "all", onClear: () => setPaymentFilter("all") },
            { label: "Confidence", value: confidenceFilter, default: "all", onClear: () => setConfidenceFilter("all") },
          ]}
          onClearAll={() => {
            setActiveTab("all");
            setPaymentFilter("all");
            setConfidenceFilter("all");
          }}
        />

        {/* Orders Listing */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Loading orders...</span>
          </div>
        ) : isError ? (
          <div className="text-center py-20 border border-red-500/20 bg-red-500/[0.02]">
            <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="font-semibold text-red-400 text-sm">Failed to load orders</p>
            <p className="text-xs text-muted-foreground mt-1">Please sync or try again later.</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-20 border border-border/20 bg-card/40">
            <Disc className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-semibold text-foreground/60 text-sm">No tire orders found</p>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting your active filters or query.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order: any) => {
              const isExpanded = expandedOrderId === order.id;
              const confidence = getQuoteConfidence(order);
              const flags = getRiskFlags(order);
              const nextAction = getNextAction(order);
              const priorityStyle = getPriorityStyles(nextAction.priority);

              return (
                <div
                  key={order.id}
                  className={`bg-card border overflow-hidden transition-all duration-200 ${priorityStyle.border} ${priorityStyle.glow}`}
                >
                  {/* Order Card Header */}
                  <div
                    onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer hover:bg-foreground/[0.01] transition-colors"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 border rounded text-[10px] font-bold uppercase tracking-wider ${priorityStyle.badge}`}>
                          {nextAction.priority.toUpperCase()}
                        </span>
                        <span className="text-xs font-semibold text-foreground">{order.orderNumber}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeDate(order.createdAt)}
                        </span>
                        {order.invoiceNumber && (
                          <span className="text-[10px] bg-foreground/5 border border-border/20 px-2 py-0.5 rounded text-muted-foreground">
                            Invoice: {order.invoiceNumber}
                          </span>
                        )}
                        {order.gatewayOrderRef && (
                          <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded text-indigo-400">
                            PO: {order.gatewayOrderRef}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-[13px] font-bold text-foreground flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-foreground/40" />
                          {order.customerName}
                        </h4>
                        {/* tel: link — most next-actions start with "call the
                            customer"; one tap from the counter phone. Stop
                            propagation so dialing doesn't toggle the card. */}
                        <a
                          href={`tel:${order.customerPhone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-primary hover:underline"
                        >
                          ({order.customerPhone})
                        </a>
                        {order.vehicleInfo && (
                          <span className="text-xs text-muted-foreground/80 flex items-center gap-1">
                            <Car className="w-3.5 h-3.5 text-foreground/30" />
                            {order.vehicleInfo}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-foreground/70">
                        {order.quantity}x <span className="font-semibold text-foreground">{order.tireBrand} {order.tireModel}</span> ({order.tireSize})
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end md:self-auto">
                      <div className="text-right">
                        <div className="font-bold text-sm text-foreground">${order.totalAmount.toFixed(2)}</div>
                        <div className="text-[10px] text-muted-foreground">{order.quantity} tires @ ${order.pricePerTire.toFixed(2)}</div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex gap-1.5">
                          {/* Payment status */}
                          <span className={`px-2 py-0.5 text-[10px] font-semibold border rounded ${
                            order.paymentStatus === "paid"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}>
                            {order.paymentStatus === "paid" ? "Paid" : "Unpaid"}
                          </span>

                          {/* Lifecycle status */}
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-foreground/5 border border-border/20 rounded text-foreground/75">
                            {order.statusLabel}
                          </span>
                        </div>

                        {/* Quote confidence */}
                        <span className={`px-2 py-0.5 text-[9px] font-bold border rounded uppercase ${getConfidenceBadgeStyles(confidence.grade)}`}>
                          {confidence.grade} Confidence
                        </span>
                      </div>

                      <div className="p-1 text-foreground/40">
                        {isExpanded ? <ChevronUp className="w-4" /> : <ChevronDown className="w-4" />}
                      </div>
                    </div>
                  </div>

                  {/* Quick summary strip of Next Action */}
                  <div className="border-t border-border/10 px-4 py-2 bg-foreground/[0.015] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-foreground/80">Next Action:</span>
                      <span className="text-primary font-bold">{nextAction.label}</span>
                      <span className="text-muted-foreground/80">— {nextAction.reason}</span>
                    </div>

                    {flags.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {flags.slice(0, 3).map((f) => (
                          <span key={f} className={`px-1.5 py-0.5 text-[9px] font-semibold border rounded ${getRiskFlagStyles(f)}`}>
                            {getRiskFlagLabel(f)}
                          </span>
                        ))}
                        {flags.length > 3 && (
                          <span className="text-[9px] text-muted-foreground font-semibold px-1">+{flags.length - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <div className="border-t border-border/20 p-5 bg-background/25">
                      <OrderFormEdit
                        order={order}
                        updateOrderMutation={updateOrderMutation}
                        nextAction={nextAction}
                        flags={flags}
                        confidence={confidence}
                        handleRefund={handleRefund}
                        refundOrderMutation={refundOrderMutation}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Operating truths — keeps the cockpit honest about what is and
            is NOT automated. */}
        <p className="text-[10px] text-foreground/30 leading-relaxed pt-2">
          The database (this cockpit) is the source of truth — email/Telegram/Sheets
          are copies. Supplier tires are NOT auto-ordered and online payment does NOT
          reserve supplier stock: confirm availability with the customer, order from
          Gateway (b2b.dktire.com), record the PO above, and advance the status.
          Refunds can be processed via the AUTO-REFUND buttons or from the Stripe dashboard.
        </p>
      </div>
    </Section>
  );
}

// Sub-component for rendering the details and update forms
function OrderFormEdit({
  order,
  updateOrderMutation,
  nextAction,
  flags,
  confidence,
  handleRefund,
  refundOrderMutation
}: {
  order: any;
  updateOrderMutation: any;
  nextAction: any;
  flags: string[];
  confidence: any;
  handleRefund: (orderId: number, orderNumber: string, customerName: string, amount: number) => Promise<void>;
  refundOrderMutation: any;
}) {
  const [status, setStatus] = useState<string>(order.status);
  const [adminNotes, setAdminNotes] = useState<string>(order.adminNotes || "");
  const [gatewayOrderRef, setGatewayOrderRef] = useState<string>(order.gatewayOrderRef || "");
  const [expectedDelivery, setExpectedDelivery] = useState<string>(
    order.expectedDelivery ? new Date(order.expectedDelivery).toISOString().substring(0, 16) : ""
  );
  const [installationDate, setInstallationDate] = useState<string>(
    order.installationDate ? new Date(order.installationDate).toISOString().substring(0, 16) : ""
  );

  const timeline = getFulfillmentTimeline(order);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    // Cancel guard (ported from the retired Money tab, 2026-06-10):
    // cancelling is the one transition with money consequences — a PAID
    // order needs a manual Stripe refund (no refund API exists), and an
    // unpaid order may still have a payable checkout link. Confirm
    // in-DOM before saving; window.confirm is suppressed in the PWA.
    if (status === "cancelled" && order.status !== "cancelled") {
      const paid = order.paymentStatus === "paid";
      const ok = await confirmDialog({
        title: "Cancel this order?",
        message: paid
          ? `Customer PAID $${Number(order.totalAmount).toFixed(2)} online. Cancelling does NOT refund them — refund manually in the Stripe dashboard (search ${order.orderNumber}).`
          : `${order.orderNumber} — ${order.customerName}. If a checkout link was issued it may stay payable ~24h; expire it in Stripe if in doubt. This can be undone by setting a new status.`,
        confirmLabel: "Cancel order",
        tone: "danger",
      });
      if (!ok) return;
    }
    updateOrderMutation.mutate({
      id: order.id,
      status: status as any,
      adminNotes: adminNotes || undefined,
      gatewayOrderRef: gatewayOrderRef || undefined,
      expectedDelivery: expectedDelivery || undefined,
      installationDate: installationDate || undefined,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column: Fulfillment Timeline & Alerts */}
      <div className="space-y-5 lg:col-span-1">
        {/* Risk Alerts list */}
        {flags.length > 0 && (
          <Panel title="Risk Flags" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}>
            <div className="space-y-2 mt-1.5">
              {flags.map((f) => (
                <div key={f} className="flex items-start gap-2 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                  <div className="flex-1">
                    <span className="font-semibold text-foreground">{f.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</span>
                    <p className="text-[10px] text-muted-foreground">
                      {f === "uncommon_size" && "Tire size is not commonly stocked in local Cleveland bays."}
                      {f === "unpaid_balance" && "Payment remains uncollected. Complete checkout or counter payment."}
                      {f === "missing_email" && "No customer email provided. Order confirmations can't be auto-sent."}
                      {f === "fitment_needs_confirmation" && "Verify customer vehicle fits tire size before ordering."}
                      {f === "missing_gateway_reference" && "Gateway PO reference is missing for order confirmation."}
                      {f === "manual_supplier_order_required" && "Operator action required: place order manually in Gateway portal."}
                      {f === "ready_for_install" && "Tires are delivered. Confirm appointment schedule with customer."}
                      {f === "payment_pending" && "Installation done or scheduled but balance remains unpaid."}
                      {f === "invoice_pending" && "No invoice number linked to the Sheets ledger."}
                      {f === "unconfirmed_availability" && "Order request is unconfirmed with customer/supplier."}
                      {f === "high_quantity" && "Quantity exceeds standard 4-tire set capacity."}
                      {f === "cancelled_or_unavailable" && "Tire order was cancelled."}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Timeline Visualizer */}
        <Panel title="Fulfillment Timeline" icon={<Disc className="w-4 h-4" />}>
          <div className="relative pl-6 space-y-4 py-2 mt-2">
            {/* Timeline line */}
            <div className="absolute left-2 top-3 bottom-3 w-px bg-border/20" />

            {timeline.map((step, idx) => {
              let dotClass = "bg-muted-foreground/20 text-muted-foreground ring-4 ring-card";
              let textClass = "text-muted-foreground";

              if (step.status === "complete") {
                dotClass = "bg-emerald-500 text-white ring-4 ring-card";
                textClass = "text-foreground font-semibold";
              } else if (step.status === "current") {
                dotClass = "bg-primary text-primary-foreground ring-4 ring-card ring-primary/20 animate-pulse";
                textClass = "text-primary font-bold";
              } else if (step.status === "blocked") {
                dotClass = "bg-red-500 text-white ring-4 ring-card";
                textClass = "text-red-400 font-semibold";
              }

              return (
                <div key={step.key} className="relative flex gap-3 items-start text-xs">
                  {/* Dot */}
                  <div className={`absolute -left-6 top-0.5 w-4.5 h-4.5 rounded-full flex items-center justify-center ${dotClass}`}>
                    {step.status === "complete" ? (
                      <Check className="w-3 h-3" />
                    ) : step.status === "blocked" ? (
                      <X className="w-3 h-3" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-current" />
                    )}
                  </div>
                  <div>
                    <span className={textClass}>{step.label}</span>
                    {step.reason && (
                      <p className="text-[10px] text-red-400/80 font-medium mt-0.5">{step.reason}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Middle/Right Columns: Interactive Form & Context */}
      <form onSubmit={handleSave} className="lg:col-span-2 space-y-5">
        <Panel
          title="Staff Action Card"
          accent={nextAction.priority === "urgent" ? "danger" : nextAction.priority === "high" ? "warning" : "primary"}
          icon={<Wrench className="w-4 h-4" />}
          actions={
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              Confidence Score: {confidence.score}/100
            </span>
          }
        >
          <div className="space-y-3 mt-1">
            <div className="bg-background/40 border border-border/30 rounded p-3 text-xs leading-relaxed space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">Instruction:</span>
                <span className="text-primary font-medium">{nextAction.staffInstruction}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/80">Context: </span>
                {confidence.explanation}
              </p>
            </div>

            {/* Note details */}
            {order.customerNotes && (
              <div className="text-xs bg-foreground/[0.015] border border-border/10 p-2.5 rounded">
                <span className="font-semibold text-foreground">Customer Notes:</span>
                <p className="text-muted-foreground text-[11px] mt-1 whitespace-pre-wrap">{order.customerNotes}</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Update Order Details" icon={<FileText className="w-4 h-4" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Order Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-background border border-border/40 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
              >
                <option value="received">Order Received</option>
                <option value="confirmed">Confirmed</option>
                <option value="ordered">Ordered from Supplier</option>
                <option value="in_transit">In Transit</option>
                <option value="delivered">Delivered to Shop</option>
                <option value="scheduled">Installation Scheduled</option>
                <option value="installed">Installed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            {/* Gateway PO reference */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Gateway PO / Order Ref</label>
              <input
                type="text"
                value={gatewayOrderRef}
                onChange={(e) => setGatewayOrderRef(e.target.value)}
                placeholder="e.g. PO-89025"
                className="bg-background border border-border/40 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50 placeholder:text-foreground/20"
              />
            </div>

            {/* Expected delivery */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Expected Supplier Delivery</label>
              <input
                type="datetime-local"
                value={expectedDelivery}
                onChange={(e) => setExpectedDelivery(e.target.value)}
                className="bg-background border border-border/40 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Installation Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Scheduled Installation Date</label>
              <input
                type="datetime-local"
                value={installationDate}
                onChange={(e) => setInstallationDate(e.target.value)}
                className="bg-background border border-border/40 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Admin notes (full width) */}
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-muted-foreground">Admin Notes (internal only)</label>
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={3}
                placeholder="Add notes about supplier updates, customer calls, or tire tracking details..."
                className="bg-background border border-border/40 rounded px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50 resize-none placeholder:text-foreground/20"
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-border/10">
            <div>
              {order.status === "cancelled" && order.paymentStatus === "paid" && (
                <button
                  type="button"
                  onClick={() => handleRefund(order.id, order.orderNumber, order.customerName, order.totalAmount)}
                  disabled={refundOrderMutation.isPending}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Issue Stripe Refund
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setStatus(order.status);
                  setAdminNotes(order.adminNotes || "");
                  setGatewayOrderRef(order.gatewayOrderRef || "");
                  setExpectedDelivery(order.expectedDelivery ? new Date(order.expectedDelivery).toISOString().substring(0, 16) : "");
                  setInstallationDate(order.installationDate ? new Date(order.installationDate).toISOString().substring(0, 16) : "");
                }}
                className="px-4 py-2 border border-border/30 hover:bg-foreground/5 text-foreground/70 rounded text-xs font-semibold transition-colors"
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={updateOrderMutation.isPending}
                className="flex items-center gap-1.5 bg-primary text-primary-foreground px-5 py-2 rounded text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {updateOrderMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </Panel>
      </form>
    </div>
  );
}
