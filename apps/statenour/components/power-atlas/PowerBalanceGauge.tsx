"use client";

/**
 * <PowerBalanceGauge> · 2026-05-27 · Power Atlas Phase 1 (+ Phase 2 slider)
 *
 * Horizontal gauge -1.0 to 1.0 showing the operator's power balance
 * with this person. -1.0 = they hold leverage · 0.0 = parity (amber
 * center mark) · +1.0 = operator holds leverage.
 *
 * Phase 1: read-only display.
 * Phase 2 (2026-05-27): when an `onUpdate` callback is provided, the
 * gauge renders an inline slider (range -1 to 1 step 0.05) so the
 * operator can manually rate the balance. The mutation that backs
 * the callback ALSO sets `powerBalanceManualLock=true` so the Phase 3
 * auto-compute engine respects the operator's sticky value.
 * Phase 3 will auto-derive this from ledger trends + tone-shift
 * detection (skipping locked profiles).
 */

import { useState, useEffect } from "react";

interface PowerBalanceGaugeProps {
  value: number; // -1.0 to 1.0
  label?: string;
  /**
   * When provided, the gauge renders a slider that calls this callback
   * (debounced via local state) on commit. The mutation MUST also set
   * `powerBalanceManualLock=true` so auto-compute respects the value.
   */
  onUpdate?: (newValue: number) => Promise<void> | void;
  manualLock?: boolean;
}

export default function PowerBalanceGauge({
  value,
  label,
  onUpdate,
  manualLock,
}: PowerBalanceGaugeProps) {
  // Local state for slider interaction · commits on release
  const [draft, setDraft] = useState<number>(value);
  const [saving, setSaving] = useState<boolean>(false);

  // Sync down when the upstream prop changes (e.g. after an external
  // re-fetch lands a fresher number). Skip during active drag to avoid
  // jitter — `saving` covers commit-in-flight.
  useEffect(() => {
    if (!saving) setDraft(value);
  }, [value, saving]);

  // Clamp to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, draft));
  // Map [-1, 1] → [0%, 100%] for left-offset of the indicator
  const pctFromLeft = ((clamped + 1) / 2) * 100;
  const sign = clamped > 0.05 ? "you" : clamped < -0.05 ? "them" : "balanced";
  const signColor =
    clamped > 0.05
      ? "text-emerald-300"
      : clamped < -0.05
        ? "text-amber-300"
        : "text-[var(--text-secondary)]";

  async function commit(next: number) {
    if (!onUpdate) return;
    setSaving(true);
    try {
      await onUpdate(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
          {label ?? "Power balance"}
        </h2>
        <span
          className={`font-mono text-sm tabular-nums ${signColor}`}
          aria-label="numerical power balance"
        >
          {clamped.toFixed(2)}
        </span>
      </div>

      {onUpdate ? (
        // ─── Interactive slider mode ────────────────────────────────
        <div className="relative">
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={draft}
            onChange={(e) => setDraft(parseFloat(e.target.value))}
            onMouseUp={() => commit(draft)}
            onTouchEnd={() => commit(draft)}
            onKeyUp={() => commit(draft)}
            disabled={saving}
            aria-label="power balance slider"
            className="w-full appearance-none bg-transparent cursor-pointer disabled:opacity-50 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--bg-default)] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--gold,#FDB913)] [&::-webkit-slider-thumb]:-mt-1 [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--bg-default)] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--gold,#FDB913)]"
            style={{
              ["--track-bg" as string]:
                "linear-gradient(90deg, rgba(252,165,165,0.3) 0%, rgba(255,255,255,0.06) 50%, rgba(110,231,183,0.3) 100%)",
            }}
          />
          {/* Track underlay (read-only · slider's native track sits over this) */}
          <div
            className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-1.5 rounded-full -z-10 pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, rgba(252,165,165,0.3) 0%, rgba(255,255,255,0.06) 50%, rgba(110,231,183,0.3) 100%)",
            }}
            aria-hidden="true"
          />
        </div>
      ) : (
        // ─── Read-only display mode ─────────────────────────────────
        <div className="relative">
          <div
            className="h-1.5 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(252,165,165,0.3) 0%, rgba(255,255,255,0.06) 50%, rgba(110,231,183,0.3) 100%)",
            }}
          />
          {/* Center marker */}
          <div
            className="absolute top-0 h-1.5 w-px"
            style={{
              left: "50%",
              background: "var(--gold, #FDB913)",
              opacity: 0.7,
            }}
            aria-hidden="true"
          />
          {/* Indicator */}
          <div
            className="absolute -top-1 size-3.5 rounded-full border-2 transition-all duration-500 ease-out"
            style={{
              left: `${pctFromLeft}%`,
              transform: "translateX(-50%)",
              background: "var(--bg-default, #0A0A0A)",
              borderColor: "var(--gold, #FDB913)",
            }}
            aria-label="power balance indicator"
          />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
        <span>them −1.0</span>
        <span className={signColor}>
          {sign}
          {manualLock ? " · locked" : ""}
          {saving ? " · saving…" : ""}
        </span>
        <span>you +1.0</span>
      </div>
    </section>
  );
}
