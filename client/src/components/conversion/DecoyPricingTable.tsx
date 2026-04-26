/**
 * DecoyPricingTable — 3-tier pricing renderer using the decoy effect.
 *
 * Behavioral economics: when given 3 choices, most people pick the middle
 * one. The cheapest tier is the "anchor" (makes the middle look reasonable),
 * the highest is the "decoy" (makes the middle look like a deal). The
 * MIDDLE is always the funnel target.
 *
 * Per the conversion-overhaul spec (`docs/CONVERSION-OVERHAUL-V1.1.md`):
 *   - Always render the middle tier as `featured` for visual emphasis.
 *   - Optional comparison row above the tiers ("Dealer: $800 · Chain: $600").
 *   - Optional CTA per-tier or a single CTA below.
 */
import { Check, Sparkles } from "lucide-react";
import { Link } from "wouter";

export interface PricingTier {
  name: string;
  price: string;
  /** Sub-text under price, e.g. "per axle, most vehicles". */
  sub?: string;
  /** Plain-text "use this when..." line shown below the tier. */
  use?: string;
  /** Bullet-list of what's included. */
  includes?: string[];
  /** Highlight as the funnel target. The middle tier should usually have this. */
  featured?: boolean;
  /** Per-tier CTA href. Falls back to the table-level cta. */
  ctaHref?: string;
  /** Per-tier CTA label. */
  ctaLabel?: string;
}

export interface AnchorPrice {
  label: string;       // "Dealer", "Chain shop"
  price: string;       // "$800"
  strikethrough?: boolean; // visually crossed-out
}

interface Props {
  /** Service name/category (e.g., "Brake Repair"). Shown above the table. */
  serviceName?: string;
  /** Optional anchor prices shown ABOVE the tiers (e.g., dealer + chain). */
  anchors?: AnchorPrice[];
  /** Three-tier pricing (in display order: budget / featured / premium). */
  tiers: [PricingTier, PricingTier, PricingTier];
  /** Default CTA href when a tier doesn't specify its own. */
  ctaHref?: string;
  /** Default CTA label. */
  ctaLabel?: string;
  /** Optional foot note (e.g., "All prices include installation."). */
  footnote?: string;
}

export default function DecoyPricingTable({
  serviceName,
  anchors,
  tiers,
  ctaHref = "/booking",
  ctaLabel = "BOOK THIS SERVICE",
  footnote,
}: Props) {
  return (
    <section className="my-8">
      {serviceName && (
        <div className="text-[11px] font-bold tracking-widest text-primary uppercase mb-2">
          {serviceName} · Transparent pricing
        </div>
      )}

      {/* Anchor row: dealer / chain prices crossed out */}
      {anchors && anchors.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 mb-4 text-sm text-foreground/60">
          {anchors.map((a, i) => (
            <span key={i} className="inline-flex items-baseline gap-1.5">
              <span className="text-[11px] uppercase tracking-wide text-foreground/40">{a.label}:</span>
              <span className={`font-mono ${a.strikethrough ? "line-through opacity-60" : "font-semibold"}`}>{a.price}</span>
            </span>
          ))}
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-[11px] uppercase tracking-wide text-emerald-400">Nick's:</span>
            <span className="font-mono font-bold text-emerald-400">starts below</span>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tiers.map((tier, i) => (
          <div
            key={i}
            className={`relative rounded-lg border p-5 transition-shadow ${
              tier.featured
                ? "border-primary/60 bg-primary/5 shadow-lg shadow-primary/10 ring-1 ring-primary/30"
                : "border-border/30 bg-card/40"
            }`}
          >
            {tier.featured && (
              <div className="absolute -top-2.5 left-4 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[9px] font-bold tracking-widest text-primary-foreground uppercase">
                <Sparkles className="w-3 h-3" /> Most Popular
              </div>
            )}

            <div className="text-[11px] font-bold tracking-wide text-foreground/60 uppercase mb-2">{tier.name}</div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`font-bold text-3xl tracking-tight ${tier.featured ? "text-primary" : "text-foreground"}`}>
                {tier.price}
              </span>
            </div>
            {tier.sub && <div className="text-[11px] text-foreground/50 mb-3">{tier.sub}</div>}
            {tier.use && (
              <div className="text-[12px] text-foreground/70 leading-relaxed mb-3 italic">{tier.use}</div>
            )}
            {tier.includes && tier.includes.length > 0 && (
              <ul className="space-y-1 mb-4">
                {tier.includes.map((inc, j) => (
                  <li key={j} className="flex items-start gap-2 text-[12px] text-foreground/70">
                    <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tier.featured ? "text-primary" : "text-emerald-400"}`} />
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={tier.ctaHref || ctaHref}
              className={`mt-2 inline-flex w-full items-center justify-center rounded px-3 py-2 text-xs font-bold tracking-wide transition-colors ${
                tier.featured
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-foreground/30 text-foreground/80 hover:border-primary hover:text-primary"
              }`}
            >
              {tier.ctaLabel || ctaLabel}
            </Link>
          </div>
        ))}
      </div>

      {footnote && (
        <p className="mt-3 text-[11px] text-foreground/40 italic">{footnote}</p>
      )}
    </section>
  );
}
