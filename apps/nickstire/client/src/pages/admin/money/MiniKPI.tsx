// ─── MINI KPI ───────────────────────────────────────────
export function MiniKPI({ label, value, sub, alert = false }: { label: string; value: number; sub: string; alert?: boolean }) {
  return (
    <div className={`bg-card border p-3 ${alert ? "border-red-500/30" : "border-border/30"}`}>
      <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium block">{label}</span>
      <span className={`font-bold text-2xl ${alert ? "text-red-400" : "text-foreground"}`}>{value}</span>
      <span className="font-mono text-[9px] text-foreground/30 ml-1">{sub}</span>
    </div>
  );
}
