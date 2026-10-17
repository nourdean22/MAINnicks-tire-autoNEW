/**
 * Kappa and the two error rates for the LLM-judge vs thumbs report
 * (lib/services/judge-calibration.ts). Each is null when it cannot be computed (nothing
 * scored, one class only, an empty denominator). A null reads "unknown": 0 would claim
 * "no agreement beyond chance" or "the judge never errs", and neither has been measured.
 */

export function formatKappa(kappa: number | null): string {
  return kappa === null ? "unknown" : kappa.toFixed(2);
}

export function formatRate(rate: number | null): string {
  return rate === null ? "unknown" : `${Math.round(rate * 100)}%`;
}

export function JudgeCalibrationMetrics({
  kappa,
  falsePassRate,
  falseFailRate,
}: {
  kappa: number | null;
  falsePassRate: number | null;
  falseFailRate: number | null;
}) {
  const items = [
    { label: "Kappa", note: "agreement beyond chance", value: formatKappa(kappa) },
    { label: "False pass", note: "judge picked V2, you gave a thumbs-down", value: formatRate(falsePassRate) },
    { label: "False fail", note: "judge picked V1, you gave a thumbs-up", value: formatRate(falseFailRate) },
  ];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-surface border border-edge-default bg-surface-raised p-3">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="font-mono text-[11px] text-fg-tertiary">{item.label}</dt>
          <dd className="text-lg font-bold font-mono text-fg-secondary tabular-nums">{item.value}</dd>
          <dd className="text-[11px] text-fg-tertiary">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}
