import { Loader2 } from "lucide-react";

export function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function pct(n: number): string {
  return n.toFixed(1) + "%";
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-5 h-5 animate-spin text-primary" />
    </div>
  );
}

export function SectionSpinner() {
  return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="w-4 h-4 animate-spin text-foreground/30" />
    </div>
  );
}

export function NoData({ label = "No data yet" }: { label?: string }) {
  return (
    <div className="text-[11px] text-foreground/30 py-6 text-center tracking-wide">{label}</div>
  );
}

export function EngineCard({ title, icon, children, border }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  border?: string;
}) {
  return (
    <div className={`bg-card border p-5 ${border || "border-border/30"}`}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function MiniTable({ headers, rows }: {
  headers: string[];
  rows: (string | number | React.ReactNode)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-foreground/40 border-b border-border/20">
            {headers.map((h) => (
              <th key={h} className="text-left py-1.5 pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/10 hover:bg-foreground/[0.02] transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="py-2 pr-3 text-foreground/70">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function riskColor(level: string): string {
  const l = level?.toLowerCase();
  if (l === "high" || l === "critical") return "text-red-400 bg-red-500/10";
  if (l === "medium" || l === "warning") return "text-amber-400 bg-amber-500/10";
  return "text-emerald-400 bg-emerald-500/10";
}

export function Badge({ label, level }: { label: string; level: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${riskColor(level)}`}>
      {label}
    </span>
  );
}

export const STALE_TIME = 120_000;
