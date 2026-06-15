import { useState, useMemo, useRef } from "react";
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
  { id: "all", label: "Active Orders", icon: <Disc className="w-3.5 h-3.5" /> },
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

  const deleteOrderMutation = trpc.gatewayTire.deleteOrder.useMutation({
    onSuccess: () => {
      toast.success("Order deleted successfully");
      refetchOrders();
      refetchStats();
      setExpandedOrderId(null);
    },
    onError: (err) => {
      toast.error(`Delete failed: ${err.message}`);
    },
  });

  const handleDelete = async (orderId: number, orderNumber: string, customerName: string) => {
    const ok = await confirmDialog({
      title: "Delete Tire Order?",
      message: `Are you sure you want to permanently delete order ${orderNumber} for ${customerName}? This action cannot be undone.`,
      confirmLabel: "Delete Order",
      tone: "danger",
    });

    if (!ok) return;

    deleteOrderMutation.mutate({ id: orderId });
  };

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
      // Default view (Active Orders) should hide completed/cancelled orders
      if (activeTab === "all") {
        if (order.status === "cancelled" || order.status === "installed") return false;
      }

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
  }, [listData, activeTab, confidenceFilter]);

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
      {/* Stripe and payment backlog banners removed (separate register) */}

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

          {/* Payment filter dropdown removed */}

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
            { label: "Confidence", value: confidenceFilter, default: "all", onClear: () => setConfidenceFilter("all") },
          ]}
          onClearAll={() => {
            setActiveTab("all");
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
                    className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer hover:bg-foreground/[0.015] transition-colors"
                  >
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 border rounded text-xs font-extrabold uppercase tracking-wider ${priorityStyle.badge}`}>
                          {nextAction.priority.toUpperCase()}
                        </span>
                        <span className="text-sm font-bold text-foreground">{order.orderNumber}</span>
                        <span className="text-xs text-muted-foreground/80">
                          {formatRelativeDate(order.createdAt)}
                        </span>
                        {order.invoiceNumber && (
                          <span className="text-xs bg-foreground/5 border border-border/25 px-2 py-0.5 rounded text-muted-foreground font-semibold">
                            Invoice: {order.invoiceNumber}
                          </span>
                        )}
                        {order.gatewayOrderRef && (
                          <span className="text-xs bg-indigo-500/10 border border-indigo-500/25 px-2 py-0.5 rounded text-indigo-400 font-semibold">
                            PO: {order.gatewayOrderRef}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h4 className="text-base font-extrabold text-foreground flex items-center gap-1.5">
                          <User className="w-4 h-4 text-foreground/40" />
                          {order.customerName}
                        </h4>
                        {/* tel: link — most next-actions start with "call the
                            customer"; one tap from the counter phone. Stop
                            propagation so dialing doesn't toggle the card. */}
                        <a
                          href={`tel:${order.customerPhone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm text-primary hover:underline font-bold"
                        >
                          ({order.customerPhone})
                        </a>
                        {order.vehicleInfo && (
                          <span className="text-sm text-muted-foreground/90 flex items-center gap-1 font-medium">
                            <Car className="w-4 h-4 text-foreground/30" />
                            {order.vehicleInfo}
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-foreground/90 font-medium">
                        {order.quantity}x <span className="font-bold text-foreground">{order.tireBrand} {order.tireModel}</span> ({order.tireSize})
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 self-end md:self-auto">
                      <div className="text-right">
                        <div className="font-extrabold text-base text-foreground">${order.totalAmount.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground/80">{order.quantity} tires @ ${order.pricePerTire.toFixed(2)}</div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          {/* Lifecycle status */}
                          <span className="px-2 py-0.5 text-xs font-bold bg-foreground/5 border border-border/20 rounded text-foreground/75">
                            {order.statusLabel}
                          </span>

                          {/* Quick Delete */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(order.id, order.orderNumber, order.customerName);
                            }}
                            disabled={deleteOrderMutation.isPending}
                            className="px-2 py-0.5 text-[10px] font-extrabold border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 text-red-400 rounded transition-all cursor-pointer select-none active:scale-95 flex items-center gap-1"
                            title="Delete Order"
                          >
                            {deleteOrderMutation.isPending && deleteOrderMutation.variables?.id === order.id ? (
                              <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <X className="w-2.5 h-2.5" />
                            )}
                            Delete
                          </button>
                        </div>

                        {/* Quote confidence */}
                        <span className={`px-2 py-0.5 text-xs font-bold border rounded uppercase ${getConfidenceBadgeStyles(confidence.grade)}`}>
                          {confidence.grade} Confidence
                        </span>
                      </div>

                      <div className="p-1 text-foreground/40">
                        {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </div>
                    </div>
                  </div>

                  {/* Quick summary strip of Next Action */}
                  <div
                    onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    className="border-t border-border/10 px-4 py-2 bg-foreground/[0.015] flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-foreground/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold text-foreground/80">Next Action:</span>
                      <span className="text-primary font-extrabold">{nextAction.label}</span>
                      <span className="text-muted-foreground/95">— {nextAction.reason}</span>
                    </div>

                    {flags.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {flags.slice(0, 3).map((f) => (
                          <span key={f} className={`px-1.5 py-0.5 text-xs font-semibold border rounded ${getRiskFlagStyles(f)}`}>
                            {getRiskFlagLabel(f)}
                          </span>
                        ))}
                        {flags.length > 3 && (
                          <span className="text-xs text-muted-foreground font-semibold px-1">+{flags.length - 3} more</span>
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
                        handleDelete={handleDelete}
                        deleteOrderMutation={deleteOrderMutation}
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
  handleDelete,
  deleteOrderMutation
}: {
  order: any;
  updateOrderMutation: any;
  nextAction: any;
  flags: string[];
  confidence: any;
  handleDelete: (orderId: number, orderNumber: string, customerName: string) => Promise<void>;
  deleteOrderMutation: any;
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

  const statusRef = useRef<HTMLSelectElement>(null);
  const gatewayRef = useRef<HTMLInputElement>(null);
  const deliveryRef = useRef<HTMLInputElement>(null);
  const installRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const timeline = getFulfillmentTimeline(order);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "cancelled" && order.status !== "cancelled") {
      const ok = await confirmDialog({
        title: "Cancel this order?",
        message: `Are you sure you want to cancel order ${order.orderNumber} for ${order.customerName}? This can be undone by setting a new status.`,
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

  const handleInstructionClick = () => {
    switch (nextAction.action) {
      case "confirm_availability":
        statusRef.current?.focus();
        break;
      case "confirm_fitment":
        notesRef.current?.focus();
        break;
      case "order_from_gateway":
        gatewayRef.current?.focus();
        break;
      case "await_delivery":
      case "track_package":
        deliveryRef.current?.focus();
        break;
      case "schedule_install":
      case "mark_ready_for_install":
        installRef.current?.focus();
        break;
      case "verify_invoice":
        notesRef.current?.focus();
        break;
      case "close_order":
        statusRef.current?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column: Fulfillment Timeline & Alerts */}
      <div className="space-y-5 lg:col-span-1">
        {/* Risk Alerts list */}
        {flags.length > 0 && (
          <Panel title="Risk Flags" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}>
            <div className="space-y-3 mt-2">
              {flags.map((f) => (
                <div key={f} className="flex items-start gap-2.5 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 mt-1.5" />
                  <div className="flex-1 space-y-0.5">
                    <span className="font-extrabold text-foreground">{f.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</span>
                    <p className="text-xs font-medium text-muted-foreground/90 leading-relaxed">
                      {f === "uncommon_size" && "Tire size is not commonly stocked in local Cleveland bays."}
                      {f === "missing_email" && "No customer email provided. Order confirmations can't be auto-sent."}
                      {f === "fitment_needs_confirmation" && "Verify customer vehicle fits tire size before ordering."}
                      {f === "missing_gateway_reference" && "Gateway PO reference is missing for order confirmation."}
                      {f === "manual_supplier_order_required" && "Operator action required: place order manually in Gateway portal."}
                      {f === "ready_for_install" && "Tires are delivered. Confirm appointment schedule with customer."}
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
              let textClass = "text-muted-foreground font-medium";

              if (step.status === "complete") {
                dotClass = "bg-emerald-500 text-white ring-4 ring-card";
                textClass = "text-foreground font-extrabold";
              } else if (step.status === "current") {
                dotClass = "bg-primary text-primary-foreground ring-4 ring-card ring-primary/20 animate-pulse";
                textClass = "text-primary font-black";
              } else if (step.status === "blocked") {
                dotClass = "bg-red-500 text-white ring-4 ring-card";
                textClass = "text-red-400 font-extrabold";
              }

              return (
                <div key={step.key} className="relative flex gap-3 items-start text-sm">
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
                      <p className="text-xs text-red-400 font-semibold mt-0.5">{step.reason}</p>
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
            <span className="text-xs uppercase font-extrabold tracking-wider text-muted-foreground">
              Confidence Score: {confidence.score}/100
            </span>
          }
        >
          <div className="space-y-3 mt-1">
            <div
              onClick={handleInstructionClick}
              className="bg-background/40 border border-border/30 rounded p-3 text-sm leading-relaxed space-y-2 cursor-pointer hover:bg-foreground/[0.02] active:scale-[0.99] transition-all"
            >
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-foreground">Instruction:</span>
                <span className="text-primary font-bold hover:underline">{nextAction.staffInstruction}</span>
              </div>
              <p className="text-xs font-semibold text-muted-foreground/90">
                <span className="font-extrabold text-foreground/80">Context: </span>
                {confidence.explanation}
              </p>
            </div>

            {/* Note details */}
            {order.customerNotes && (
              <div className="text-sm bg-foreground/[0.015] border border-border/10 p-2.5 rounded">
                <span className="font-extrabold text-foreground">Customer Notes:</span>
                <p className="text-muted-foreground/90 text-xs font-medium mt-1 whitespace-pre-wrap">{order.customerNotes}</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Update Order Details" icon={<FileText className="w-4 h-4" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status Selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-foreground/85 tracking-wide uppercase">Order Status</label>
              <select
                ref={statusRef}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary/50"
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
              <label className="text-xs font-bold text-foreground/85 tracking-wide uppercase">Gateway PO / Order Ref</label>
              <input
                ref={gatewayRef}
                type="text"
                value={gatewayOrderRef}
                onChange={(e) => setGatewayOrderRef(e.target.value)}
                placeholder="e.g. PO-89025"
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary/50 placeholder:text-foreground/20"
              />
            </div>

            {/* Expected delivery */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-foreground/85 tracking-wide uppercase">Expected Supplier Delivery</label>
              <input
                ref={deliveryRef}
                type="datetime-local"
                value={expectedDelivery}
                onChange={(e) => setExpectedDelivery(e.target.value)}
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Installation Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-foreground/85 tracking-wide uppercase">Scheduled Installation Date</label>
              <input
                ref={installRef}
                type="datetime-local"
                value={installationDate}
                onChange={(e) => setInstallationDate(e.target.value)}
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary/50"
              />
            </div>

            {/* Admin notes (full width) */}
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label className="text-xs font-bold text-foreground/85 tracking-wide uppercase">Admin Notes (internal only)</label>
              <textarea
                ref={notesRef}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={3}
                placeholder="Add notes about supplier updates, customer calls, or tire tracking details..."
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary/50 resize-none placeholder:text-foreground/20"
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-border/10">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleDelete(order.id, order.orderNumber, order.customerName)}
                disabled={deleteOrderMutation.isPending}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Delete Order
              </button>
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
