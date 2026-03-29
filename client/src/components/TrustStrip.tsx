/**
 * TrustStrip — Slim trust bar placed directly below the hero section.
 * Anchors the visitor's first scroll with rating, review count, years in business,
 * and a no-pressure signal. Zero JS for interactivity — pure render.
 * Target: <1KB rendered HTML. No CLS (fixed height, no dynamic content).
 */
import { Star, Shield, Clock, ThumbsUp } from "lucide-react";
import { BUSINESS } from "@shared/business";

const SIGNALS = [
  {
    icon: Star,
    value: "4.9 Stars",
    sub: `${BUSINESS.reviews.countDisplay}+ Google Reviews`,
    iconClass: "text-nick-yellow",
  },
  {
    icon: Clock,
    value: "7 Days a Week",
    sub: `${BUSINESS.hours.display}`,
    iconClass: "text-primary",
  },
  {
    icon: Shield,
    value: "Family Owned",
    sub: "Cleveland's Trusted Shop",
    iconClass: "text-primary",
  },
  {
    icon: ThumbsUp,
    value: "No-Pressure",
    sub: "Free estimates · You decide",
    iconClass: "text-primary",
  },
];

export default function TrustStrip() {
  return (
    <div className="border-b border-border/20 bg-[oklch(0.055_0.003_260)] py-4">
      <div className="container">
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 lg:justify-between">
          {SIGNALS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.value} className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 shrink-0 ${s.iconClass}`} />
                <div>
                  <span className="text-sm font-bold text-foreground/90">{s.value}</span>
                  <span className="hidden sm:inline text-foreground/40 text-xs ml-2">{s.sub}</span>
                  <span className="sm:hidden block text-foreground/40 text-[10px] leading-tight">
                    {s.sub}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
