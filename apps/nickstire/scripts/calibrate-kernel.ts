#!/usr/bin/env tsx
/**
 * scripts/calibrate-kernel.ts · 2026-09-15
 *
 * Re-runs the experiment kernel's calibration (shared/experimentKernelCalibration.ts)
 * and prints the numbers the capability-ledger row cites, so the row can be
 * re-verified from the command line instead of trusted from prose:
 *
 *   pnpm calibrate:kernel            # 2,000 seeded runs per scenario (~3 s)
 *   pnpm calibrate:kernel -- 500     # fewer runs
 *   pnpm calibrate:kernel -- --json  # machine-readable, for the ledger / a diff
 *   pnpm calibrate:kernel -- --sample plus3pp   # five individual runs of one
 *                                    # scenario, to see what a rate is made of
 *
 * Every scenario is run twice: once through the REAL kernel rule and once
 * through the naive peeked z-test (the positive-control opponent). If the
 * opponent ever stops blowing past alpha on A/A, the harness is blind and the
 * kernel numbers mean nothing — that is why both are printed side by side.
 */
import {
  CALIBRATION_SCENARIOS,
  calibrate,
  kernelRule,
  mulberry32,
  naivePeekingZRule,
  simulateOne,
  simulateStream,
  type CalibrationReport,
} from "../shared/experimentKernelCalibration";

const args = process.argv.slice(2);
const json = args.includes("--json");
const runs = Number(args.find((a) => /^\d+$/.test(a)) ?? 2000);
const SEED = 20260915;

// --stream <scenario> [runs]: the full daily count streams of N runs, with the
// kernel's per-day p, as JSON — the input of scripts/proof/growthbook-crosscheck.py,
// which applies GrowthBook's gbstats sequential test to the SAME counts.
const streamAt = args.indexOf("--stream");
if (streamAt !== -1) {
  const key = args[streamAt + 1] ?? "aa5";
  const scenario = CALIBRATION_SCENARIOS[key];
  if (!scenario) {
    console.error(`unknown scenario "${key}" — one of: ${Object.keys(CALIBRATION_SCENARIOS).join(", ")}`);
    process.exit(2);
  }
  const rng = mulberry32(SEED);
  const streams = Array.from({ length: runs }, () => simulateStream(scenario, rng));
  console.log(
    JSON.stringify({
      scenario: key,
      name: scenario.name,
      runs,
      seed: SEED,
      alpha: scenario.alpha ?? 0.05,
      tau: scenario.tau ?? 0.02,
      minExposuresPerArm: scenario.minExposuresPerArm ?? 50,
      trulyBetter: scenario.variantRate > scenario.controlRate ? "variant" : scenario.variantRate < scenario.controlRate ? "control" : null,
      streams,
    }),
  );
  process.exit(0);
}

const sampleAt = args.indexOf("--sample");
if (sampleAt !== -1) {
  const key = args[sampleAt + 1] ?? "plus3pp";
  const scenario = CALIBRATION_SCENARIOS[key];
  if (!scenario) {
    console.error(`unknown scenario "${key}" — one of: ${Object.keys(CALIBRATION_SCENARIOS).join(", ")}`);
    process.exit(2);
  }
  console.log(`${scenario.name} · five single runs, seeds ${SEED}..${SEED + 4}`);
  for (let i = 0; i < 5; i++) {
    const r = simulateOne(scenario, mulberry32(SEED + i), kernelRule);
    console.log(
      `  seed ${SEED + i}: ${r.finalStatus.padEnd(17)} declaredDay=${String(r.declaredDay ?? "-").padStart(2)} correct=${String(r.declaredCorrect ?? "-").padEnd(5)} refused=${r.refusedDesign} exposures/arm=${r.finalExposuresPerArm}`,
    );
  }
  process.exit(0);
}

const pct = (x: number) => `${(x * 100).toFixed(1).padStart(5)}%`;
const rows: Array<{ key: string; kernel: CalibrationReport; naive: CalibrationReport }> = [];
const t0 = Date.now();
for (const [key, scenario] of Object.entries(CALIBRATION_SCENARIOS)) {
  rows.push({
    key,
    kernel: calibrate(scenario, runs, SEED, kernelRule),
    naive: calibrate(scenario, runs, SEED, naivePeekingZRule),
  });
}

if (json) {
  console.log(JSON.stringify({ runs, seed: SEED, generatedAt: new Date().toISOString(), scenarios: rows }, null, 2));
} else {
  console.log(`kernel calibration · ${runs} seeded runs per scenario (seed ${SEED}) · ${Date.now() - t0} ms\n`);
  console.log("scenario      | kernel: declare  correct  wrong   refused  medDay | naive: declare  wrong");
  for (const r of rows) {
    const k = r.kernel;
    const n = r.naive;
    console.log(
      `${r.key.padEnd(13)} | ${pct(k.anyPeekDeclareRate)}  ${pct(k.correctDeclareRate)}  ${pct(k.wrongDeclareRate)}  ${pct(k.refusedDesignRate)}  ${String(k.medianDeclaredDay ?? "-").padStart(6)} | ${pct(n.anyPeekDeclareRate)}  ${pct(n.wrongDeclareRate)}`,
    );
  }
  console.log(
    "\nread: A/A 'declare' is the any-peek false-positive rate (must be <= alpha for the kernel; the naive column is the opponent and should be far above it);" +
      "\n      'refused' on the balanced A/A rows is the SRM false-refusal rate; on brokenSplit it is detection.",
  );
}
