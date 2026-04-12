/**
 * WhatToExpectAtYourVisit — Reduces first-visit anxiety with a step-by-step
 * walkthrough of exactly what happens from arrival to pickup.
 * Answers the unspoken question: "Will I be stuck there? Will I be confused?"
 * Used on service pages near the booking form.
 */
import { MapPin, ClipboardList, Phone, Key } from "lucide-react";

export interface VisitStep {
  icon: React.ElementType;
  heading: string;
  detail: string;
}

interface WhatToExpectAtYourVisitProps {
  steps?: VisitStep[];
  heading?: string;
}

const DEFAULT_STEPS: VisitStep[] = [
  {
    icon: MapPin,
    heading: "Arrive — walk-ins welcome",
    detail: "Drive in anytime Mon–Sat 8–6, Sun 9–4. No appointment needed for most services.",
  },
  {
    icon: ClipboardList,
    heading: "Quick intake — 5 minutes",
    detail: "Tell us what you're noticing. We write it down and ask a few questions. No jargon.",
  },
  {
    icon: Phone,
    heading: "We call you with the full picture",
    detail:
      "Before any work starts we explain what we found, show photos if needed, and give you the exact price. You approve — then we begin.",
  },
  {
    icon: Key,
    heading: "Pick up — same day most repairs",
    detail: "Most jobs are ready same day. We text or call when it's done. Pay what was quoted.",
  },
];

export default function WhatToExpectAtYourVisit({
  steps = DEFAULT_STEPS,
  heading = "What to expect at your visit",
}: WhatToExpectAtYourVisitProps) {
  return (
    <div className="rounded-xl border border-border/25 bg-[oklch(0.07_0.004_260)] overflow-hidden">
      <div className="px-6 py-4 border-b border-border/20">
        <p className="text-sm font-semibold text-foreground/90">{heading}</p>
      </div>

      <div className="divide-y divide-border/15">
        {steps.map((step, i) => {
          const StepIcon = step.icon;
          return (
            <div key={step.heading} className="flex items-start gap-4 px-6 py-4">
              {/* Step number + icon */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <span className="font-mono text-xs font-bold text-primary/50">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <StepIcon className="w-4 h-4 text-primary/50" />
              </div>
              {/* Content */}
              <div>
                <p className="text-sm font-semibold text-foreground/85 leading-snug">
                  {step.heading}
                </p>
                <p className="mt-0.5 text-xs text-foreground/70 leading-relaxed">{step.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
