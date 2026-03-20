/**
 * RevenueSection — Advanced Revenue Command Center with KPIs, charts, projections,
 * invoice management, create invoice form, and hour-of-day heatmap.
 * AUDIT-FIXED: Added create invoice, hour heatmap, invoice table with edit/delete.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, BarChart3, Users, Target,
  Loader2, Calendar, ArrowUpRight, ArrowDownRight, Minus, PieChart,
  Zap, Star, Clock, Activity, Plus, X, Trash2, Edit2, FileText, Search
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, PieChart as RPieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid,
} from "recharts";

const CHART_COLORS = ["#F5A623", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EC4899"];

function formatCents(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function RevenueSection() {
  const [period, setPeriod] = useState(30);
  const [tab, setTab] = useState<"dashboard" | "invoices" | "create">("dashboard");
  const { data: stats, isLoading } = trpc.invoices.stats.useQuery({ days: period }, { refetchInterval: 60000 });
  const { data: topCustomers } = trpc.invoices.topCustomers.useQuery({ limit: 10 });
  const { data: kpi } = trpc.kpi.current.useQuery(undefined, { refetchInterval: 60000 });
  const utils = trpc.useUtils();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono text-xs text-foreground/40">Real-time financial intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTab("dashboard")} className={`px-3 py-1.5 font-mono text-xs tracking-wider ${tab === "dashboard" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60"}`}>DASHBOARD</button>
          <button onClick={() => setTab("invoices")} className={`px-3 py-1.5 font-mono text-xs tracking-wider ${tab === "invoices" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60"}`}>INVOICES</button>
          <button onClick={() => setTab("create")} className={`px-3 py-1.5 font-mono text-xs tracking-wider flex items-center gap-1 ${tab === "create" ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60"}`}>
            <Plus className="w-3 h-3" /> NEW
          </button>
        </div>
      </div>

      {tab === "dashboard" && <DashboardView stats={stats} topCustomers={topCustomers} kpi={kpi} period={period} setPeriod={setPeriod} />}
      {tab === "invoices" && <InvoiceListView onCreateNew={() => setTab("create")} />}
      {tab === "create" && <CreateInvoiceView onDone={() => { setTab("invoices"); utils.invoices.list.invalidate(); utils.invoices.stats.invalidate(); }} />}
    </div>
  );
}

// ─── DASHBOARD VIEW ─────────────────────────────────────
function DashboardView({ stats, topCustomers, kpi, period, setPeriod }: any) {
  const revenueChange = stats?.periodComparison?.change ?? 0;

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        {[7, 30, 90].map((d: number) => (
          <button
            key={d}
            onClick={() => setPeriod(d)}
            className={`px-3 py-1.5 font-mono text-xs tracking-wider ${period === d ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"}`}
          >
            {d}D
          </button>
        ))}
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Total Revenue" value={formatCents(stats?.totalRevenue ?? 0)} icon={<DollarSign className="w-5 h-5" />} trend={revenueChange} trendLabel={`${revenueChange >= 0 ? "+" : ""}${revenueChange}% vs prev period`} color="text-primary" />
        <KPICard label="Avg Ticket" value={formatCents(stats?.avgTicket ?? 0)} icon={<Target className="w-5 h-5" />} color="text-blue-400" />
        <KPICard label="Invoices" value={stats?.invoiceCount ?? 0} icon={<BarChart3 className="w-5 h-5" />} color="text-emerald-400" />
        <KPICard label="Conversion Rate" value={`${kpi?.conversionRate ?? 0}%`} icon={<Zap className="w-5 h-5" />} trendLabel="Leads → Bookings" color="text-purple-400" />
      </div>

      {/* Live Operations KPIs */}
      {kpi && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MiniKPI label="This Week" value={kpi.weekBookings} sub="bookings" />
          <MiniKPI label="This Month" value={kpi.monthBookings} sub="bookings" />
          <MiniKPI label="Completed (Week)" value={kpi.completedThisWeek} sub="jobs" />
          <MiniKPI label="New Customers" value={kpi.newCustomersThisMonth} sub="this month" />
          <MiniKPI label="Emergency" value={kpi.emergencyThisWeek} sub="this week" alert={kpi.emergencyThisWeek > 0} />
        </div>
      )}

      {/* Revenue Chart */}
      {stats?.revenueByDay && stats.revenueByDay.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">REVENUE TREND</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.revenueByDay.map((d: any) => ({ ...d, amount: d.amount / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#666" }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: "#666" }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <RechartsTooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }} formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]} />
                <Area type="monotone" dataKey="amount" stroke="#F5A623" fill="#F5A623" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Payment Method Breakdown */}
        {stats?.revenueByPayment && stats.revenueByPayment.length > 0 && (
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">PAYMENT METHODS</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie data={stats.revenueByPayment.map((d: any) => ({ ...d, amount: d.amount / 100, name: d.method.toUpperCase() }))} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {stats.revenueByPayment.map((_: any, i: number) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                  </Pie>
                  <RechartsTooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }} formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]} />
                </RPieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Booking Heatmap (Day of Week) */}
        {kpi?.dayOfWeekCounts && (
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">BOOKING HEATMAP — DAY OF WEEK</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => ({ day, count: kpi.dayOfWeekCounts[i] }))}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#666" }} />
                  <RechartsTooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#F5A623" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Hour-of-Day Heatmap */}
      {kpi?.hourCounts && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">BOOKING HEATMAP — HOUR OF DAY</h3>
          <div className="flex items-end gap-1" style={{ height: 120 }}>
            {kpi.hourCounts.map((count: number, hour: number) => {
              const maxCount = Math.max(...kpi.hourCounts, 1);
              const pct = (count / maxCount) * 100;
              const isBusinessHour = hour >= 8 && hour <= 18;
              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1" title={`${hour}:00 — ${count} bookings`}>
                  <div
                    className={`w-full rounded-t-sm ${isBusinessHour ? "bg-primary" : "bg-foreground/10"}`}
                    style={{ height: `${Math.max(pct, 2)}%`, minHeight: 2, opacity: isBusinessHour ? Math.max(0.2, pct / 100) : 0.3 }}
                  />
                  {(hour % 3 === 0) && (
                    <span className="font-mono text-[8px] text-foreground/30">{hour}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="font-mono text-[9px] text-foreground/20">12AM</span>
            <span className="font-mono text-[9px] text-primary/40">Business Hours (8AM-6PM)</span>
            <span className="font-mono text-[9px] text-foreground/20">11PM</span>
          </div>
        </div>
      )}

      {/* Top Customers */}
      {topCustomers && topCustomers.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-bold text-sm text-foreground tracking-wider">TOP CUSTOMERS BY REVENUE</h3>
            <span className="font-mono text-[10px] text-foreground/30">Lifetime value</span>
          </div>
          <div className="space-y-2">
            {topCustomers.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2 border-b border-border/10 last:border-0">
                <span className="font-heading font-bold text-lg text-foreground/20 w-8">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-heading font-bold text-sm text-foreground">{c.name}</span>
                  {c.phone && <span className="font-mono text-[10px] text-foreground/30 ml-2">{c.phone}</span>}
                </div>
                <div className="text-right">
                  <span className="font-heading font-bold text-sm text-primary">{formatCents(c.total)}</span>
                  <span className="font-mono text-[10px] text-foreground/30 block">{c.count} visits</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {(!stats?.revenueByDay || stats.revenueByDay.length === 0) && (
        <div className="bg-card border border-border/30 p-12 text-center">
          <DollarSign className="w-10 h-10 mx-auto mb-3 text-foreground/20" />
          <h3 className="font-heading font-bold text-foreground tracking-wider mb-2">NO REVENUE DATA YET</h3>
          <p className="font-mono text-xs text-foreground/40 max-w-md mx-auto">
            Revenue data populates when invoices are created — either manually, from ShopDriver imports, or from Stripe payments.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── INVOICE LIST VIEW ──────────────────────────────────
function InvoiceListView({ onCreateNew }: { onCreateNew: () => void }) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = trpc.invoices.list.useQuery({ search: search || undefined, limit: 50 });
  const utils = trpc.useUtils();

  const deleteInvoice = trpc.invoices.delete.useMutation({
    onSuccess: () => { utils.invoices.list.invalidate(); utils.invoices.stats.invalidate(); toast.success("Invoice deleted"); },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices by name, number, or service..."
            className="w-full bg-card border border-border/30 pl-10 pr-4 py-2 font-mono text-xs text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <button onClick={onCreateNew} className="px-4 py-2 bg-primary text-primary-foreground font-heading font-bold text-xs tracking-wider flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> CREATE
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (data?.items?.length ?? 0) === 0 ? (
        <div className="bg-card border border-border/30 p-12 text-center">
          <FileText className="w-8 h-8 mx-auto mb-3 text-foreground/20" />
          <h3 className="font-heading font-bold text-foreground tracking-wider mb-2">NO INVOICES</h3>
          <p className="font-mono text-xs text-foreground/40 mb-4">Create your first invoice to start tracking revenue.</p>
          <button onClick={onCreateNew} className="px-4 py-2 bg-primary text-primary-foreground font-heading font-bold text-xs tracking-wider">CREATE INVOICE</button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 font-mono text-[9px] text-foreground/30 tracking-wider uppercase">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Customer</div>
            <div className="col-span-3">Service</div>
            <div className="col-span-1">Method</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1">Amount</div>
            <div className="col-span-1">Date</div>
            <div className="col-span-1"></div>
          </div>
          {data?.items?.map((inv: any) => (
            <div key={inv.id} className="grid grid-cols-12 gap-2 items-center px-4 py-3 bg-card border border-border/20 hover:border-border/40 transition-colors">
              <div className="col-span-1 font-mono text-[10px] text-foreground/30">{inv.invoiceNumber || inv.id}</div>
              <div className="col-span-3">
                <span className="font-heading font-bold text-xs text-foreground block truncate">{inv.customerName}</span>
                {inv.customerPhone && <span className="font-mono text-[9px] text-foreground/30">{inv.customerPhone}</span>}
              </div>
              <div className="col-span-3 font-mono text-[10px] text-foreground/50 truncate">{inv.serviceDescription || "—"}</div>
              <div className="col-span-1">
                <span className="font-mono text-[9px] text-foreground/40 uppercase">{inv.paymentMethod}</span>
              </div>
              <div className="col-span-1">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 ${
                  inv.paymentStatus === "paid" ? "bg-emerald-500/20 text-emerald-400" :
                  inv.paymentStatus === "pending" ? "bg-amber-500/20 text-amber-400" :
                  inv.paymentStatus === "refunded" ? "bg-red-500/20 text-red-400" :
                  "bg-blue-500/20 text-blue-400"
                }`}>
                  {inv.paymentStatus?.toUpperCase()}
                </span>
              </div>
              <div className="col-span-1 font-heading font-bold text-sm text-primary">{formatCents(inv.totalAmount)}</div>
              <div className="col-span-1 font-mono text-[9px] text-foreground/30">
                {new Date(inv.invoiceDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
              <div className="col-span-1 flex items-center gap-1 justify-end">
                <button
                  onClick={() => {
                    if (confirm("Delete this invoice?")) deleteInvoice.mutate({ id: inv.id });
                  }}
                  className="p-1 text-foreground/20 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="text-center py-2">
            <span className="font-mono text-[9px] text-foreground/20">{data?.total ?? 0} total invoices</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CREATE INVOICE VIEW ────────────────────────────────
function CreateInvoiceView({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    serviceDescription: "",
    vehicleInfo: "",
    totalAmount: "",
    partsCost: "",
    laborCost: "",
    taxAmount: "",
    paymentMethod: "card" as const,
    paymentStatus: "paid" as const,
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().split("T")[0],
  });

  const createInvoice = trpc.invoices.create.useMutation({
    onSuccess: () => {
      toast.success("Invoice created");
      onDone();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!form.customerName.trim()) { toast.error("Customer name is required"); return; }
    if (!form.totalAmount) { toast.error("Total amount is required"); return; }
    createInvoice.mutate({
      customerName: form.customerName,
      customerPhone: form.customerPhone || undefined,
      serviceDescription: form.serviceDescription || undefined,
      vehicleInfo: form.vehicleInfo || undefined,
      totalAmount: Math.round(parseFloat(form.totalAmount) * 100),
      partsCost: form.partsCost ? Math.round(parseFloat(form.partsCost) * 100) : 0,
      laborCost: form.laborCost ? Math.round(parseFloat(form.laborCost) * 100) : 0,
      taxAmount: form.taxAmount ? Math.round(parseFloat(form.taxAmount) * 100) : 0,
      paymentMethod: form.paymentMethod,
      paymentStatus: form.paymentStatus,
      invoiceNumber: form.invoiceNumber || undefined,
      invoiceDate: form.invoiceDate,
      source: "manual",
    });
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-heading font-bold text-lg text-foreground tracking-wider">CREATE INVOICE</h3>
        <button onClick={onDone} className="text-foreground/40 hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Customer Name *" value={form.customerName} onChange={(v) => setForm(f => ({ ...f, customerName: v }))} placeholder="John Smith" />
          <FormField label="Phone" value={form.customerPhone} onChange={(v) => setForm(f => ({ ...f, customerPhone: v }))} placeholder="(216) 555-0123" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Vehicle" value={form.vehicleInfo} onChange={(v) => setForm(f => ({ ...f, vehicleInfo: v }))} placeholder="2019 Honda Civic" />
          <FormField label="Invoice #" value={form.invoiceNumber} onChange={(v) => setForm(f => ({ ...f, invoiceNumber: v }))} placeholder="INV-001" />
        </div>
        <FormField label="Service Description" value={form.serviceDescription} onChange={(v) => setForm(f => ({ ...f, serviceDescription: v }))} placeholder="Brake pad replacement, rotor resurfacing" />

        <div className="grid grid-cols-4 gap-4">
          <FormField label="Parts ($)" value={form.partsCost} onChange={(v) => setForm(f => ({ ...f, partsCost: v }))} placeholder="0.00" type="number" />
          <FormField label="Labor ($)" value={form.laborCost} onChange={(v) => setForm(f => ({ ...f, laborCost: v }))} placeholder="0.00" type="number" />
          <FormField label="Tax ($)" value={form.taxAmount} onChange={(v) => setForm(f => ({ ...f, taxAmount: v }))} placeholder="0.00" type="number" />
          <FormField label="Total ($) *" value={form.totalAmount} onChange={(v) => setForm(f => ({ ...f, totalAmount: v }))} placeholder="0.00" type="number" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="font-mono text-[10px] text-foreground/50 tracking-wider uppercase block mb-1">Payment Method</label>
            <select value={form.paymentMethod} onChange={(e) => setForm(f => ({ ...f, paymentMethod: e.target.value as any }))} className="w-full bg-background border border-border/30 px-3 py-2 font-mono text-xs text-foreground">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="financing">Financing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="font-mono text-[10px] text-foreground/50 tracking-wider uppercase block mb-1">Status</label>
            <select value={form.paymentStatus} onChange={(e) => setForm(f => ({ ...f, paymentStatus: e.target.value as any }))} className="w-full bg-background border border-border/30 px-3 py-2 font-mono text-xs text-foreground">
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          <div>
            <label className="font-mono text-[10px] text-foreground/50 tracking-wider uppercase block mb-1">Date</label>
            <input type="date" value={form.invoiceDate} onChange={(e) => setForm(f => ({ ...f, invoiceDate: e.target.value }))} className="w-full bg-background border border-border/30 px-3 py-2 font-mono text-xs text-foreground" />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleSubmit}
            disabled={createInvoice.isPending}
            className="px-6 py-2.5 bg-primary text-primary-foreground font-heading font-bold text-sm tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createInvoice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "CREATE INVOICE"}
          </button>
          <button onClick={onDone} className="px-6 py-2.5 border border-border/30 text-foreground/60 font-heading font-bold text-sm tracking-wider hover:text-foreground transition-colors">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FORM FIELD ─────────────────────────────────────────
function FormField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="font-mono text-[10px] text-foreground/50 tracking-wider uppercase block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-background border border-border/30 px-3 py-2 font-mono text-xs text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
      />
    </div>
  );
}

// ─── KPI CARD ───────────────────────────────────────────
function KPICard({ label, value, icon, trend, trendLabel, color = "text-foreground" }: {
  label: string; value: string | number; icon: React.ReactNode; trend?: number; trendLabel?: string; color?: string;
}) {
  return (
    <div className="bg-card border border-border/30 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="font-mono text-[10px] text-foreground/50 tracking-wider uppercase">{label}</span>
        <div className="text-foreground/30">{icon}</div>
      </div>
      <div className={`font-heading font-bold text-3xl tracking-tight ${color}`}>{value}</div>
      {trendLabel && (
        <div className={`mt-2 flex items-center gap-1 font-mono text-[10px] tracking-wider ${
          trend !== undefined ? (trend > 0 ? "text-emerald-400" : trend < 0 ? "text-red-400" : "text-foreground/40") : "text-foreground/40"
        }`}>
          {trend !== undefined && trend > 0 && <ArrowUpRight className="w-3 h-3" />}
          {trend !== undefined && trend < 0 && <ArrowDownRight className="w-3 h-3" />}
          {trend !== undefined && trend === 0 && <Minus className="w-3 h-3" />}
          {trendLabel}
        </div>
      )}
    </div>
  );
}

// ─── MINI KPI ───────────────────────────────────────────
function MiniKPI({ label, value, sub, alert = false }: { label: string; value: number; sub: string; alert?: boolean }) {
  return (
    <div className={`bg-card border p-3 ${alert ? "border-red-500/30" : "border-border/30"}`}>
      <span className="font-mono text-[9px] text-foreground/40 tracking-wider uppercase block">{label}</span>
      <span className={`font-heading font-bold text-2xl ${alert ? "text-red-400" : "text-foreground"}`}>{value}</span>
      <span className="font-mono text-[9px] text-foreground/30 ml-1">{sub}</span>
    </div>
  );
}
