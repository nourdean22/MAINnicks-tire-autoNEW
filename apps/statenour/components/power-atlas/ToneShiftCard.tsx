"use client";

/**
 * <ToneShiftCard> · 2026-05-27 · Power Atlas Phase 3 polish
 *
 * Renders the trailing-3 vs trailing-30 sentiment delta sourced from
 * PersonProfile.metadata.toneShift · written daily by `tone-shift-detect`
 * cron (01:00 UTC). Highlights the shift in amber when |shift| ≥ 0.5
 * (matches the detector's `alert` flag).
 *
 * Scale label `-1.0 to +1.0` reminds the operator that scores live in
 * sentiment-normalized space (very negative → very positive).
 *
 * No emojis. Serif heading. Monospace numbers. 1px borders. Mounts in
 * the detail-panel right column below ReciprocityCard.
 */

interface ToneShiftShape {
  recentSentiment: number;
  trailingSentiment: number;
  shift: number;
  alert: boolean;
}

interface ToneShiftCardProps {
  metadata: unknown;
}

function parseToneShift(raw: unknown): ToneShiftShape | null {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as { toneShift?: unknown };
  const t = meta.toneShift;
  if (!t || typeof t !== "object") return null;
  const candidate = t as Partial<ToneShiftShape>;
  if (
    typeof candidate.recentSentiment !== "number" ||
    typeof candidate.trailingSentiment !== "number" ||
    typeof candidate.shift !== "number"
  ) {
    return null;
  }
  return {
    recentSentiment: candidate.recentSentiment,
    trailingSentiment: candidate.trailingSentiment,
    shift: candidate.shift,
    alert: Boolean(candidate.alert),
  };
}

function formatSentiment(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : " ";
  return `${sign}${n.toFixed(2)}`;
}

export default function ToneShiftCard({ metadata }: ToneShiftCardProps) {
  const toneShift = parseToneShift(metadata);

  if (!toneShift) {
    return (
      <section
        className="rounded-surface border border-edge-subtle bg-content p-4"
      >
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h3 className="text-[15px] font-semibold text-fg">
            Tone shift
          </h3>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            trailing 3 vs 30
          </span>
        </div>
        <p className="text-xs text-fg-tertiary">
          Needs ≥10 chat mentions to compute · scoring runs nightly.
        </p>
      </section>
    );
  }

  const { recentSentiment, trailingSentiment, shift, alert } = toneShift;
  const shiftSigned = shift > 0 ? `+${shift.toFixed(2)}` : shift.toFixed(2);

  return (
    <section
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[15px] font-semibold text-fg">
          Tone shift
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          trailing 3 vs 30
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            recent · 3
          </div>
          <div className="font-mono tabular-nums text-fg-secondary">
            {formatSentiment(recentSentiment)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            trailing · 30
          </div>
          <div className="font-mono tabular-nums text-fg-secondary">
            {formatSentiment(trailingSentiment)}
          </div>
        </div>
      </div>

      <div
        className="mt-3 border-t border-edge-subtle pt-3 flex items-baseline justify-between"
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          shift
        </span>
        <span
          className={`font-mono tabular-nums text-sm ${alert ? "text-amber-300" : "text-fg-secondary"}`}
        >
          {shiftSigned}
        </span>
      </div>

      <div className="mt-2 text-[11px] text-fg-tertiary">
        scale · -1.0 (very negative) to +1.0 (very positive)
      </div>
    </section>
  );
}
