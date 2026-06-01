import React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";

// ─── KPI CARD ───────────────────────────────────────────
export function KPICard({ label, value, icon, trend, trendLabel, color = "text-foreground" }: {
  label: string; value: string | number; icon: React.ReactNode; trend?: number; trendLabel?: string; color?: string;
}) {
  return (
    <div className="glow-on-hover bg-card border border-border/30 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium">{label}</span>
        <div className="text-foreground/30">{icon}</div>
      </div>
      <div className={`font-bold text-3xl tracking-tight ${color}`}>{value}</div>
      {trendLabel && (
        <div className={`mt-2 flex items-center gap-1 text-[10px] tracking-wider ${
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
