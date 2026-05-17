/**
 * WhatAffectsPrice — Transparent cost education block.
 * Explains the real variables behind service pricing BEFORE the customer
 * sees the estimate. Converts sticker shock into informed trust.
 * Per-service factors are configurable via the `factors` prop.
 */
import { Info } from "lucide-react";

export interface PriceFactor {
  label: string;
  detail: string;
  impact: "low" | "medium" | "high";
}

interface WhatAffectsPriceProps {
  service: string;
  factors: PriceFactor[];
  /**
   * Bottom-line reassurance — e.g.
   * "All of these are visible in your written estimate before any work begins."
   */
  reassurance?: string;
}

const IMPACT_COLORS: Record<PriceFactor["impact"], string> = {
  low: "text-emerald-400 bg-emerald-400/10",
  medium: "text-amber-400 bg-amber-400/10",
  high: "text-rose-400 bg-rose-400/10",
};

const IMPACT_LABELS: Record<PriceFactor["impact"], string> = {
  low: "Low impact",
  medium: "Mid impact",
  high: "High impact",
};

export default function WhatAffectsPrice({
  service,
  factors,
  reassurance,
}: WhatAffectsPriceProps) {
  return (
    <div className="rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Info className="w-4 h-4 text-foreground/70 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-foreground/90">
            What affects the price of {service}
          </p>
          <p className="mt-0.5 text-xs text-foreground/70">
            We break this down so there are zero surprises in your estimate.
          </p>
        </div>
      </div>

      {/* Factor list */}
      <div className="space-y-3">
        {factors.map((f) => (
          <div key={f.label} className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground/80 leading-snug">{f.label}</p>
              <p className="mt-0.5 text-xs text-foreground/45 leading-relaxed">{f.detail}</p>
            </div>
            <span
              className={`shrink-0 text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full ${IMPACT_COLORS[f.impact]}`}
            >
              {IMPACT_LABELS[f.impact]}
            </span>
          </div>
        ))}
      </div>

      {/* Reassurance footer */}
      {reassurance && (
        <p className="pt-3 border-t border-border/20 text-xs text-foreground/70 leading-relaxed">
          {reassurance}
        </p>
      )}
    </div>
  );
}

// ─── SERVICE-SPECIFIC FACTOR CONFIGS ─────────────────────
export const PRICE_FACTORS: Record<string, PriceFactor[]> = {
  brakes: [
    {
      label: "Pads only vs. pads + rotors",
      detail: "Worn rotors can't always be resurfaced. We measure thickness and show you.",
      impact: "high",
    },
    {
      label: "Front vs. rear axle",
      detail: "Front brakes wear faster and are typically priced per axle.",
      impact: "medium",
    },
    {
      label: "Caliper condition",
      detail: "Seized calipers add labor and parts. Common on older vehicles.",
      impact: "medium",
    },
    {
      label: "Vehicle make and model",
      detail: "Some parts are simply more expensive for certain vehicles.",
      impact: "low",
    },
  ],
  diagnostics: [
    {
      label: "Scan vs. full diagnostic",
      detail: "Code reading gives codes. Full diagnostics finds the root cause.",
      impact: "medium",
    },
    {
      label: "Number of fault codes",
      detail: "Multiple codes may indicate a cascade from one root issue.",
      impact: "medium",
    },
    {
      label: "Intermittent vs. constant fault",
      detail: "Intermittent faults require more time to diagnose accurately.",
      impact: "high",
    },
  ],
  emissions: [
    {
      label: "Root cause of failure",
      detail: "O2 sensor vs. catalytic converter vs. EGR — costs vary widely.",
      impact: "high",
    },
    {
      label: "Vehicle age and mileage",
      detail: "Older high-mileage vehicles may need multiple components.",
      impact: "medium",
    },
    {
      label: "Waiver eligibility",
      detail: "Vehicles meeting criteria may qualify for an E-Check waiver instead.",
      impact: "high",
    },
  ],
  "oil-change": [
    {
      label: "Oil type: conventional vs. synthetic",
      detail: "Synthetic costs more but is required for many newer engines.",
      impact: "medium",
    },
    {
      label: "Oil capacity",
      detail: "Trucks and SUVs with larger engines require more oil.",
      impact: "low",
    },
    {
      label: "Filter type",
      detail: "Some vehicles require specialty filters that cost more.",
      impact: "low",
    },
  ],
  tires: [
    {
      label: "Tire brand and model",
      detail: "Budget, mid-range, and performance tires vary significantly in cost.",
      impact: "high",
    },
    {
      label: "Tire size",
      detail: "Larger or low-profile tires cost more to buy and mount.",
      impact: "medium",
    },
    {
      label: "TPMS sensor condition",
      detail: "Old or faulty sensors need replacement at time of tire change.",
      impact: "low",
    },
    {
      label: "New vs. quality used",
      detail: "Quality used tires are available for budget-conscious customers.",
      impact: "high",
    },
  ],
  "general-repair": [
    {
      label: "Parts availability",
      detail: "OEM vs. aftermarket, and whether parts need to be ordered.",
      impact: "medium",
    },
    {
      label: "Labor time",
      detail: "Access difficulty varies — some repairs take 1 hour, others 4.",
      impact: "high",
    },
    {
      label: "What else is found",
      detail: "We prioritize items and explain what's urgent vs. what can wait.",
      impact: "medium",
    },
  ],
};
