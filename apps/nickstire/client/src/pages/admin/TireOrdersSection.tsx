import { useState, useMemo, useRef } from "react";
import {
  Disc, Wrench, User, Car, Check, X, ChevronDown, ChevronUp, RefreshCw, FileText, CheckCircle2,
  Loader2, AlertTriangle
} from "lucide-react";
import { Section, Panel, SearchInput } from "./shared";
import { formatRelativeDate } from "./shared/format";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import {
  getQuoteConfidence, getRiskFlags, getNextAction, getFulfillmentTimeline
} from "@shared/tireCommerce";
import GatewayPill from "@/components/admin/GatewayPill";
import GatewayOrderPanel from "@/components/admin/GatewayOrderPanel";
import KafeneLeasePanel from "@/components/admin/KafeneLeasePanel";
import TireMarkupCard from "@/components/admin/TireMarkupCard";
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

// One filter, not a tab bar: one online order was recorded lifetime by 2026-10-25.
const STATUS_OPTIONS: { id: OrderStatusFilter; label: string }[] = [
  { id: "all", label: "All statuses" },
  { id: "received", label: "New request" },
  { id: "confirmed", label: "Confirmed" },
  { id: "ordered", label: "Ordered" },
  { id: "in_transit", label: "In transit" },
  { id: "delivered", label: "Delivered" },
  { id: "scheduled", label: "Scheduled" },
  { id: "installed", label: "Installed" },
  { id: "cancelled", label: "Cancelled" },
];

type TireEventName =
  | "tire_search_submitted" | "tire_quote_cta_click" | "vehicle_size_selected" | "tire_option_selected" | "top_pick_selected";

/** The website's tire events, counted by exact name (gatewayTire.tireActivity). Counts only: they are not one linked journey. */
const TIRE_EVENTS: { name: TireEventName; label: string; hint?: string }[] = [
  { name: "tire_search_submitted", label: "Tire-size searches" },
  { name: "tire_quote_cta_click", label: "Quote taps", hint: "a tap, not a quote" },
  { name: "vehicle_size_selected", label: "Sizes picked" },
  { name: "tire_option_selected", label: "Options picked" },
  { name: "top_pick_selected", label: "Top picks chosen" },
];

const nyDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
/** "Sep 27" from an ET shop-day key (YYYY-MM-DD): noon UTC read in UTC, so no zone can move the day. */
const dayKeyLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

const WINDOW_DAYS = 30;
const LIST_LIMIT = 100;
const RETRY = "min-h-12 px-4 rounded-md border border-border/40 text-sm font-semibold text-foreground";

// listOrders also returns saved quotes (TQ- rows, server/lib/tire-order-guards.ts); orderStats does not count them.
const isQuoteRow = (o: { orderNumber: string }) => o.orderNumber.startsWith("TQ-");

/** "1 in 30 days": orders (not quotes) created at or after `since`, the activity read's own window start, so both
 *  counts cover the same shop days; among the newest LIST_LIMIT rows; "N+" when more rows exist than were read
 *  and every row read is inside the window. */
function ordersInWindow(rows: { createdAt: string | Date; orderNumber: string }[], total: number, since: number): string {
  const inWindow = rows.filter((o) => new Date(o.createdAt).getTime() >= since);
  const n = inWindow.filter((o) => !isQuoteRow(o)).length;
  return inWindow.length === rows.length && total > rows.length ? `${n}+` : String(n);
}

type ActivityQuery = {
  data: RouterOutputs["gatewayTire"]["tireActivity"] | undefined;
  isError: boolean;
  refetch: () => unknown;
};

function TireActivityStrip({ activity, ordersLine }: { activity: ActivityQuery; ordersLine: string }) {
  const read = activity.data;

  let events: React.ReactNode;
  if (activity.isError) {
    events = <p className="text-sm text-amber-400">Activity couldn't load: unknown.</p>;
  } else if (!read) {
    events = <p className="text-sm text-muted-foreground">Loading activity.</p>;
  } else if (!read.available) {
    events = <p className="text-sm text-amber-400">{read.message}</p>;
  } else {
    events = TIRE_EVENTS.map((e) => (
      <div key={e.name} className="rounded-md border border-border/30 bg-background/40 p-3">
        <dt className="text-sm text-muted-foreground">{e.label}</dt>
        <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{read.counts[e.name].toLocaleString("en-US")}</dd>
        {e.hint && <dd className="text-xs text-muted-foreground">{e.hint}</dd>}
      </div>
    ));
  }
  const failed = activity.isError || read?.available === false;

  return (
    <section aria-labelledby="tire-activity-title" className="rounded-lg border border-border/40 bg-card p-4">
      <h2 id="tire-activity-title" className="text-sm font-semibold">Online tire activity, last 30 days</h2>
      {read?.available && <p className="mt-1 text-sm text-muted-foreground">{`${dayKeyLabel(read.fromDayKey)} to ${nyDay(read.to)}`}</p>}
      {!Array.isArray(events) && <div className="mt-2">{events}</div>}
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.isArray(events) && events}
        <div className="rounded-md border border-border/30 bg-background/40 p-3">
          <dt className="text-sm text-muted-foreground">Online orders</dt>
          <dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{ordersLine}</dd>
        </div>
      </dl>
      {failed && (
        <button type="button" onClick={() => void activity.refetch()} className={`mt-3 ${RETRY}`}>
          Retry
        </button>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Website activity only. Counter tire sales and installs are not measured: ShopDriver's invoice line items are not connected. Online orders are not the shop's tire sales.
      </p>
    </section>
  );
}

export default function TireOrdersSection() {
  const [activeTab, setActiveTab] = useState<OrderStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  // Every name is always present and 0 is a real zero: the query asked for that exact name and found no rows.
  const activity = trpc.gatewayTire.tireActivity.useQuery({ days: WINDOW_DAYS }, { refetchInterval: 60_000 });

  // 60s auto-refresh so the list stays current on the counter screen without manual syncs. The search runs on
  // the server, so it finds an order older than the newest LIST_LIMIT rows.
  const { data: listData, isLoading, isError, refetch: refetchOrders } = trpc.gatewayTire.listOrders.useQuery({
    status: activeTab === "all" ? undefined : activeTab,
    search: searchQuery || undefined,
    limit: LIST_LIMIT,
  }, { refetchInterval: 60_000 });
  // Unfiltered newest orders for the 30-day count; the same query as the list when the filter is All statuses.
  const allOrders = trpc.gatewayTire.listOrders.useQuery({ limit: LIST_LIMIT }, { refetchInterval: 60_000 });

  // ROS-083 · orderStats throws on a dead handle: its lifetime count renders unknown, never 0.
  const {
    data: stats,
    isError: statsError,
    refetch: refetchStats,
  } = trpc.gatewayTire.orderStats.useQuery(undefined, { refetchInterval: 60_000 });

  const lifetime = stats ? `${stats.total} lifetime` : statsError ? "lifetime unknown" : "lifetime loading";
  // Orders are counted on the activity read's window (whole ET shop days), never a second client-side window.
  const windowStart = activity.data?.available ? Date.parse(activity.data.from) : null;
  const windowUnavailable = activity.isError || activity.data?.available === false;
  const recent = windowUnavailable ? null
    : windowStart === null ? "loading"
    : allOrders.data ? ordersInWindow(allOrders.data.orders, allOrders.data.total ?? 0, windowStart)
    : allOrders.isError ? "unknown" : "loading";
  const ordersLine = recent === null ? `window unavailable · ${lifetime}` : `${recent} in 30 days · ${lifetime}`;
  const lifetimeSentence = stats
    ? `${stats.total} online order${stats.total === 1 ? "" : "s"} recorded lifetime.`
    : statsError ? "The lifetime count couldn't load: unknown." : "";

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

  const cancelOrderMutation = trpc.gatewayTire.cancelOrder.useMutation({
    onSuccess: () => {
      toast.success("Order cancelled: kept in history");
      refetchOrders();
      refetchStats();
      setExpandedOrderId(null);
    },
    onError: (err) => {
      toast.error(`Cancel failed: ${err.message}`);
    },
  });

  const handleCancel = async (orderId: number, orderNumber: string, customerName: string) => {
    const ok = await confirmDialog({
      title: "Cancel Tire Order?",
      message: `Cancel order ${orderNumber} for ${customerName}? The order stays in history as CANCELLED: nothing is deleted, so refund risk and walked-order patterns stay visible.`,
      confirmLabel: "Cancel Order",
      tone: "danger",
    });

    if (!ok) return;

    cancelOrderMutation.mutate({ id: orderId });
  };

  const handleRefresh = () => {
    refetchOrders();
    void allOrders.refetch();
    void activity.refetch();
    refetchStats();
    // A markup saved in another session shows after Refresh.
    void utils.gatewayTire.markup.invalidate();
  };

  // Sort by next-action priority (urgent first) so the operator's next move is always at the top:
  // a paid order needing a Gateway order must never sit below the fold.
  // Saved quotes (TQ- rows) are listed apart: they are not orders and never count as one.
  const [filteredOrders, savedQuotes] = useMemo(() => {
    if (!listData?.orders) return [[], []];
    const sorted = [...listData.orders].sort((a: any, b: any) => {
      const ra = PRIORITY_RANK[getNextAction(a).priority];
      const rb = PRIORITY_RANK[getNextAction(b).priority];
      if (ra !== rb) return ra - rb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return [sorted.filter((o) => !isQuoteRow(o)), sorted.filter(isQuoteRow)];
  }, [listData]);

  // Priority color borders & text colors
  const getPriorityStyles = (priority: "urgent" | "high" | "normal" | "low") => {
    switch (priority) {
      case "urgent":
        return {
          border: "border-red-500/40 bg-red-500/[0.02]",
          badge: "bg-red-500/10 text-red-400 border-red-500/20",
        };
      case "high":
        return {
          border: "border-amber-500/30 bg-amber-500/[0.01]",
          badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        };
      case "normal":
        return {
          border: "border-border/30",
          badge: "bg-primary/10 text-primary border-primary/20",
        };
      default:
        return {
          border: "border-border/20",
          badge: "bg-foreground/5 text-foreground/40 border-border/10",
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

  // One row card, used for orders and, apart, for saved quotes.
  const renderRow = (order: any) => {
    const isExpanded = expandedOrderId === order.id;
    const confidence = getQuoteConfidence(order);
    const flags = getRiskFlags(order);
    const nextAction = getNextAction(order);
    const priorityStyle = getPriorityStyles(nextAction.priority);
    const closed = order.status === "installed" || order.status === "cancelled";

    return (
      <div
        key={order.id}
        className={`bg-card border overflow-hidden transition-colors ${priorityStyle.border}`}
      >
        {/* Order Card Header */}
        <div
          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
          className="p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer hover:bg-foreground/[0.015] transition-colors"
        >
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-0.5 border rounded text-xs font-extrabold ${priorityStyle.badge}`}>
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
                <span className="text-xs bg-foreground/5 border border-border/25 px-2 py-0.5 rounded text-foreground/75 font-semibold">
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
                className="inline-flex min-h-12 items-center text-sm text-primary hover:underline font-bold"
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

                {/* Quick Cancel (soft — the row stays in history); none on a closed order */}
                {!closed && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancel(order.id, order.orderNumber, order.customerName);
                    }}
                    disabled={cancelOrderMutation.isPending}
                    className="min-h-12 px-3 text-xs font-extrabold border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 text-red-400 rounded transition-colors flex items-center gap-1"
                  >
                    {cancelOrderMutation.isPending && cancelOrderMutation.variables?.id === order.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <X className="w-3 h-3" />
                    )}
                    Cancel
                  </button>
                )}
              </div>

              {/* Quote confidence */}
              <span className={`px-2 py-0.5 text-xs font-bold border rounded ${getConfidenceBadgeStyles(confidence.grade)}`}>
                {confidence.grade} Confidence
              </span>
            </div>

            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Hide details for ${order.orderNumber}` : `Show details for ${order.orderNumber}`}
              onClick={(e) => {
                e.stopPropagation();
                setExpandedOrderId(isExpanded ? null : order.id);
              }}
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded text-foreground/50 hover:text-foreground"
            >
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
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
            <span className="text-muted-foreground/95">· {nextAction.reason}</span>
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
            <KafeneLeasePanel order={order} />
            <GatewayOrderPanel order={order} />
            <OrderFormEdit
              order={order}
              updateOrderMutation={updateOrderMutation}
              nextAction={nextAction}
              flags={flags}
              confidence={confidence}
              handleCancel={handleCancel}
              cancelOrderMutation={cancelOrderMutation}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <Section
      title="Tires"
      subtitle="Online tire activity, the website's orders, and the online price rule. Counter tire sales are not measured here."
      icon={<Disc className="w-5 h-5 text-primary" />}
      actions={
        <div className="flex items-center gap-3">
          <GatewayPill />
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex min-h-12 items-center gap-1.5 px-4 border border-border/30 hover:border-border/60 text-foreground/70 hover:text-foreground text-sm font-semibold rounded bg-card/50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      }
    >
      <TireActivityStrip activity={activity} ordersLine={ordersLine} />

      <section aria-labelledby="tire-orders-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="tire-orders-title" className="text-sm font-semibold">Online orders</h2>
          <label htmlFor="tire-order-status" className="sr-only">Order status</label>
          <select
            id="tire-order-status"
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as OrderStatusFilter)}
            className="min-h-12 rounded-md border border-border/40 bg-card px-3 text-base text-foreground focus:outline-none focus:border-primary/50"
          >
            {STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search by name, phone, order #, size" />
        {(listData?.orders.length ?? 0) >= LIST_LIMIT && (
          <p className="text-sm text-muted-foreground">{`Showing the newest ${LIST_LIMIT}; search to find an older order.`}</p>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            Loading orders.
          </div>
        ) : isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            <span>Online orders couldn't load: unknown, not empty.</span>
            <button type="button" aria-label="Retry loading orders" onClick={() => void refetchOrders()} className={RETRY}>
              Retry
            </button>
          </div>
        ) : filteredOrders.length === 0 ? (
          <p className="rounded-md border border-border/30 bg-card/40 p-4 text-sm text-muted-foreground">
            {`No online orders match this view. ${lifetimeSentence}`.trim()}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map(renderRow)}
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Supplier tires are not auto-ordered and online payment does not reserve supplier stock; confirm, order from D&K, record the PO, advance the status.
        </p>
      </section>
      {savedQuotes.length > 0 && (
        <section aria-labelledby="tire-quotes-title" className="space-y-3">
          <h2 id="tire-quotes-title" className="text-sm font-semibold">Saved quotes, not orders</h2>
          <p className="text-sm text-muted-foreground">
            {`${savedQuotes.length} saved quote${savedQuotes.length === 1 ? "" : "s"} in this view. A quote is not counted as an order.`}
          </p>
          <div className="space-y-3">{savedQuotes.map(renderRow)}</div>
        </section>
      )}
      <TireMarkupCard />
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
  handleCancel,
  cancelOrderMutation
}: {
  order: any;
  updateOrderMutation: any;
  nextAction: any;
  flags: string[];
  confidence: any;
  handleCancel: (orderId: number, orderNumber: string, customerName: string) => Promise<void>;
  cancelOrderMutation: any;
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
  const [refundReason, setRefundReason] = useState("");

  const utils = trpc.useUtils();
  const refundOrderMutation = trpc.gatewayTire.refundOrder.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`Refund processed successfully: ${res.refundId}`);
        utils.gatewayTire.listOrders.invalidate();
        utils.gatewayTire.orderStats.invalidate();
        setRefundReason("");
      } else {
        toast.error(`Refund failed: ${res.error || "Unknown error"}`);
      }
    },
    onError: (err) => {
      toast.error(`Refund failed: ${err.message}`);
    },
  });

  const handleRefund = async () => {
    if (!refundReason.trim()) {
      toast.error("Refund reason is required.");
      return;
    }

    const ok = await confirmDialog({
      title: "Refund Tire Order?",
      message: `Are you sure you want to issue a full refund of $${order.totalAmount.toFixed(2)} for order ${order.orderNumber} (${order.customerName})? This will return the payment via Stripe.`,
      confirmLabel: "Confirm Refund",
      tone: "danger",
    });

    if (!ok) return;

    refundOrderMutation.mutate({
      orderId: order.id,
      reason: refundReason.trim(),
    });
  };

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
            <span className="text-xs font-extrabold text-muted-foreground">
              Confidence score: {confidence.score}/100
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
              <label className="text-xs font-bold text-foreground/85">Order status</label>
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
              <label className="text-xs font-bold text-foreground/85">Gateway PO / order ref</label>
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
              <label className="text-xs font-bold text-foreground/85">Expected supplier delivery</label>
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
              <label className="text-xs font-bold text-foreground/85">Scheduled installation date</label>
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
              <label className="text-xs font-bold text-foreground/85">Admin Notes (internal only)</label>
              <textarea
                ref={notesRef}
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={3}
                placeholder="Add notes about supplier updates, customer calls, or tire tracking details..."
                className="bg-background border border-border/40 rounded px-3 py-2 text-sm font-semibold text-foreground focus:outline-none focus:border-primary/50 resize-none placeholder:text-foreground/20"
              />
            </div>

            {/* Refund Options / Status Banners */}
            {order.paymentStatus === "paid" && (
              <div className="flex flex-col gap-2.5 p-3.5 bg-red-500/[0.02] border border-red-500/15 rounded-lg md:col-span-2 shadow-[0_1px_3px_rgba(239,68,68,0.02)]">
                <h5 className="text-xs font-black text-red-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Online Stripe payment refund
                </h5>
                <p className="text-xs font-medium text-muted-foreground/90 leading-relaxed">
                  This order has been paid online. If the order is cancelled or customer needs their money back, you can issue a full refund directly to the original card.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 mt-1 items-stretch sm:items-end">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="text-[10px] font-black text-foreground/75">Refund Reason (required)</label>
                    <input
                      type="text"
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="e.g. Customer cancelled / duplicate order / size unavailable"
                      className="bg-background border border-border/40 rounded px-3 py-2 text-xs font-semibold text-foreground focus:outline-none focus:border-red-500/40 placeholder:text-foreground/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleRefund}
                    disabled={refundOrderMutation.isPending || !refundReason.trim()}
                    className="shrink-0 px-5 py-2 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600 transition-colors disabled:opacity-40 select-none active:scale-[0.98] flex items-center justify-center gap-1.5"
                  >
                    {refundOrderMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Refund Order
                  </button>
                </div>
              </div>
            )}

            {order.paymentStatus === "refunded" && (
              <div className="flex items-center gap-3 p-3.5 bg-emerald-500/[0.02] border border-emerald-500/15 rounded-lg md:col-span-2 text-emerald-400 shadow-[0_1px_3px_rgba(16,185,129,0.02)]">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <div className="text-xs font-medium">
                  <span className="font-extrabold block text-foreground">Order Refunded</span>
                  <span className="text-muted-foreground/85 block mt-0.5">Stripe payment has been returned, and status has been written back to the invoice database.</span>
                </div>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex justify-between items-center mt-4 pt-4 border-t border-border/10">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => handleCancel(order.id, order.orderNumber, order.customerName)}
                disabled={cancelOrderMutation.isPending}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/25 border border-red-500/30 text-red-400 rounded text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Cancel Order
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
