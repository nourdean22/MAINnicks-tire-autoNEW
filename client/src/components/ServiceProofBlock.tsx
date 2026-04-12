/**
 * ServiceProofBlock — 2–3 featured quotes placed near the CTA on service pages.
 * Where doubt peaks (just before the customer decides to book), this block
 * neutralizes fear with voice-of-customer language, not marketing copy.
 */
import { Star, Quote } from "lucide-react";
import type { ProofQuote } from "@shared/proof";

interface ServiceProofBlockProps {
  quotes: ProofQuote[];
  heading?: string;
}

export default function ServiceProofBlock({ quotes, heading }: ServiceProofBlockProps) {
  if (!quotes.length) return null;

  return (
    <div className="space-y-4">
      {heading && (
        <p className="text-xs font-semibold tracking-[0.12em] uppercase text-foreground/70">{heading}</p>
      )}
      <div className={`grid gap-4 ${quotes.length === 1 ? "" : quotes.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {quotes.map((q, i) => (
          <ProofCard key={i} quote={q} />
        ))}
      </div>
    </div>
  );
}

function ProofCard({ quote }: { quote: ProofQuote }) {
  return (
    <div className="flex flex-col gap-3 bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-xl p-5">
      {/* Stars */}
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className="w-3.5 h-3.5 fill-nick-yellow text-nick-yellow" />
        ))}
      </div>

      {/* Quote text */}
      <Quote className="w-4 h-4 text-primary/30 shrink-0 -mb-1" />
      <p className="text-sm text-foreground/80 leading-relaxed flex-1">{quote.text}</p>

      {/* Attribution */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/20">
        <span className="text-sm font-semibold text-foreground/70">{quote.author}</span>
        {quote.badge && (
          <span className="text-[10px] font-semibold tracking-wide uppercase text-primary/70 bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
            {quote.badge}
          </span>
        )}
      </div>
    </div>
  );
}
