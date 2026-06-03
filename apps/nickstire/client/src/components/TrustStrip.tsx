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
    value: `${BUSINESS.reviews.rating} Stars`,
    sub: `${BUSINESS.reviews.countDisplay} Google Reviews`,
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
    value: "Family-Run",
    sub: "On Euclid since 2018",
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
    <div className="relative border-b border-border/20 bg-[oklch(0.055_0.003_260)] py-4 overflow-hidden">
      {/* Subtle atmospheric brand-sign image behind the trust signals.
          Heavy darkening keeps text readable; the slight texture makes the
          strip feel like part of the actual shop instead of a generic UI band. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: "url('/brand-sign.webp')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.055_0.003_260)]/95 via-[oklch(0.055_0.003_260)]/80 to-[oklch(0.055_0.003_260)]/95 pointer-events-none" />
      <div className="relative container">
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 lg:justify-between">
          {SIGNALS.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.value} className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 shrink-0 ${s.iconClass}`} />
                <div>
                  <span className="text-sm font-bold text-foreground/90">{s.value}</span>
                  <span className="hidden sm:inline text-foreground/70 text-xs ml-2">{s.sub}</span>
                  <span className="sm:hidden block text-foreground/70 text-[10px] leading-tight">
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
