"use client";

/**
 * <ReciprocityCard> · 2026-05-27 · Power Atlas Phase 3 polish
 *
 * Renders the 90-day reciprocity gradient (operator-initiated vs
 * their-initiated %) sourced from PersonProfile.metadata.reciprocity ·
 * written weekly by `reciprocity-tracker-update` cron (Sun 03:00 UTC).
 *
 * The larger share gets the amber accent (signals where the asymmetry
 * leans). Empty state when metadata absent or sampleSize < 5 · the
 * cron itself returns null below threshold, so absent metadata is the
 * common pre-data state.
 *
 * No emojis. Serif heading. Monospace numbers. 1px borders. Mounts in
 * the detail-panel right column below GreeneLawSidebar.
 */

interface ReciprocityShape {
  operatorInitiatedPct: number;
  theirInitiatedPct: number;
  sampleSize: number;
}

interface ReciprocityCardProps {
  metadata: unknown;
}

function parseReciprocity(raw: unknown): ReciprocityShape | null {
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as { reciprocity?: unknown };
  const r = meta.reciprocity;
  if (!r || typeof r !== "object") return null;
  const candidate = r as Partial<ReciprocityShape>;
  if (
    typeof candidate.operatorInitiatedPct !== "number" ||
    typeof candidate.theirInitiatedPct !== "number" ||
    typeof candidate.sampleSize !== "number"
  ) {
    return null;
  }
  return {
    operatorInitiatedPct: candidate.operatorInitiatedPct,
    theirInitiatedPct: candidate.theirInitiatedPct,
    sampleSize: candidate.sampleSize,
  };
}

export default function ReciprocityCard({ metadata }: ReciprocityCardProps) {
  const reciprocity = parseReciprocity(metadata);

  if (!reciprocity || reciprocity.sampleSize < 5) {
    return (
      <section
        className="rounded-surface border border-edge-subtle bg-content p-4"
      >
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h3 className="text-[15px] font-semibold text-fg">
            Reciprocity gradient
          </h3>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            90d
          </span>
        </div>
        <p className="text-xs text-fg-tertiary">
          Needs ≥5 events to compute · log more interactions.
        </p>
      </section>
    );
  }

  const { operatorInitiatedPct, theirInitiatedPct, sampleSize } = reciprocity;
  const operatorLeads = operatorInitiatedPct >= theirInitiatedPct;

  return (
    <section
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-[15px] font-semibold text-fg">
          Reciprocity gradient
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          90d
        </span>
      </div>

      {/* Horizontal split bar · amber accent on larger share */}
      <div
        className="flex h-2 w-full overflow-hidden rounded-micro"
        style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
      >
        <div
          className={
            operatorLeads
              ? "bg-amber-400/80"
              : "bg-edge-strong"
          }
          style={{ width: `${operatorInitiatedPct}%` }}
        />
        <div
          className={
            operatorLeads
              ? "bg-edge-strong"
              : "bg-amber-400/80"
          }
          style={{ width: `${theirInitiatedPct}%` }}
        />
      </div>

      {/* Legend · operator vs them */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            operator
          </div>
          <div
            className={`font-mono tabular-nums ${operatorLeads ? "text-amber-300" : "text-fg-secondary"}`}
          >
            {operatorInitiatedPct}%
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            them
          </div>
          <div
            className={`font-mono tabular-nums ${operatorLeads ? "text-fg-secondary" : "text-amber-300"}`}
          >
            {theirInitiatedPct}%
          </div>
        </div>
      </div>

      <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary tabular-nums">
        sample · <span className="font-mono">{sampleSize}</span> events
      </div>
    </section>
  );
}
