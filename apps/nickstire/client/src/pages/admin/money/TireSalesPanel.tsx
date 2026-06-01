import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Activity, Phone } from "lucide-react";

// ─── TIRE SALES PANEL (wave-99) ────────────────────────────
// Aggregates invoices where serviceDescription matches "tire" — gives
// operator visibility into tire-specific revenue without needing
// per-line-item data (which ALG's REST API doesn't expose).
export function TireSalesPanel() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = trpc.invoices.tireSalesReport.useQuery({ months });
  if (isLoading || !data) return null;
  const { totals, byMonth, topJobs, topCustomers } = data;
  if (totals.jobs === 0) return null;

  const maxMonthRevenue = Math.max(...byMonth.map((m) => m.revenue), 1);

  return (
    <div className="bg-card border border-border/30">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-foreground tracking-wider">TIRE SALES REPORT</h3>
            <p className="text-[10px] text-foreground/40">
              From invoices with "tire" in service description ({months}-month window)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {[3, 6, 12, 24].map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`px-2.5 py-1 text-[10px] tracking-wider transition-colors ${
                months === m
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-card border border-border/30 text-foreground/40 hover:text-foreground/60"
              }`}
            >
              {m}M
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border/10">
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">TIRE REVENUE</span>
          <span className="font-bold text-2xl text-emerald-400">${totals.revenue.toLocaleString()}</span>
        </div>
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">TIRE JOBS</span>
          <span className="font-bold text-2xl text-foreground">{totals.jobs.toLocaleString()}</span>
        </div>
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">AVG TICKET</span>
          <span className="font-bold text-2xl text-blue-400">${totals.avgTicket.toLocaleString()}</span>
        </div>
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">UNIQUE CUSTOMERS</span>
          <span className="font-bold text-2xl text-purple-400">{totals.uniqueCustomers.toLocaleString()}</span>
        </div>
      </div>

      {/* Monthly bar chart + top jobs side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border/10">
        {/* Monthly trend */}
        <div className="bg-card p-5">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">MONTHLY REVENUE</span>
          {byMonth.length === 0 ? (
            <p className="text-[11px] text-foreground/30 italic">No tire jobs in window</p>
          ) : (
            <div className="space-y-1.5">
              {byMonth.slice().reverse().slice(0, 12).map((m) => {
                const pct = (m.revenue / maxMonthRevenue) * 100;
                return (
                  <div key={m.month} className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-foreground/40 w-14 shrink-0">{m.month}</span>
                    <div className="flex-1 h-4 bg-foreground/5 relative">
                      <div className="h-full bg-emerald-500/40" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[9px] text-emerald-400 w-16 text-right">${m.revenue.toLocaleString()}</span>
                    <span className="font-mono text-[9px] text-foreground/40 w-8 text-right">{m.jobs}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top jobs */}
        <div className="bg-card p-5">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">TOP TIRE JOBS</span>
          {topJobs.length === 0 ? (
            <p className="text-[11px] text-foreground/30 italic">No tire jobs in window</p>
          ) : (
            <div className="space-y-1.5">
              {topJobs.slice(0, 10).map((j) => (
                <div key={j.description} className="flex items-center gap-2 py-1 border-b border-border/10">
                  <span className="text-[11px] text-foreground/70 flex-1 truncate">{j.description}</span>
                  <span className="font-mono text-[9px] text-foreground/40 w-8 text-right">{j.jobs}</span>
                  <span className="font-mono text-[10px] text-emerald-400 w-16 text-right">${j.revenue.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top tire customers */}
      <div className="bg-card p-5 border-t border-border/10">
        <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">TOP TIRE CUSTOMERS</span>
        {topCustomers.length === 0 ? (
          <p className="text-[11px] text-foreground/30 italic">No tire customers in window</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {topCustomers.slice(0, 10).map((c, i: number) => (
              <div key={i} className="flex items-center gap-2 py-1 border-b border-border/10">
                <span className="font-mono text-[9px] text-foreground/30 w-4">{i + 1}</span>
                <span className="text-[11px] text-foreground flex-1 truncate">{c.customerName}</span>
                {c.customerPhone && (
                  <a href={`tel:${c.customerPhone}`} className="text-foreground/30 hover:text-primary" onClick={e => e.stopPropagation()} title={c.customerPhone}>
                    <Phone className="w-3 h-3" />
                  </a>
                )}
                <span className="font-mono text-[9px] text-foreground/40 w-8 text-right">{c.jobs}</span>
                <span className="font-mono text-[10px] text-emerald-400 w-16 text-right">${c.spent.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
