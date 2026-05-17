"use client";

/**
 * DEEPER CONTEXT BADGE — shows when cross-source semantic recall
 * surfaced hits from brain_dump / reflection / strategic_law /
 * chat_message on the last reply.
 *
 * Data comes from the chat page's custom transport fetch wrapper,
 * which reads `X-Deeper-Context-Count` + `X-Deeper-Context-Types`
 * response headers and stores them in component state after each
 * reply. Visibility into what the multi-source vector expansion
 * is actually doing in real time.
 *
 * Hidden when count is 0 (no hits) so the strip doesn't take space
 * on every message.
 */

import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";

interface DeeperContextBadgeProps {
  count: number;
  types: string[];
  /** Optional className override for positioning */
  className?: string;
}

export function DeeperContextBadge({ count, types, className }: DeeperContextBadgeProps) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border",
        "border-[var(--gold)]/30 bg-[var(--gold)]/5",
        "text-[9px] font-mono font-bold uppercase tracking-[0.14em]",
        "text-[var(--gold)]/90",
        className,
      )}
      title={`Cross-source recall hit ${count} match${count === 1 ? "" : "es"}: ${types.join(" · ")}`}
    >
      <Sparkles size={9} />
      <span>◆ Deeper Context</span>
      <span className="text-[var(--gold)]/70">{count}</span>
      {types.length > 0 && (
        <span className="text-[var(--text-tertiary)] font-normal tracking-normal normal-case">
          · {types.join(" · ")}
        </span>
      )}
    </div>
  );
}
