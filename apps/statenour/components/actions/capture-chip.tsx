"use client";

/**
 * CaptureChip · Wave 20 (v10.0.529.74) · inline knowledge-capture entry
 * point for /tasks.
 *
 * Single button that fires the existing brain-dump-modal open event.
 * The modal's AI extraction handles routing automatically — what you
 * type gets classified into thought / decision / insight / commitment /
 * task / pin. So the operator doesn't have to pre-decide what kind of
 * capture this is — just type it.
 *
 * Why this exists on /tasks:
 *   When you're working through tasks, ideas land. Pre-Wave-20 the
 *   only way to capture them was Cmd+Shift+J (keyboard-only) or open
 *   FloatingHome → tap CAPTURE. Both required leaving the work flow.
 *   This chip puts capture one tap away · always visible · zero context
 *   switch.
 *
 * Design contract:
 *   · ONE button · ONE accent (gold) · matches the editorial-minimalist
 *     contract on the rest of /tasks
 *   · Sparkles icon (matches brain-dump-modal header) so visual
 *     identity is consistent across surfaces
 *   · Live-region status so screen readers announce the modal open
 *
 * Skills applied:
 *   · ux-flow (capture without context-switch · Nielsen heuristic)
 *   · senior-frontend (no new modal · reuses existing infra · zero
 *     additional bundle weight)
 *   · fixing-accessibility (28×28 tap target · aria-label · focus ring)
 */

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TipChip } from "@/components/ui/tip-chip";
import { LEARN_TIPS } from "@/lib/learn/tips";

const CAPTURE_OPEN_EVENT = "ultron:open-capture";

interface CaptureChipProps {
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Compact = icon only · default = icon + label. */
  variant?: "default" | "compact";
}

export function CaptureChip({ className, variant = "default" }: CaptureChipProps) {
  const onOpen = () => {
    try {
      window.dispatchEvent(new Event(CAPTURE_OPEN_EVENT));
    } catch {
      // If the global event handler isn't mounted (it usually is),
      // do nothing · the affordance simply no-ops · no error spam.
    }
  };

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={onOpen}
        aria-label="capture a thought, decision, or fact"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-[var(--gold)]/30 bg-[var(--gold)]/[0.06] px-2.5 py-1.5 transition-colors",
          "hover:border-[var(--gold)]/60 hover:bg-[var(--gold)]/[0.1]",
          "focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
          "text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]",
        )}
      >
        <Sparkles size={11} strokeWidth={1.75} />
        {variant === "default" && <span>capture</span>}
      </button>
      <TipChip
        tip={LEARN_TIPS.capture_button}
        title="capture"
        size="xs"
      />
    </div>
  );
}
