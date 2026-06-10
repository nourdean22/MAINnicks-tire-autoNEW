/**
 * TireOrdersTab — admin fulfillment surface for online tire orders.
 *
 * 2026-06-10 checkout-hardening wave. The server has had full order
 * management (gatewayTire.listOrders / getOrder / updateOrder /
 * orderStats) since the ordering system shipped, but the old
 * TireOrdersSection was deleted in the 2026-04-24 admin cut and never
 * replaced — staff were fulfilling a LIVE Stripe money path from email +
 * Telegram alone. This tab is the DB-backed source of truth: every
 * order, its payment state, and the single next action, sorted so the
 * most urgent order is always on top.
 *
 * Also the landing surface for the paid-order alert backlog
 * (nickActions.paymentAlertBacklog) — paid orders whose email AND
 * Telegram hand-off both failed previously had no resolvable UI at all.
 */
import { useMemo, useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, ExternalLink, AlertTriangle, RefreshCw, Search } from "lucide-react";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { nextActionForOrder, type TireOrderNextAction } from "@shared/tireOrderNextAction";

type OrderRow = RouterOutputs["gatewayTire"]["listOrders"]["orders"][number];

const STATUS_OPTIONS = [
  "received", "confirmed", "ordered", "in_transit",
  "delivered", "scheduled", "installed", "cancelled",
] as const;

const TONE_CLASSES: Record<TireOrderNextAction["tone"], string> = {
  crit: "bg-red-500/15 text-red-400 border-red-500/30",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  info: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  ok: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  muted: "bg-foreground/5 text-foreground/40 border-border/30",
};

function PaymentChip({ status }: { status: string }) {
  const cls = status === "paid"
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : status === "refunded"
      ? "bg-foreground/5 text-foreground/40 border-border/30"
      : "bg-amber-500/15 text-amber-400 border-amber-500/30";
  const label = status === "paid" ? "PAID ONLINE" : status === "refunded" ? "REFUNDED" : "UNPAID";
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${cls}`}>{label}</span>;
}

/** yyyy-mm-dd for <input type="date">, empty when unset. */
function toDateInput(v: string | Date | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function TireOrdersTab() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [search, setSearch] = useState("");

  // "active" is a client-side view (everything not finished); the server
  // filter only understands concrete statuses or "all".
  const serverStatus = statusFilter === "active" || statusFilter === "all" ? "all" : statusFilter;
  const { data, isLoading, isError, refetch } = trpc.gatewayTire.listOrders.useQuery(
    { status: serverStatus, search: search.trim() || undefined, limit: 100, offset: 0 },
    { refetchInterval: 60_000 },
  );
  const { data: stats } = trpc.gatewayTire.orderStats.useQuery();
  const { data: backlog } = trpc.nickActions.paymentAlertBacklog.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const resolveAlert = trpc.nickActions.resolvePaymentAlert.useMutation({
    onSuccess: () => { utils.nickActions.paymentAlertBacklog.invalidate(); toast.success("Alert resolved"); },
    onError: (e) => toast.error(`Resolve failed: ${e.message}`),
  });

  const orders = useMemo(() => {
    let list: OrderRow[] = data?.orders ?? [];
    if (statusFilter === "active") {
      list = list.filter((o) => o.status !== "installed" && o.status !== "cancelled");
    }
    // Most urgent next action first, then newest.
    return [...list].sort((a, b) => {
      const pa = nextActionForOrder(a).priority;
      const pb = nextActionForOrder(b).priority;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt as unknown as string).getTime() - new Date(a.createdAt as unknown as string).getTime();
    });
  }, [data, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Paid-order alert backlog — paid money with a failed hand-off is
          the single most urgent thing in the shop. */}
      {backlog && backlog.count > 0 && (
        <div className="border border-red-500/40 bg-red-500/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-red-400 font-bold text-xs tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            {backlog.count} PAID ORDER{backlog.count === 1 ? "" : "S"} WITH FAILED HAND-OFF — FULFIL MANUALLY
          </div>
          {backlog.items.map((b) => (
            <div key={b.id} className="flex items-start justify-between gap-3 text-xs text-foreground/80">
              <span>
                {b.tireOrderNumber ? `${b.tireOrderNumber} · ` : ""}{b.summary}
                <span className="text-foreground/40"> ({b.failureReason})</span>
              </span>
              <button
                onClick={() => resolveAlert.mutate({ id: b.id })}
                disabled={resolveAlert.isPending}
                className="shrink-0 px-2 py-1 border border-red-500/40 text-red-300 text-[10px] font-bold hover:bg-red-500/20 disabled:opacity-50"
              >
                MARK HANDLED
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Stat strip */}
      {stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-border/10 text-center">
          {([
            ["NEW", stats.received],
            ["CONFIRMED", stats.confirmed],
            ["ORDERED", stats.ordered + stats.inTransit],
            ["ARRIVED", stats.delivered],
            ["SCHEDULED", stats.scheduled],
            ["INSTALLED", stats.installed],
          ] as const).map(([label, n]) => (
            <div key={label} className="bg-card p-2.5">
              <span className="block text-[9px] uppercase tracking-[0.15em] text-foreground/50 font-medium">{label}</span>
              <span className="font-bold text-lg text-foreground">{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-card border border-border/30 text-foreground text-xs px-2 py-2"
        >
          <option value="active">Active (not installed/cancelled)</option>
          <option value="all">All</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-foreground/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone, or TO- number"
            className="w-full bg-card border border-border/30 text-foreground text-xs pl-7 pr-2 py-2 placeholder:text-foreground/30"
          />
        </div>
        <button onClick={() => refetch()} className="p-2 border border-border/30 text-foreground/50 hover:text-foreground">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <a
          href="https://b2b.dktire.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-2 border border-primary/30 text-primary text-[10px] font-bold tracking-wider hover:bg-primary/10"
        >
          GATEWAY PORTAL <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Orders */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : isError ? (
        <div className="border border-red-500/30 bg-red-500/10 text-red-400 text-xs p-4">
          Couldn't load tire orders — retry or check the server logs.
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center text-foreground/40 text-sm py-12">
          No {statusFilter === "active" ? "active " : ""}tire orders{search ? ` matching "${search}"` : ""}.
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}

      <p className="text-[10px] text-foreground/30 leading-relaxed">
        The database is the source of truth for orders — email/Telegram/Sheets are
        copies. Supplier tires are NOT auto-ordered: confirm availability with the
        customer, order from Gateway (b2b.dktire.com) by brand/model/size, record
        the PO in "Gateway ref", and advance the status as the order moves.
      </p>
    </div>
  );
}

function OrderCard({ order }: { order: OrderRow }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(order.status);
  const [gatewayRef, setGatewayRef] = useState(order.gatewayOrderRef || "");
  const [eta, setEta] = useState(toDateInput(order.expectedDelivery as unknown as string));
  const [installDate, setInstallDate] = useState(toDateInput(order.installationDate as unknown as string));
  const [notes, setNotes] = useState(order.adminNotes || "");

  const action = nextActionForOrder(order);

  const update = trpc.gatewayTire.updateOrder.useMutation({
    onSuccess: (res) => {
      if (res.success) {
        toast.success(`Order ${order.orderNumber} updated`);
        utils.gatewayTire.listOrders.invalidate();
        utils.gatewayTire.orderStats.invalidate();
      } else {
        toast.error("Update failed — nothing changed.");
      }
    },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const save = async () => {
    if (status === "cancelled" && order.status !== "cancelled") {
      const paid = order.paymentStatus === "paid";
      const ok = await confirmDialog({
        title: "Cancel this order?",
        message: paid
          ? `Customer PAID $${order.totalAmount.toFixed(2)} online. Cancelling does NOT refund them — you must refund in the Stripe dashboard (search ${order.orderNumber}).`
          : `${order.orderNumber} — ${order.customerName}. This can be undone by setting a new status.`,
        confirmLabel: "Cancel order",
        tone: "danger",
      });
      if (!ok) return;
    }
    update.mutate({
      id: order.id,
      status: status !== order.status ? status : undefined,
      adminNotes: notes !== (order.adminNotes || "") ? notes : undefined,
      gatewayOrderRef: gatewayRef !== (order.gatewayOrderRef || "") ? gatewayRef : undefined,
      expectedDelivery: eta && eta !== toDateInput(order.expectedDelivery as unknown as string) ? eta : undefined,
      installationDate: installDate && installDate !== toDateInput(order.installationDate as unknown as string) ? installDate : undefined,
    });
  };

  return (
    <div className="bg-card border border-border/30">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-foreground">{order.orderNumber}</span>
            <PaymentChip status={order.paymentStatus} />
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold border bg-foreground/5 text-foreground/60 border-border/30 uppercase">
              {order.status.replace("_", " ")}
            </span>
          </div>
          <span className="font-bold text-sm text-primary">${order.totalAmount.toFixed(2)}</span>
        </div>
        <div className="text-xs text-foreground/70">
          {order.quantity}x {order.tireBrand} {order.tireModel} ({order.tireSize})
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-foreground/50">
            {order.customerName} · {order.customerPhone}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${TONE_CLASSES[action.tone]}`}>
            {action.label}
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t border-border/20 p-3 space-y-3 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-foreground/60">
            <span>Placed: {new Date(order.createdAt as unknown as string).toLocaleString()}</span>
            {order.paidAt ? <span>Paid: {new Date(order.paidAt as unknown as string).toLocaleString()}</span> : <span>Not paid online</span>}
            {order.invoiceNumber ? <span>Invoice: {order.invoiceNumber}</span> : <span className="text-amber-400">No invoice linked</span>}
            {order.vehicleInfo ? <span>Vehicle: {order.vehicleInfo}</span> : null}
            {order.customerEmail ? <span>Email: {order.customerEmail}</span> : null}
            {order.utmSource ? <span>Source: {order.utmSource}{order.utmCampaign ? ` / ${order.utmCampaign}` : ""}</span> : null}
          </div>
          {order.customerNotes ? (
            <div className="text-foreground/70 border border-border/20 bg-background/50 p-2">
              Customer notes: {order.customerNotes}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-foreground/40">Status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full bg-background border border-border/30 text-foreground px-2 py-2"
              >
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-foreground/40">Gateway ref (D&K PO)</span>
              <input
                value={gatewayRef}
                onChange={(e) => setGatewayRef(e.target.value)}
                placeholder="PO / order # from b2b.dktire.com"
                className="w-full bg-background border border-border/30 text-foreground px-2 py-2 placeholder:text-foreground/30"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-foreground/40">Expected delivery</span>
              <input
                type="date"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                className="w-full bg-background border border-border/30 text-foreground px-2 py-2"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] uppercase tracking-wider text-foreground/40">Install date</span>
              <input
                type="date"
                value={installDate}
                onChange={(e) => setInstallDate(e.target.value)}
                className="w-full bg-background border border-border/30 text-foreground px-2 py-2"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="block text-[10px] uppercase tracking-wider text-foreground/40">Staff notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-background border border-border/30 text-foreground px-2 py-2"
            />
          </label>
          <button
            onClick={save}
            disabled={update.isPending}
            className="w-full sm:w-auto px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wider hover:bg-primary/90 disabled:opacity-50"
          >
            {update.isPending ? "SAVING…" : "SAVE CHANGES"}
          </button>
        </div>
      )}
    </div>
  );
}

export default TireOrdersTab;
