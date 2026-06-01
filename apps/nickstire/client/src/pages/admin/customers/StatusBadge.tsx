import { AlertTriangle, Crown, ShieldAlert } from "lucide-react";

/** VIP / At-Risk / Lost badge based on metrics */
export function StatusBadge({ isVip, churnRisk, daysSinceLastVisit, totalVisits }: {
  isVip?: number | null;
  churnRisk?: string | null;
  daysSinceLastVisit?: number | null;
  totalVisits: number;
}) {
  // VIP: 3+ visits or explicitly flagged
  if (isVip || totalVisits >= 3) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <Crown className="w-2.5 h-2.5" /> VIP
      </span>
    );
  }
  // Lost: 365+ days
  if (daysSinceLastVisit && daysSinceLastVisit > 365) {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-wider bg-red-500/10 text-red-400 border border-red-500/20">
        <ShieldAlert className="w-2.5 h-2.5" /> LOST
      </span>
    );
  }
  // At Risk: 90-365 days or high churn
  if ((daysSinceLastVisit && daysSinceLastVisit > 90) || churnRisk === "high") {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <AlertTriangle className="w-2.5 h-2.5" /> AT RISK
      </span>
    );
  }
  return null;
}
