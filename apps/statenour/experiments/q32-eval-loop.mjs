/**
 * Q-32 Langfuse dataset experiment.
 *
 * Dataset input contract (versioned in Langfuse):
 * {
 *   baselineScore: number,
 *   candidateScore: number,
 *   humanBaselineScore?: number,
 *   humanCandidateScore?: number,
 *   judgeWinner?: "v1"|"v2"|"tie",
 *   operatorWinner?: "v1"|"v2"|"tie",
 *   candidateFamily: string,
 *   judgeFamily: string
 * }
 *
 * The cloud leg is disabled until the operator creates/read-backs the versioned
 * Langfuse dataset and enables LANGFUSE_Q32_ENABLED in GitHub repository vars.
 */
import { RegressionError } from "@langfuse/client";

const task = async (item) => {
  const input = item.input ?? {};
  const candidateFamily = String(input.candidateFamily ?? "").toLowerCase();
  const judgeFamily = String(input.judgeFamily ?? "").toLowerCase();
  const eligible =
    candidateFamily.length > 0 &&
    judgeFamily.length > 0 &&
    candidateFamily !== judgeFamily;

  const hasHuman =
    Number.isFinite(input.humanBaselineScore) &&
    Number.isFinite(input.humanCandidateScore);

  return {
    ...input,
    eligible,
    predictionDelta: Number(input.candidateScore) - Number(input.baselineScore),
    ...(hasHuman
      ? {
          humanDelta:
            Number(input.humanCandidateScore) - Number(input.humanBaselineScore),
        }
      : {}),
  };
};

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

function kappa(rows) {
  if (rows.length === 0) return null;
  const classes = ["v1", "v2", "tie"];
  const po = rows.filter((r) => r.judgeWinner === r.operatorWinner).length / rows.length;
  let pe = 0;
  for (const c of classes) {
    pe +=
      (rows.filter((r) => r.judgeWinner === c).length / rows.length) *
      (rows.filter((r) => r.operatorWinner === c).length / rows.length);
  }
  return pe >= 1 ? null : (po - pe) / (1 - pe);
}

const q32PpiLower = async ({ itemResults }) => {
  const outputs = itemResults
    .map((r) => r.output)
    .filter((o) => o?.eligible === true);

  const predictionDeltas = outputs
    .map((o) => o.predictionDelta)
    .filter(Number.isFinite);

  const labeled = outputs.filter(
    (o) => Number.isFinite(o.humanDelta) && Number.isFinite(o.predictionDelta),
  );

  const calibrationRows = outputs
    .filter(
      (o) =>
        ["v1", "v2", "tie"].includes(String(o.judgeWinner)) &&
        ["v1", "v2", "tie"].includes(String(o.operatorWinner)),
    )
    .map((o) => ({
      judgeWinner: o.judgeWinner,
      operatorWinner: o.operatorWinner,
    }));

  if (predictionDeltas.length === 0) {
    throw new Error("Q32_UNMEASURED: no cross-family prediction deltas");
  }
  if (labeled.length < 30) {
    throw new Error(\`Q32_UNMEASURED: \${labeled.length}/30 human-labeled paired items\`);
  }

  const judgeKappa = kappa(calibrationRows);
  if (judgeKappa == null || judgeKappa < 0.6) {
    throw new Error(
      \`Q32_UNTRUSTED_JUDGE: kappa=\${judgeKappa ?? "null"} on n=\${calibrationRows.length}\`,
    );
  }

  const residuals = labeled.map((o) => Number(o.humanDelta) - o.predictionDelta);
  const estimate = mean(predictionDeltas) + mean(residuals);
  const se = Math.sqrt(
    variance(predictionDeltas) / predictionDeltas.length +
      variance(residuals) / residuals.length,
  );
  const lower = estimate - 1.96 * se;

  return {
    name: "q32_ppi_lower",
    value: lower,
    comment:
      \`estimate=\${estimate.toFixed(4)} lower=\${lower.toFixed(4)} \` +
      \`predicted_n=\${predictionDeltas.length} human_n=\${labeled.length} \` +
      \`kappa=\${judgeKappa.toFixed(3)} calibration_n=\${calibrationRows.length}\`,
  };
};

export async function experiment(context) {
  const result = await context.runExperiment({
    name: "StateNour Q-32 paired eval gate",
    description:
      "Cross-family judge + human calibration + prediction-powered paired delta.",
    task,
    runEvaluators: [q32PpiLower],
  });

  const lower =
    result.runEvaluations.find((e) => e.name === "q32_ppi_lower")?.value ??
    Number.NEGATIVE_INFINITY;

  if (!Number.isFinite(lower) || lower < 0) {
    throw new RegressionError({ result });
  }
  return result;
}
