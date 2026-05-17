"use client";

/**
 * v10.0.526 · ObservabilityRow — the four observability tiles in one slot.
 *
 * Layout decisions (frontend-design · DFII ≥ 8 · reject AI-slop):
 *
 *   The instinct here is a 4-up symmetric grid — and that's exactly the
 *   AI-slop pattern we reject. Instead we use an editorial pairing:
 *
 *     · Mobile (< sm): single column · tiles stack vertically · primary
 *       phone-first reading order (cost · voice · eval · drift). Every
 *       tile gets the full row width, no cramped side-by-side.
 *     · Tablet/desktop (sm+): 2-up column with cost + voice on top row
 *       (the LIVE operational metrics that tick per-minute) and eval +
 *       drift on the bottom row (the SLOW structural metrics that move
 *       daily). The pairing tells you "live signals" vs "trend signals"
 *       without a label.
 *
 *   No purple gradients · no Inter font · the section heading is the
 *   gold mono uppercase label that the rest of Ultron uses for zone
 *   delineation (matches LensFireTicker + TodayPulseStrip rhythm).
 *
 *   Touch targets ≥ 44px — each GlassCard already lands ≥ 112px tall
 *   thanks to min-h on every tile state. Mobile-primary device per the
 *   operator profile.
 *
 *   Total fetch cost = 4 parallel GETs, deduped at the module-level
 *   useUltronFetch cache. No effort to make this 1 round-trip because
 *   the endpoints belong to four different subsystems (cost · voice ·
 *   eval · OS) and coupling them server-side would be premature.
 */

import { useObservability } from "@/hooks/use-observability";
import { CostSloTile } from "./cost-slo-tile";
import { VoiceLatencyTile } from "./voice-latency-tile";
import { EvalPassRateTile } from "./eval-pass-rate-tile";
import { OsDriftTile } from "./os-drift-tile";

export function ObservabilityRow() {
  const { cost, voice, evals, osSnapshot } = useObservability();

  return (
    <section
      aria-label="System observability — cost, voice latency, eval pass rate, OS drift"
      className="space-y-2"
    >
      {/* Zone label — matches the gold mono uppercase rhythm used by
          the other Ultron section delimiters. Stays subtle so the
          tiles carry the visual weight. */}
      <div className="flex items-center gap-2 px-0.5">
        <span className="h-px flex-1 bg-[var(--border-default)]/40" />
        <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-[var(--text-tertiary)]">
          observability
        </span>
        <span className="h-px flex-1 bg-[var(--border-default)]/40" />
      </div>

      {/* Asymmetric editorial pairing · mobile = single col, sm+ = 2x2 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CostSloTile state={cost} />
        <VoiceLatencyTile state={voice} />
        <EvalPassRateTile state={evals} />
        <OsDriftTile state={osSnapshot} />
      </div>
    </section>
  );
}
