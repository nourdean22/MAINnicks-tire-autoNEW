"use client";

/**
 * <PowerBalanceGauge> · 2026-05-27 · Power Atlas Phase 1
 *
 * Horizontal gauge -1.0 to 1.0 showing the operator's power balance
 * with this person. -1.0 = they hold leverage · 0.0 = parity (amber
 * center mark) · +1.0 = operator holds leverage.
 *
 * Phase 1 is operator-rated: read-only display + an inline slider for
 * manual adjustment. Phase 3 will auto-derive this from ledger trends +
 * tone shift detection. The slider only fires onChange (no mutation yet
 * in Phase 1 · the operator's manual rating writes via a future
 * `updatePowerBalance` procedure when Phase 2 adds it).
 *
 * For now, this is the read-only view with an indicator. Slider scaffold
 * is present but disabled to avoid an out-of-scope tRPC procedure.
 */

interface PowerBalanceGaugeProps {
  value: number; // -1.0 to 1.0
  label?: string;
}

export default function PowerBalanceGauge({
  value,
  label,
}: PowerBalanceGaugeProps) {
  // Clamp to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, value));
  // Map [-1, 1] → [0%, 100%] for left-offset of the indicator
  const pctFromLeft = ((clamped + 1) / 2) * 100;
  const sign = clamped > 0.05 ? "you" : clamped < -0.05 ? "them" : "balanced";
  const signColor =
    clamped > 0.05
      ? "text-emerald-300"
      : clamped < -0.05
        ? "text-amber-300"
        : "text-[var(--text-secondary)]";

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

      {/* Track */}
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

      <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
        <span>them −1.0</span>
        <span className={signColor}>{sign}</span>
        <span>you +1.0</span>
      </div>
    </section>
  );
}
