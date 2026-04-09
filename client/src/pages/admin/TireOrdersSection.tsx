/**
 * TIRE ORDERS — Admin section for managing online tire orders.
 * View orders, update status, add notes, track through lifecycle.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Package, Search, Phone, Mail, Car, Clock, ChevronRight,
  CheckCircle2, Truck, Loader2, X, Calendar, MessageSquare,
  DollarSign, AlertCircle, ArrowRight, ExternalLink, Filter,
} from "lucide-react";
import { StatCard } from "./shared";

// ─── STATUS CONFIG ────────────────────────────────────
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  received: { label: "Received", color: "text-amber-400", bg: "bg-amber-500/10", icon: <Package className="w-3.5 h-3.5" /> },
  confirmed: { label: "Confirmed", color: "text-blue-400", bg: "bg-blue-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  ordered: { label: "Ordered", color: "text-indigo-400", bg: "bg-indigo-500/10", icon: <ArrowRight className="w-3.5 h-3.5" /> },
  in_transit: { label: "In Transit", color: "text-purple-400", bg: "bg-purple-500/10", icon: <Truck className="w-3.5 h-3.5" /> },
  delivered: { label: "Delivered", color: "text-cyan-400", bg: "bg-cyan-500/10", icon: <Package className="w-3.5 h-3.5" /> },
  scheduled: { label: "Scheduled", color: "text-green-400", bg: "bg-green-500/10", icon: <Calendar className="w-3.5 h-3.5" /> },
  installed: { label: "Installed", color: "text-emerald-400", bg: "bg-emerald-500/10", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  cancelled: { label: "Cancelled", color: "text-red-400", bg: "bg-red-500/10", icon: <X className="w-3.5 h-3.5" /> },
};

const STATUS_FLOW = ["received", "confirmed", "ordered", "in_transit", "delivered", "scheduled", "installed"];

// ─── MAIN COMPONENT ──────────────────────────────────
export default function TireOrdersSection() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const { data: stats } = trpc.gatewayTire.orderStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: ordersData, refetch } = trpc.gatewayTire.listOrders.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
    search: searchTerm || undefined,
    limit: 50,
  }, { refetchInterval: 30000 });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        <StatCard label="Total Orders" value={stats?.total || 0} icon={<Package className="w-4 h-4" />} />
        <StatCard label="Pending" value={(stats?.received || 0) + (stats?.confirmed || 0)} icon={<Clock className="w-4 h-4" />} color="text-amber-400" />
        <StatCard label="In Progress" value={(stats?.ordered || 0) + (stats?.inTransit || 0)} icon={<Truck className="w-4 h-4" />} color="text-blue-400" />
        <StatCard label="Completed" value={stats?.installed || 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Revenue" value={`$${(stats?.totalRevenue || 0).toLocaleString()}`} icon={<DollarSign className="w-4 h-4" />} color="text-primary" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, phone, or order number..."
            className="w-full pl-10 pr-4 py-2.5 bg-card border border-border/30 rounded-md text-sm text-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {["all", "received", "confirmed", "ordered", "in_transit", "delivered", "scheduled", "installed", "cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-2 rounded-md font-medium transition-colors capitalize ${
                statusFilter === s
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground border border-border/30"
              }`}
            >
              {s === "all" ? "All" : s === "in_transit" ? "In Transit" : s}
            </button>
          ))}
        </div>
      </div>

      {/* Order list */}
      <div className="space-y-2">
        {!ordersData?.orders?.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <Package className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No tire orders yet</p>
            <p className="text-xs mt-1">Orders placed through the online tire shop will appear here.</p>
          </div>
        ) : (
          ordersData.orders.map((order: any, _oIdx: any) => {
            const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.received;
            const isSelected = selectedOrderId === order.id;

            return (
              <div key={order.id} className="stagger-in bg-card border border-border/30 rounded-md overflow-hidden" style={{ animationDelay: `${_oIdx * 50}ms` }}>
                {/* Order row */}
                <button
                  onClick={() => setSelectedOrderId(isSelected ? null : order.id)}
                  className="w-full text-left p-4 hover:bg-card/80 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${config.bg}`}>
                        <span className={config.color}>{config.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">{order.customerName}</span>
                          <span className="text-[10px] text-muted-foreground">{order.orderNumber}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {order.quantity}x {order.tireBrand} {order.tireModel} — {order.tireSize}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <span className="text-sm font-medium text-foreground">${order.totalAmount.toFixed(2)}</span>
                      <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${config.bg} ${config.color}`}>
                        {config.label}
                      </span>
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : ""}`} />
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isSelected && (
                  <OrderDetail orderId={order.id} onUpdate={() => refetch()} />
                )}
              </div>
            );
          })
        )}
      </div>

      {ordersData && ordersData.total > 50 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {ordersData.orders.length} of {ordersData.total} orders
        </p>
      )}
    </div>
  );
}

// ─── ORDER DETAIL ─────────────────────────────────────
function OrderDetail({ orderId, onUpdate }: { orderId: number; onUpdate: () => void }) {
  const { data: order, isLoading } = trpc.gatewayTire.getOrder.useQuery({ id: orderId });
  const updateOrder = trpc.gatewayTire.updateOrder.useMutation({
    onSuccess: () => { toast.success("Order updated"); onUpdate(); },
    onError: () => toast.error("Failed to update order"),
  });

  const [notes, setNotes] = useState("");
  const [gwRef, setGwRef] = useState("");

  if (isLoading || !order) {
    return (
      <div className="p-6 border-t border-border/20 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
      </div>
    );
  }

  const config = STATUS_CONFIG[order.status] || STATUS_CONFIG.received;
  const currentStepIdx = STATUS_FLOW.indexOf(order.status);

  return (
    <div className="p-5 border-t border-border/20 space-y-5">
      {/* Customer info */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <span className="text-[10px] text-muted-foreground tracking-wider uppercase block mb-1">Customer</span>
          <p className="text-sm text-foreground font-medium">{order.customerName}</p>
          <div className="flex items-center gap-1.5 mt-1">
            <Phone className="w-3 h-3 text-muted-foreground" />
            <a href={`tel:${order.customerPhone}`} className="text-xs text-primary hover:underline">{order.customerPhone}</a>
          </div>
          {order.customerEmail && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Mail className="w-3 h-3 text-muted-foreground" />
              <a href={`mailto:${order.customerEmail}`} className="text-xs text-primary hover:underline">{order.customerEmail}</a>
            </div>
          )}
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground tracking-wider uppercase block mb-1">Tires</span>
          <p className="text-sm text-foreground font-medium">{order.quantity}x {order.tireBrand} {order.tireModel}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Size: {order.tireSize}</p>
        </div>
        <div>
          <span className="text-[10px] text-muted-foreground tracking-wider uppercase block mb-1">Pricing</span>
          <p className="text-sm text-foreground font-medium">${order.totalAmount.toFixed(2)} total</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            ${order.pricePerTire.toFixed(2)}/tire + ${order.serviceFeePerTire.toFixed(2)} service
          </p>
        </div>
      </div>

      {order.vehicleInfo && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Car className="w-3.5 h-3.5" />
          <span>{order.vehicleInfo}</span>
        </div>
      )}

      {order.customerNotes && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-background/50 border border-border/20 rounded-md p-3">
          <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{order.customerNotes}</span>
        </div>
      )}

      {/* Status progress */}
      <div>
        <span className="text-[10px] text-muted-foreground tracking-wider uppercase block mb-2">Order Progress</span>
        <div className="flex items-center gap-1">
          {STATUS_FLOW.map((step, i) => {
            const isComplete = i <= currentStepIdx;
            const isCurrent = i === currentStepIdx;
            return (
              <div key={step} className="flex-1 flex flex-col items-center">
                <div className={`h-1.5 w-full rounded-full ${isComplete ? "bg-primary" : "bg-border/30"}`} />
                <span className={`text-[9px] mt-1 ${isCurrent ? "text-primary font-medium" : "text-muted-foreground/50"}`}>
                  {step === "in_transit" ? "Transit" : step.charAt(0).toUpperCase() + step.slice(1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FLOW.map((nextStatus) => {
          if (nextStatus === order.status) return null;
          const nextConfig = STATUS_CONFIG[nextStatus];
          if (!nextConfig) return null;
          return (
            <button
              key={nextStatus}
              onClick={() => updateOrder.mutate({ id: orderId, status: nextStatus as "confirmed" | "cancelled" | "received" | "scheduled" | "delivered" | "ordered" | "in_transit" | "installed" })}
              disabled={updateOrder.isPending}
              className={`text-xs px-3 py-1.5 rounded-md border border-border/30 ${nextConfig.color} hover:${nextConfig.bg} transition-colors disabled:opacity-50 flex items-center gap-1.5`}
            >
              {nextConfig.icon}
              {nextConfig.label}
            </button>
          );
        })}
        {order.status !== "cancelled" && (
          <button
            onClick={() => {
              if (confirm("Cancel this order?")) {
                updateOrder.mutate({ id: orderId, status: "cancelled" });
              }
            }}
            disabled={updateOrder.isPending}
            className="text-xs px-3 py-1.5 rounded-md border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
        )}
      </div>

      {/* Admin notes + Gateway ref */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground tracking-wider uppercase block mb-1">Gateway Order Ref</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={gwRef || order.gatewayOrderRef || ""}
              onChange={(e) => setGwRef(e.target.value)}
              placeholder="Gateway order #"
              className="flex-1 bg-background border border-border/30 rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={() => { if (gwRef) updateOrder.mutate({ id: orderId, gatewayOrderRef: gwRef }); }}
              disabled={!gwRef || updateOrder.isPending}
              className="bg-primary/10 text-primary px-3 py-2 rounded-md text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground tracking-wider uppercase block mb-1">Admin Notes</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={notes || order.adminNotes || ""}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes..."
              className="flex-1 bg-background border border-border/30 rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50"
            />
            <button
              onClick={() => { if (notes) updateOrder.mutate({ id: orderId, adminNotes: notes }); }}
              disabled={!notes || updateOrder.isPending}
              className="bg-primary/10 text-primary px-3 py-2 rounded-md text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Timestamps */}
      <div className="flex flex-wrap gap-4 text-[10px] text-muted-foreground pt-2 border-t border-border/20">
        <span>Created: {new Date(order.createdAt).toLocaleString()}</span>
        {order.expectedDelivery && <span>Expected Delivery: {new Date(order.expectedDelivery).toLocaleDateString()}</span>}
        {order.installationDate && <span>Installation: {new Date(order.installationDate).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}
