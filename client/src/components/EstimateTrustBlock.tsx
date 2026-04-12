/**
 * EstimateTrustBlock — The antidote to sticker shock.
 * Shows the actual estimate promise: price locked before work starts,
 * no surprise add-ons, and what happens if something unexpected comes up.
 * Place this immediately before or after the booking form on service pages.
 */
import { Lock, Phone, FileText } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { trackPhoneClick } from "@/components/SEO";

interface EstimateTrustBlockProps {
  service?: string;
  /** Override the default note line */
  noteOverride?: string;
}

const DEFAULT_PROMISES = [
  {
    icon: FileText,
    heading: "Written estimate before any work",
    detail: "We show you the quote. You approve it. Work begins only after you say yes.",
  },
  {
    icon: Lock,
    heading: "Price locked at approval",
    detail: "If we discover something unexpected, we call you first. No surprises on your bill.",
  },
  {
    icon: Phone,
    heading: "You can say no at any point",
    detail: "Approve part of the repair now. Come back for the rest. No pressure, ever.",
  },
];

export default function EstimateTrustBlock({ service, noteOverride }: EstimateTrustBlockProps) {
  const note =
    noteOverride ??
    (service
      ? `Free estimate on all ${service} work. Call or walk in.`
      : "Free estimates on all repair work. No obligation.");

  return (
    <div className="rounded-2xl border border-border/30 bg-[oklch(0.07_0.004_260)] overflow-hidden">
      {/* Header strip */}
      <div className="flex items-center gap-3 px-6 py-4 bg-primary/5 border-b border-border/20">
        <Lock className="w-4 h-4 text-primary shrink-0" />
        <p className="text-sm font-semibold tracking-wide text-foreground/90">
          Our Estimate Promise
        </p>
      </div>

      {/* Promise list */}
      <div className="divide-y divide-border/15">
        {DEFAULT_PROMISES.map((p) => (
          <div key={p.heading} className="flex items-start gap-4 px-6 py-4">
            <p.icon className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground/90 leading-snug">{p.heading}</p>
              <p className="mt-0.5 text-xs text-foreground/70 leading-relaxed">{p.detail}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <div className="px-6 py-3 bg-primary/5 border-t border-border/20">
        <p className="text-xs text-foreground/70">
          {note}{" "}
          <a
            href={BUSINESS.phone.href}
            onClick={() => trackPhoneClick("estimate-trust-block")}
            className="text-primary hover:opacity-80 transition-opacity font-semibold"
          >
            {BUSINESS.phone.display}
          </a>
        </p>
      </div>
    </div>
  );
}
