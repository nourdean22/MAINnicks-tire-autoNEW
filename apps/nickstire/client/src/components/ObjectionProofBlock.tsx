/**
 * ObjectionProofBlock — Addresses a specific customer fear inline.
 * Drop this immediately after a section that triggers doubt:
 *   - After the cost breakdown section → show price objection quotes
 *   - After the process section → show trust objection quotes
 *   - On financing page → show stress/embarrassment quotes
 *
 * These are positioned WHERE the doubt lives, not at the page bottom.
 */
import { Star, CheckCircle2 } from "lucide-react";
import type { ProofQuote } from "@shared/proof";

interface ObjectionProofBlockProps {
  /** The fear this block is neutralizing */
  objectionLabel: string;
  quotes: ProofQuote[];
  /** Optional stat that reinforces the message */
  statLine?: string;
}

export default function ObjectionProofBlock({
  objectionLabel,
  quotes,
  statLine,
}: ObjectionProofBlockProps) {
  if (!quotes.length) return null;

  return (
    <div className="mt-10 rounded-2xl border border-nick-yellow/15 bg-[oklch(0.07_0.008_70/0.6)] p-6 lg:p-8">
      {/* Label */}
      <div className="flex items-center gap-2 mb-5">
        <CheckCircle2 className="w-4 h-4 text-nick-yellow shrink-0" />
        <p className="text-xs font-semibold tracking-[0.12em] uppercase text-nick-yellow/80">
          {objectionLabel}
        </p>
      </div>

      {/* Quotes */}
      <div className="space-y-4">
        {quotes.slice(0, 2).map((q, i) => (
          <div key={i} className={i > 0 ? "pt-4 border-t border-border/20" : ""}>
            <div className="flex items-center gap-0.5 mb-2">
              {Array.from({ length: 5 }).map((_, j) => (
                <Star key={j} className="w-3 h-3 fill-nick-yellow text-nick-yellow" />
              ))}
            </div>
            <p className="text-sm text-foreground/80 leading-relaxed italic">"{q.text}"</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm font-semibold text-foreground/60">— {q.author}</span>
              {q.badge && (
                <span className="text-[10px] font-semibold tracking-wide uppercase text-foreground/70 border border-border/30 px-1.5 py-0.5 rounded">
                  {q.badge}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Stat line */}
      {statLine && (
        <p className="mt-5 pt-4 border-t border-border/20 text-xs text-foreground/70 font-medium">
          {statLine}
        </p>
      )}
    </div>
  );
}
