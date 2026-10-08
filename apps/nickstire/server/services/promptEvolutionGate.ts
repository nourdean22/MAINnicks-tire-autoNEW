/**
 * Holdout gate for prompt evolution (2026-10-08) — the decision rule that
 * says whether a candidate receptionist prompt beat the served one.
 *
 * THE DEFECT IT REPLACES. The gate was `candidate passRate > baseline passRate`
 * over ~5 holdout seeds, one ghost replay each. CURRENT-TRUTH records that a
 * replay is +/-1-2 seeds nondeterministic even at temperature 0, so a single
 * lucky seed flip read as a STRICT IMPROVEMENT. Measured on the seeded
 * simulation (20,000 runs, mulberry32 seed 99): with two IDENTICAL prompts the
 * old rule accepted 28.7% of runs at 5 holdout seeds and 36.9% at 12 — the
 * loop proposed noise. This rule: 0.0% and 0.7%.
 *
 * THE RULE. Each holdout seed is replayed R times under each prompt. Per seed,
 * d = candidatePassRate - baselinePassRate. Under the null (the candidate is
 * no better) every d is symmetric around zero no matter how noisy one replay
 * is, so flipping the sign of any subset of d's is equally likely. The exact
 * one-sided SIGN-FLIP PERMUTATION TEST on sum(d) is therefore valid without
 * knowing the noise level — the reason to prefer it over "beat a measured
 * noise floor", which would itself be a noisy estimate.
 *
 * Why the permutation test and not a plain sign test: a plain sign test counts
 * a coin-flip seed that went 2/3 vs 1/3 the same as a seed fixed from 0/3 to
 * 3/3. Measured in the simulation (12 holdout seeds, 3 replays, a candidate
 * that truly fixes 5 always-failing calls): the sign test accepted 45.0% of
 * runs, this test 82.4% — the magnitude is the signal.
 *
 * Three refusals, each named so the operator sees WHY nothing shipped:
 *   - regressed-seed  a call the served prompt passes on every replay and the
 *                     candidate fails on every replay. A reliably handled call
 *                     must not become reliably broken, whatever the average.
 *   - underpowered    even a clean sweep of the comparable seeds could not
 *                     reach alpha. Honest "cannot tell", never a quiet no.
 *   - not-significant the sweep was possible and did not happen.
 *
 * UNRESOLVABLE SEEDS (the judge ruled no prompt could win them) are excluded
 * by the BASELINE's verdict only. A candidate that gets its own losses ruled
 * "unresolvable" scores them as failures — otherwise a prompt could shrink its
 * denominator by confusing the judge.
 *
 * Pure: no DB, no LLM, no clock. promptEvolution.ts supplies the replays.
 */

export interface SeedTrials {
  id: string;
  /** One entry per replay of this seed under this prompt. */
  passes: boolean[];
  /** The judge ruled at least one replay of this seed unwinnable. */
  unresolvable: boolean;
}

export type GateReason = "improved" | "regressed-seed" | "underpowered" | "not-significant";

export interface GateVerdict {
  accept: boolean;
  reason: GateReason;
  /** Seeds compared (present in both arms, resolvable under the baseline). */
  comparable: number;
  improved: number;
  worsened: number;
  tied: number;
  /** One-sided exact sign-flip permutation p over the per-seed differences; 1 when nothing differs. */
  pValue: number;
  /** Smallest p a clean sweep of `comparable` seeds could reach. */
  bestPossibleP: number;
  /** Seeds whose baseline replays disagreed with each other — the A/A reading of the instrument. */
  baselineSelfDisagreement: number;
  regressedSeeds: string[];
  /** Total passes / total replays per arm over the comparable seeds. */
  baseline: { passes: number; trials: number };
  candidate: { passes: number; trials: number };
}

const DEFAULT_GATE_ALPHA = 0.05;

/**
 * Exact one-sided sign-flip permutation p for integer per-seed differences:
 * the share of the 2^n sign assignments whose sum is >= the observed sum.
 * Counted by dynamic programming over reachable sums, so it is exact and
 * cheap at any holdout size (|d| is at most a few dozen units per seed).
 */
function signFlipP(diffs: number[]): number {
  const nonzero = diffs.filter((d) => d !== 0).map(Math.abs);
  if (!nonzero.length) return 1;
  const observed = diffs.reduce((a, b) => a + b, 0);
  let counts = new Map<number, number>([[0, 1]]);
  for (const m of nonzero) {
    const next = new Map<number, number>();
    for (const [sum, c] of counts) {
      next.set(sum + m, (next.get(sum + m) ?? 0) + c);
      next.set(sum - m, (next.get(sum - m) ?? 0) + c);
    }
    counts = next;
  }
  let tail = 0;
  for (const [sum, c] of counts) if (sum >= observed) tail += c;
  return tail / 2 ** nonzero.length;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** The slice of a ScoredPrompt grade the gate reads (structural, so this module stays import-free). */
interface GradeLike {
  id: string;
  pass: boolean;
  unresolvable?: boolean;
}

/** Fold R holdout scorings of one prompt into per-seed trials. */
export function toSeedTrials(runs: ReadonlyArray<{ grades: ReadonlyArray<GradeLike> }>): SeedTrials[] {
  const bySeed = new Map<string, SeedTrials>();
  for (const run of runs) {
    for (const g of run.grades) {
      const t = bySeed.get(g.id) ?? { id: g.id, passes: [], unresolvable: false };
      t.passes.push(g.pass && !g.unresolvable);
      t.unresolvable ||= Boolean(g.unresolvable);
      bySeed.set(g.id, t);
    }
  }
  return [...bySeed.values()];
}

const rate = (p: boolean[]) => (p.length ? p.filter(Boolean).length / p.length : 0);

export function judgeHoldout(
  baseline: SeedTrials[],
  candidate: SeedTrials[],
  opts: { alpha?: number } = {},
): GateVerdict {
  const alpha = opts.alpha ?? DEFAULT_GATE_ALPHA;
  const cand = new Map(candidate.map((s) => [s.id, s]));
  const pairs = baseline
    .filter((b) => !b.unresolvable && b.passes.length > 0)
    .flatMap((b) => {
      const c = cand.get(b.id);
      return c && c.passes.length > 0 ? [{ b, c }] : [];
    });

  // Per-seed differences on one integer scale: d = cPass/cN - bPass/bN,
  // scaled by L = lcm over seeds of bN*cN so the permutation DP stays exact.
  const L = pairs.reduce((l, { b, c }) => {
    const den = b.passes.length * c.passes.length;
    return (l * den) / gcd(l, den);
  }, 1);
  const diffs: number[] = [];
  let improved = 0;
  let worsened = 0;
  let baselineSelfDisagreement = 0;
  const regressedSeeds: string[] = [];
  const baseTotals = { passes: 0, trials: 0 };
  const candTotals = { passes: 0, trials: 0 };
  for (const { b, c } of pairs) {
    const rb = rate(b.passes);
    const rc = rate(c.passes);
    if (rc > rb) improved++;
    else if (rc < rb) worsened++;
    if (rb > 0 && rb < 1) baselineSelfDisagreement++;
    if (rb === 1 && rc === 0) regressedSeeds.push(b.id);
    const bp = b.passes.filter(Boolean).length;
    const cp = c.passes.filter(Boolean).length;
    diffs.push(((cp * b.passes.length - bp * c.passes.length) * L) / (b.passes.length * c.passes.length));
    baseTotals.passes += b.passes.filter(Boolean).length;
    baseTotals.trials += b.passes.length;
    candTotals.passes += c.passes.filter(Boolean).length;
    candTotals.trials += c.passes.length;
  }

  const comparable = pairs.length;
  const n = improved + worsened;
  const pValue = signFlipP(diffs);
  // A clean sweep — every comparable seed moved up — is the most extreme
  // assignment there is, so no outcome on this many seeds can beat 2^-n.
  const bestPossibleP = comparable ? 2 ** -comparable : 1;
  const reason: GateReason = regressedSeeds.length
    ? "regressed-seed"
    : bestPossibleP > alpha
      ? "underpowered"
      : pValue <= alpha
        ? "improved"
        : "not-significant";

  return {
    accept: reason === "improved",
    reason,
    comparable,
    improved,
    worsened,
    tied: comparable - n,
    pValue,
    bestPossibleP,
    baselineSelfDisagreement,
    regressedSeeds,
    baseline: baseTotals,
    candidate: candTotals,
  };
}

/** One line for cron_log details, Telegram and the CLI — the same words everywhere. */
export function describeVerdict(v: GateVerdict): string {
  return (
    `${v.reason} · seeds +${v.improved} -${v.worsened} =${v.tied} of ${v.comparable}` +
    ` · perm p=${v.pValue.toFixed(3)} (best possible ${v.bestPossibleP.toFixed(3)})` +
    ` · replays ${v.candidate.passes}/${v.candidate.trials} vs ${v.baseline.passes}/${v.baseline.trials}` +
    ` · baseline self-disagreement ${v.baselineSelfDisagreement}/${v.comparable}` +
    (v.regressedSeeds.length ? ` · regressed ${v.regressedSeeds.join(",")}` : "")
  );
}
