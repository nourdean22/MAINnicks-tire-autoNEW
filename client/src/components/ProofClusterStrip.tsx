/**
 * ProofClusterStrip — Compact horizontal strip of trust tags + quote snippets.
 * Designed to be slipped between sections (after hero, before CTA, after FAQ).
 * Zero JS dependencies beyond React. No CLS risk — fixed height strip.
 */
import { Star, CheckCircle2, Quote } from "lucide-react";
import type { TrustTag, ProofQuote } from "@shared/proof";
import { BUSINESS } from "@shared/business";

interface ProofClusterStripProps {
  trustTags?: TrustTag[];
  /** Single featured quote pulled from the config */
  spotlight?: ProofQuote;
  /** Show the global rating + review count */
  showRating?: boolean;
}

export default function ProofClusterStrip({
  trustTags,
  spotlight,
  showRating = true,
}: ProofClusterStripProps) {
  return (
    <div className="border-y border-border/20 bg-[oklch(0.06_0.003_260)] py-6">
      <div className="container">
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6 lg:gap-10">

          {/* Rating pill */}
          {showRating && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-nick-yellow text-nick-yellow" />
                ))}
              </div>
              <span className="font-mono text-sm font-bold text-nick-yellow">4.9</span>
              <span className="text-xs text-foreground/70">
                {BUSINESS.reviews.countDisplay} reviews
              </span>
            </div>
          )}

          {/* Trust tags */}
          {trustTags && trustTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {trustTags.map((tag) => (
                <div key={tag.label} className="flex items-center gap-1.5 text-xs font-medium text-foreground/70 bg-background/40 border border-border/30 rounded-full px-3 py-1">
                  <CheckCircle2 className="w-3 h-3 text-primary/60 shrink-0" />
                  <span>{tag.label}</span>
                  {tag.stat && <span className="text-foreground/70 ml-0.5">· {tag.stat}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Spotlight quote */}
          {spotlight && (
            <div className="lg:ml-auto lg:max-w-sm flex items-start gap-3 lg:border-l lg:border-border/20 lg:pl-10">
              <Quote className="w-4 h-4 text-primary/30 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-foreground/70 leading-relaxed line-clamp-2">{spotlight.text}</p>
                <p className="mt-1 text-xs font-semibold text-foreground/70">— {spotlight.author}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
