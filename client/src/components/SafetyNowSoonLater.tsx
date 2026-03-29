/**
 * SafetyNowSoonLater — Priority triage framework for repairs.
 * Converts "you need all this done" anxiety into a clear, honest roadmap.
 * Used on service pages and after diagnostic results are presented.
 * Three buckets: Fix Now (safety), Fix Soon (reliability), Monitor (watch).
 */
import { AlertTriangle, Clock, Eye } from "lucide-react";

export interface RepairItem {
  label: string;
  reason?: string;
}

export interface SafetyNowSoonLaterProps {
  now?: RepairItem[];
  soon?: RepairItem[];
  monitor?: RepairItem[];
  /** Optional context note at the top */
  contextNote?: string;
}

const TIERS = [
  {
    key: "now" as const,
    icon: AlertTriangle,
    label: "Fix Now",
    sublabel: "Safety-critical",
    colorClass: "border-rose-500/30 bg-rose-950/20",
    iconClass: "text-rose-400",
    badgeClass: "bg-rose-500/15 text-rose-400",
  },
  {
    key: "soon" as const,
    icon: Clock,
    label: "Fix Soon",
    sublabel: "Within 30–90 days",
    colorClass: "border-amber-500/30 bg-amber-950/15",
    iconClass: "text-amber-400",
    badgeClass: "bg-amber-500/15 text-amber-400",
  },
  {
    key: "monitor" as const,
    icon: Eye,
    label: "Monitor",
    sublabel: "Watch at next visit",
    colorClass: "border-border/25 bg-[oklch(0.07_0.004_260)]",
    iconClass: "text-foreground/40",
    badgeClass: "bg-foreground/10 text-foreground/50",
  },
];

export default function SafetyNowSoonLater({
  now = [],
  soon = [],
  monitor = [],
  contextNote,
}: SafetyNowSoonLaterProps) {
  const items = { now, soon, monitor };
  const activeTiers = TIERS.filter((t) => items[t.key].length > 0);

  if (!activeTiers.length) return null;

  return (
    <div className="space-y-3">
      {contextNote && (
        <p className="text-xs text-foreground/40 leading-relaxed">{contextNote}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {activeTiers.map((tier) => {
          const TierIcon = tier.icon;
          const tierItems = items[tier.key];
          return (
            <div
              key={tier.key}
              className={`rounded-xl border p-4 ${tier.colorClass}`}
            >
              {/* Header */}
              <div className="flex items-center gap-2 mb-3">
                <TierIcon className={`w-4 h-4 ${tier.iconClass} shrink-0`} />
                <div>
                  <p className="text-sm font-semibold text-foreground/90 leading-none">
                    {tier.label}
                  </p>
                  <p className="text-[10px] text-foreground/40 mt-0.5">{tier.sublabel}</p>
                </div>
              </div>

              {/* Items */}
              <ul className="space-y-2">
                {tierItems.map((item) => (
                  <li key={item.label} className="text-xs">
                    <span className="font-medium text-foreground/80">{item.label}</span>
                    {item.reason && (
                      <span className="block text-foreground/45 mt-0.5">{item.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-foreground/35 leading-relaxed">
        All priorities reviewed and explained before work begins. You decide what to do and when.
      </p>
    </div>
  );
}
