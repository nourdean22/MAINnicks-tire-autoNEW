/**
 * Kappa and the two error rates for the LLM-judge vs thumbs report
 * (lib/services/judge-calibration.ts). Each is null when it cannot be computed (nothing
 * scored, one-class reactions, an empty denominator). A null reads "unknown": 0 would claim
 * "no agreement beyond chance" or "the judge never errs", and neither has been measured.
 */

import { roundKappa } from "@/lib/ai/judge-eval/calibration";

/** Same 2-place value the verdict bands compare. */
export function formatKappa(kappa: number | null): string {
  return kappa === null ? "unknown" : roundKappa(kappa).toFixed(2);
}

export function formatRate(rate: number | null): string {
  return rate === null ? "unknown" : `${Math.round(rate * 100)}%`;
}

/** Operator reactions behind the two rates: false pass is a share of thumbs-downs, false fail of thumbs-ups. */
export function reactionCounts(
  matrix: ReadonlyArray<{ human: "thumbs_up" | "thumbs_down"; count: number }>,
): { thumbsUp: number; thumbsDown: number } {
  let thumbsUp = 0;
  let thumbsDown = 0;
  for (const c of matrix) {
    if (c.human === "thumbs_up") thumbsUp += c.count;
    else thumbsDown += c.count;
  }
  return { thumbsUp, thumbsDown };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function JudgeCalibrationMetrics({
  kappa,
  falsePassRate,
  falseFailRate,
  thumbsUp,
  thumbsDown,
  preliminary,
}: {
  kappa: number | null;
  falsePassRate: number | null;
  falseFailRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  preliminary: boolean;
}) {
  const items = [
    { label: "Kappa", note: "agreement beyond chance", value: formatKappa(kappa) },
    {
      label: "False pass",
      note: `of ${plural(thumbsDown, "thumbs-down")}, the judge picked V2`,
      value: formatRate(falsePassRate),
    },
    {
      label: "False fail",
      note: `of ${plural(thumbsUp, "thumbs-up")}, the judge picked V1`,
      value: formatRate(falseFailRate),
    },
  ];
  return (
    <div className="rounded-surface border border-edge-default bg-surface-raised p-3">
      {preliminary && <p className="mb-2 font-mono text-[11px] text-fg-tertiary">preliminary</p>}
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="font-mono text-[11px] text-fg-tertiary">{item.label}</dt>
            <dd className="text-lg font-bold font-mono text-fg-secondary tabular-nums">{item.value}</dd>
            <dd className="text-[11px] text-fg-tertiary">{item.note}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
