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
 * Four refusals, each named so the operator sees WHY nothing shipped:
 *   - regressed-seed  a call the served prompt passes on every replay and the
 *                     candidate fails on every replay. A reliably handled call
 *                     must not become reliably broken, whatever the average.
 *   - evaluator-unavailable  the judge lane was down on seeds that could
 *                     change the answer (see EVALUATOR OUTAGE below).
 *   - underpowered    even a clean sweep of the comparable seeds could not
 *                     reach alpha. Honest "cannot tell", never a quiet no.
 *   - not-significant the sweep was possible and did not happen.
 * PRECEDENCE when several hold: regressed-seed > evaluator-unavailable (share
 * cap, lost power, a possible regression on an outage seed) > underpowered >
 * not-significant > evaluator-unavailable (worst-case p) > improved. A
 * regression is named first because it is the one finding an outage cannot
 * have manufactured (it is read on judged seeds only); "cannot tell because
 * the judge was down" outranks "cannot tell because the sample is small"
 * because only the first is fixed by re-running. "improved" needs BOTH the
 * judged p and the worst-case p at or under alpha.
 *
 * UNRESOLVABLE SEEDS (the judge ruled no prompt could win them) are excluded
 * by the BASELINE's verdict only. A candidate that gets its own losses ruled
 * "unresolvable" scores them as failures — otherwise a prompt could shrink its
 * denominator by confusing the judge.
 *
 * EVALUATOR OUTAGE (2026-10-09). A replay graded while the judge lane was
 * down carries judgeUnavailable: its pass bit is the bare regex verdict (a
 * miss stays a fail, a hit stays an unverified pass). Before today the gate
 * never saw the flag, so an outage during the BASELINE's replays handed the
 * candidate free "improvements" -- asymmetric between arms by construction.
 *
 * The rule is ONE-SIDED, like unresolvable: an outage may cost the candidate,
 * never help it. A seed whose replays hit an outage in EITHER arm leaves the
 * judged comparison for BOTH arms -- its bits never enter pValue, the counts,
 * the totals or regressedSeeds, so an outage cannot manufacture a regression
 * or an improvement. But the outage seed is still read, at its WORST for the
 * candidate (worstCaseForCandidate), replay by replay:
 *   - an unverified CANDIDATE replay reads FAIL. With verifyHits on (the
 *     default) a regex HIT graded while the judge was down is an unverified
 *     PASS, and the judge may have ruled that very reply "deflected" -- so the
 *     raw bit is biased toward the candidate exactly when its judge failed on
 *     its own reply (a parse failure is flagged judgeUnavailable too);
 *   - an unverified BASELINE replay reads PASS (a regex miss the judge may
 *     have rescued) unless it carried a critical violation, which no judge
 *     verdict can overturn;
 *   - judged replays keep their bits.
 * Every judged outcome of the down replays is at least as good for the
 * candidate as that view, so the two checks run on it are bounds:
 *   - a possible regression (worst-case baseline rate 1, worst-case candidate
 *     rate 0) refuses as evaluator-unavailable, listed in
 *     outageRegressionSeeds;
 *   - worstCaseP re-runs the permutation with each outage seed's worst-case
 *     difference clamped to <= 0. Losses the outage may be hiding count;
 *     gains it may be faking do not.
 * HISTORY. The first cut dropped outage seeds (a candidate whose judge failed
 * on its own broken replies turned regressed-seed into "improved"). The second
 * read the outage seed's RAW bits, so the same reply graded 010 instead of 000
 * (one unverified hit) still read "improved" -- review finding 2026-10-09,
 * the 010/011/111 cases are pinned by test. Per-replay flags come from
 * toSeedTrials (SeedTrials.unverified); a seed flagged without them is read
 * as unverified on every replay, the stricter reading.
 * Consequence, pinned by property tests: the gate never accepts what it would
 * refuse had the judge graded the down replays, whatever the judge would have
 * said (a sign-flip p never falls when one difference falls), and never
 * accepts what the judged seeds alone would refuse. The gate also refuses
 * outright when the excluded share
 * exceeds maxEvaluatorOutageShare (default 0.25; exactly 0.25 is tolerated),
 * or when the exclusions alone cost the power (the eligible seeds could reach
 * alpha, the survivors cannot) -- a small sample is "underpowered", a small
 * sample the outage made is "evaluator-unavailable".
 *
 * PAIRED TRAIN SELECTION (2026-10-09). promptEvolution.ts picked the train
 * winner by passRate vs passRate, each over its OWN denominator -- the shrink-
 * the-denominator lie this header already forbids on the holdout. Measured
 * in the test: a candidate that changes nothing but gets 4 of its 5 losses
 * ruled unresolvable reads 83% vs 50%. comparePairedTrain applies the holdout
 * eligibility rule to one train scoring per arm and returns pass COUNTS over
 * the same seeds, with the same one-sided outage rule: an outage seed where
 * the candidate's worst-case bit is below the baseline's is a candidate loss, and a
 * reading with no eligible seed or an outage share over the cap is
 * usable: false -- "cannot tell", never an ordinary margin.
 *
 * SUCCESS COHORT (2026-10-09). The holdout only contains calls that FAILED,
 * so a candidate that fixes failures while breaking calls that already WON
 * could pass it. judgeSuccessCohort replays a cohort of won calls under both
 * prompts and vetoes on: a reliably-won call now reliably lost; any critical
 * violation (price leak, guarantee, empty reply, claim violation) on a seed
 * whose baseline replays had none; a statistically significant overall drop;
 * an outage that could be hiding any of those; or a cohort too small for the
 * drop test to reach alpha. Feed it through toSuccessTrials, which refuses a
 * grade missing a violation counter. That cohort is evaluator-only -- it must never reach the
 * optimizer's failure brief. successAudit.test.ts:49-55 pins "won calls never
 * reach runPromptEvolution" today; wiring this cohort in must narrow that pin
 * to the optimizer's input, never drop it.
 *
 * CONFIRMATION (2026-10-09). judgeConfirmation is judgeHoldout, unchanged, on
 * a sealed cohort the loop has never scored (promptEvolutionCohorts.ts). The
 * holdout is reused week after week by a deterministic split, so a candidate
 * selected on it carries the winner's curse; a fresh cohort scored once does
 * not. SIZE: it reads "underpowered" below minSeedsForAlpha(alpha) comparable
 * seeds (5 at 0.05, 6 at 0.025) -- see promptEvolutionCohorts.ts for what
 * that means for the pool the caller draws it from.
 *
 * Pure: no DB, no LLM, no clock, no imports. promptEvolution.ts supplies the
 * replays.
 */

export interface SeedTrials {
  id: string;
  /** One entry per replay of this seed under this prompt. */
  passes: boolean[];
  /** The judge ruled at least one replay of this seed unwinnable. */
  unresolvable: boolean;
  /**
   * The judge was needed and unreachable on at least one replay of this seed
   * under this prompt (ReplayGrade.judgeUnavailable). Those pass bits are
   * regex-only, so the seed is invalid evidence for BOTH arms.
   */
  evaluatorUnavailable: boolean;
  /**
   * Optional, parallel to `passes`: true when THAT replay was graded while the
   * judge was down (toSeedTrials fills it from each grade's judgeUnavailable).
   * The worst-case outage view reads it replay by replay. A seed flagged
   * evaluatorUnavailable without a well-formed array is read as unverified on
   * EVERY replay -- the stricter reading, never the looser.
   */
  unverified?: boolean[];
  /**
   * Parallel to `passes`: true when that replay carried any critical
   * violation (price leak, guarantee, empty reply, claim violation). These
   * are deterministic checks -- no judge -- so an outage never hides one.
   * Read by judgeSuccessCohort.
   */
  violations: boolean[];
}

export type GateReason = "improved" | "regressed-seed" | "evaluator-unavailable" | "underpowered" | "not-significant";

export interface GateVerdict {
  accept: boolean;
  reason: GateReason;
  /** Seeds compared: eligible (baseline-resolvable, replayed in both arms) minus evaluatorUnavailableSeeds. */
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
  /** Seeds eligible before the outage exclusion: baseline-resolvable and replayed in both arms. */
  eligible: number;
  /** Eligible seeds dropped from BOTH arms because either arm's judge was unavailable on them. */
  evaluatorUnavailableSeeds: string[];
  /** evaluatorUnavailableSeeds / eligible; 0 when nothing was eligible. */
  evaluatorOutageShare: number;
  /**
   * Outage seeds whose worst-case view (worstCaseForCandidate) shows baseline
   * rate 1 and candidate rate 0: a regression the outage may be hiding. Any
   * one refuses as evaluator-unavailable; never listed in regressedSeeds.
   */
  outageRegressionSeeds: string[];
  /**
   * The permutation p with each outage seed's worst-case difference clamped
   * to <= 0 (its possible losses count against the candidate, its gains do
   * not). Equals pValue when no outage seed can show a loss; "improved" needs
   * both <= alpha.
   */
  worstCaseP: number;
}

export interface GateOptions {
  /** One-sided significance level (default 0.05). */
  alpha?: number;
  /** Refuse as "evaluator-unavailable" above this excluded share of eligible seeds (default 0.25). */
  maxEvaluatorOutageShare?: number;
}

const DEFAULT_GATE_ALPHA = 0.05;
const DEFAULT_MAX_EVALUATOR_OUTAGE_SHARE = 0.25;

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

/**
 * The slice of a ScoredPrompt grade the gate reads (structural, so this module
 * stays import-free). The violation counters are optional here only so the
 * holdout callers, which do not read them, type-check: a grade that omits one
 * reads as violation-free. The success cohort must therefore enter through
 * toSuccessTrials, which requires all four.
 */
export interface GradeLike {
  id: string;
  pass: boolean;
  unresolvable?: boolean;
  judgeUnavailable?: boolean;
  priceLeaks?: number;
  guarantees?: number;
  emptyReplies?: number;
  claimViolations?: ReadonlyArray<string>;
}

/** A grade with every violation counter present -- the only shape the success cohort may be judged on. */
export type SuccessGradeLike = GradeLike & {
  priceLeaks: number;
  guarantees: number;
  emptyReplies: number;
  claimViolations: ReadonlyArray<string>;
};

const hasCriticalViolation = (g: GradeLike): boolean =>
  (g.priceLeaks ?? 0) > 0 || (g.guarantees ?? 0) > 0 || (g.emptyReplies ?? 0) > 0 || (g.claimViolations?.length ?? 0) > 0;

/** Fold R scorings of one prompt over one cohort into per-seed trials. */
export function toSeedTrials(runs: ReadonlyArray<{ grades: ReadonlyArray<GradeLike> }>): SeedTrials[] {
  const bySeed = new Map<string, SeedTrials & { unverified: boolean[] }>();
  for (const run of runs) {
    for (const g of run.grades) {
      const t = bySeed.get(g.id) ?? { id: g.id, passes: [], unresolvable: false, evaluatorUnavailable: false, unverified: [], violations: [] };
      t.passes.push(g.pass && !g.unresolvable);
      t.unverified.push(Boolean(g.judgeUnavailable));
      t.violations.push(hasCriticalViolation(g));
      t.unresolvable ||= Boolean(g.unresolvable);
      t.evaluatorUnavailable ||= Boolean(g.judgeUnavailable);
      bySeed.set(g.id, t);
    }
  }
  return [...bySeed.values()];
}

/**
 * toSeedTrials for the success cohort. The type requires all four violation
 * counters, and the same check runs at runtime: a grade that lacks one throws
 * instead of reading violation-free. promptEvolution.ts ScoredPrompt.grades
 * carries no claimViolations today, so it cannot be fed here until it does --
 * a blind new-violation veto must fail loudly, not pass quietly.
 */
export function toSuccessTrials(runs: ReadonlyArray<{ grades: ReadonlyArray<SuccessGradeLike> }>): SeedTrials[] {
  for (const run of runs) {
    for (const g of run.grades) {
      const missing: string[] = [];
      for (const k of ["priceLeaks", "guarantees", "emptyReplies"] as const) if (typeof g[k] !== "number") missing.push(k);
      if (!Array.isArray(g.claimViolations)) missing.push("claimViolations");
      if (missing.length) {
        throw new Error(`toSuccessTrials: grade ${g.id} has no ${missing.join(", ")} -- a success cohort cannot be checked for violations it was not given`);
      }
    }
  }
  return toSeedTrials(runs);
}

const rate = (p: boolean[]) => (p.length ? p.filter(Boolean).length / p.length : 0);
const count = (p: boolean[]) => p.filter(Boolean).length;

type Pair = { b: SeedTrials; c: SeedTrials };

/**
 * Per-replay "graded without the judge" flags. A well-formed array that marks
 * at least one replay is used as given; otherwise a seed flagged at all
 * (evaluatorUnavailable, or a malformed array with any true) is read as
 * unverified on EVERY replay -- the stricter reading, never the looser.
 */
function unverifiedOf(s: SeedTrials): boolean[] {
  const u = s.unverified;
  if (u && u.length === s.passes.length && u.some(Boolean)) return u;
  const down = s.evaluatorUnavailable || Boolean(u?.some(Boolean));
  return s.passes.map(() => down);
}

const isDownSeed = (s: SeedTrials) => unverifiedOf(s).some(Boolean);

/**
 * An outage pair read at its WORST for the candidate (header: EVALUATOR
 * OUTAGE). ghostReplay.gradeRepliesWithJudge leaves the regex verdict standing
 * when the judge is down, and that verdict can be wrong either way: an
 * unverified hit may be a deflection the judge would fail, an unverified miss
 * may be a reply it would rescue. So an unverified candidate replay reads
 * FAIL, an unverified baseline replay reads PASS unless it carried a critical
 * violation (a pass needs zero violations whatever the judge says), and judged
 * replays keep their bits. Every judged outcome is at least this good for the
 * candidate, replay by replay.
 */
function worstCaseForCandidate({ b, c }: Pair): Pair {
  const ub = unverifiedOf(b);
  const uc = unverifiedOf(c);
  return {
    b: { ...b, passes: b.passes.map((p, i) => p || (ub[i] && !b.violations[i])) },
    c: { ...c, passes: c.passes.map((p, i) => p && !uc[i]) },
  };
}

/**
 * The one eligibility rule every pass-based comparison here shares:
 *   eligible = baseline-resolvable (the BASELINE's verdict only) and replayed
 *              in both arms;
 *   pairs    = eligible minus any seed either arm's judge could not grade
 *              (the judged comparison);
 *   worst    = those outage seeds in their worst case for the candidate, kept
 *              so they can count AGAINST the candidate (never for it).
 */
function pairSeeds(baseline: ReadonlyArray<SeedTrials>, candidate: ReadonlyArray<SeedTrials>) {
  const cand = new Map(candidate.map((s) => [s.id, s]));
  const eligible: Pair[] = baseline
    .filter((b) => !b.unresolvable && b.passes.length > 0)
    .flatMap((b) => {
      const c = cand.get(b.id);
      return c && c.passes.length > 0 ? [{ b, c }] : [];
    });
  const isDown = ({ b, c }: Pair) => isDownSeed(b) || isDownSeed(c);
  const down = eligible.filter(isDown);
  return {
    eligible: eligible.length,
    pairs: eligible.filter((p) => !isDown(p)),
    worst: down.map(worstCaseForCandidate),
    outage: down.map(({ b }) => b.id),
  };
}

/** One integer scale for every per-seed difference: L = lcm over pairs of bN*cN, so the permutation DP stays exact. */
function diffScale(pairs: ReadonlyArray<Pair>): number {
  return pairs.reduce((l, { b, c }) => {
    const den = b.passes.length * c.passes.length;
    return (l * den) / gcd(l, den);
  }, 1);
}

/** d = cPass/cN - bPass/bN, in units of 1/L. */
function scaledDiff({ b, c }: Pair, L: number): number {
  return ((count(c.passes) * b.passes.length - count(b.passes) * c.passes.length) * L) / (b.passes.length * c.passes.length);
}

/** A reliably handled call reliably lost: baseline passes every replay, candidate none. */
const isRegression = ({ b, c }: Pair) => rate(b.passes) === 1 && rate(c.passes) === 0;

/** Per-seed differences (on scale L) and counts over judged pairs. */
function pairStats(pairs: Pair[], L: number) {
  const diffs: number[] = [];
  let improved = 0;
  let worsened = 0;
  let baselineSelfDisagreement = 0;
  const regressedSeeds: string[] = [];
  const baseTotals = { passes: 0, trials: 0 };
  const candTotals = { passes: 0, trials: 0 };
  for (const p of pairs) {
    const { b, c } = p;
    const rb = rate(b.passes);
    const rc = rate(c.passes);
    if (rc > rb) improved++;
    else if (rc < rb) worsened++;
    if (rb > 0 && rb < 1) baselineSelfDisagreement++;
    if (isRegression(p)) regressedSeeds.push(b.id);
    diffs.push(scaledDiff(p, L));
    baseTotals.passes += count(b.passes);
    baseTotals.trials += b.passes.length;
    candTotals.passes += count(c.passes);
    candTotals.trials += c.passes.length;
  }
  return { diffs, improved, worsened, baselineSelfDisagreement, regressedSeeds, baseTotals, candTotals };
}

/** No outcome on n seeds can beat a clean sweep, p = 2^-n. */
const bestP = (n: number) => (n ? 2 ** -n : 1);

/**
 * The fewest comparable seeds whose clean sweep reaches alpha (2^-n <= alpha):
 * 5 at 0.05, 6 at 0.025, 7 at 0.01. Below it every gate here reads
 * "underpowered" -- size a cohort from this, not from hope.
 */
export function minSeedsForAlpha(alpha: number): number {
  if (!(alpha > 0)) return Number.POSITIVE_INFINITY;
  let n = 0;
  while (bestP(n) > alpha) n++;
  return n;
}

/**
 * The outage refusals that do not depend on the statistic: too large a share
 * of the eligible seeds lost, the loss alone cost the power (the eligible
 * seeds could reach alpha, the survivors cannot), or an outage seed's worst
 * case shows a possible regression.
 */
function outageRefuses(eligible: number, outage: number, alpha: number, maxShare: number, possibleRegressions: number): boolean {
  if (!outage) return false;
  const share = outage / eligible;
  return share > maxShare || (bestP(eligible) <= alpha && bestP(eligible - outage) > alpha) || possibleRegressions > 0;
}

export function judgeHoldout(
  baseline: SeedTrials[],
  candidate: SeedTrials[],
  opts: GateOptions = {},
): GateVerdict {
  const alpha = opts.alpha ?? DEFAULT_GATE_ALPHA;
  const maxShare = opts.maxEvaluatorOutageShare ?? DEFAULT_MAX_EVALUATOR_OUTAGE_SHARE;
  const { eligible, pairs, worst, outage } = pairSeeds(baseline, candidate);
  const L = diffScale([...pairs, ...worst]);
  const s = pairStats(pairs, L);

  const comparable = pairs.length;
  const n = s.improved + s.worsened;
  const pValue = signFlipP(s.diffs);
  // One-sided: an outage seed's worst-case loss counts against the candidate,
  // its gain is dropped. worstCaseP >= pValue always.
  const worstCaseP = signFlipP([...s.diffs, ...worst.map((p) => Math.min(scaledDiff(p, L), 0))]);
  const outageRegressionSeeds = worst.filter(isRegression).map(({ b }) => b.id);
  // A clean sweep — every comparable seed moved up — is the most extreme
  // assignment there is, so no outcome on this many seeds can beat 2^-n.
  const bestPossibleP = bestP(comparable);
  const reason: GateReason = s.regressedSeeds.length
    ? "regressed-seed"
    : outageRefuses(eligible, outage.length, alpha, maxShare, outageRegressionSeeds.length)
      ? "evaluator-unavailable"
      : bestPossibleP > alpha
        ? "underpowered"
        : pValue > alpha
          ? "not-significant"
          : worstCaseP > alpha
            ? "evaluator-unavailable"
            : "improved";

  return {
    accept: reason === "improved",
    reason,
    comparable,
    improved: s.improved,
    worsened: s.worsened,
    tied: comparable - n,
    pValue,
    bestPossibleP,
    baselineSelfDisagreement: s.baselineSelfDisagreement,
    regressedSeeds: s.regressedSeeds,
    baseline: s.baseTotals,
    candidate: s.candTotals,
    eligible,
    evaluatorUnavailableSeeds: outage,
    evaluatorOutageShare: eligible ? outage.length / eligible : 0,
    outageRegressionSeeds,
    worstCaseP,
  };
}

/**
 * The sealed confirmation check: judgeHoldout's statistics, unchanged, on a
 * cohort the loop has never scored (promptEvolutionCohorts.splitSeedsThreeWay
 * + excludeConsumed). Run it ONLY after the holdout accepted, once per
 * candidate, then mark the cohort consumed -- a confirmation set that is
 * re-read becomes a second holdout and inherits its winner's curse. When
 * several candidates reach confirmation over time, the caller owns the
 * multiplicity: pass alpha / (number of confirmations spent on this cohort
 * family) rather than re-using 0.05.
 */
export function judgeConfirmation(
  baseline: SeedTrials[],
  candidate: SeedTrials[],
  opts: GateOptions = {},
): GateVerdict {
  return judgeHoldout(baseline, candidate, opts);
}

export interface PairedTrainComparison {
  /** Passing replays of the baseline over the comparable (judged) seeds. */
  basePasses: number;
  /** Passing replays of the candidate over the SAME seeds. */
  candPasses: number;
  /**
   * Outage seeds where the candidate's worst-case pass rate is below the
   * baseline's (worstCaseForCandidate: an unverified candidate replay reads
   * fail, an unverified violation-free baseline replay reads pass) -- counted
   * as candidate losses. An outage seed's gain is never counted: the outage
   * may cost the candidate, never help it.
   */
  outageLosses: number;
  /** candPasses - basePasses - outageLosses -- the train selection key; > 0 (and usable) to go on to the holdout. */
  margin: number;
  comparable: number;
  /** Baseline seeds left out of the judged count: baseline-unresolvable, not replayed by the candidate, or judge-unavailable in either arm. */
  excluded: number;
  /** Of `excluded`, the seeds dropped for an evaluator outage. */
  evaluatorUnavailable: number;
  /** evaluatorUnavailable / eligible seeds; 0 when nothing was eligible. */
  evaluatorOutageShare: number;
  /**
   * false = this reading measured nothing the selection may act on: no
   * eligible seed, or an outage share above the cap. Never advance a
   * candidate on an unusable reading, whatever its margin says.
   */
  usable: boolean;
}

/**
 * Train selection on one scoring per arm, under the holdout's eligibility
 * rule: only seeds the BASELINE ruled unresolvable leave; a candidate's own
 * "unresolvable" counts as a fail; a judge outage in either arm drops the seed
 * from the judged counts, but its worst-case loss still counts against the
 * candidate (outageLosses), and too large an outage share makes the reading
 * unusable.
 * Compare candidates by `margin`, never by passRate -- each passRate has its
 * own denominator.
 */
export function comparePairedTrain(
  baseRunGrades: ReadonlyArray<GradeLike>,
  candRunGrades: ReadonlyArray<GradeLike>,
  opts: Pick<GateOptions, "maxEvaluatorOutageShare"> = {},
): PairedTrainComparison {
  const maxShare = opts.maxEvaluatorOutageShare ?? DEFAULT_MAX_EVALUATOR_OUTAGE_SHARE;
  const base = toSeedTrials([{ grades: baseRunGrades }]);
  const { eligible, pairs, worst, outage } = pairSeeds(base, toSeedTrials([{ grades: candRunGrades }]));
  const basePasses = pairs.reduce((n, { b }) => n + count(b.passes), 0);
  const candPasses = pairs.reduce((n, { c }) => n + count(c.passes), 0);
  const outageLosses = worst.filter(({ b, c }) => rate(c.passes) < rate(b.passes)).length;
  const share = eligible ? outage.length / eligible : 0;
  return {
    basePasses,
    candPasses,
    outageLosses,
    margin: candPasses - basePasses - outageLosses,
    comparable: pairs.length,
    excluded: base.length - pairs.length,
    evaluatorUnavailable: outage.length,
    evaluatorOutageShare: share,
    usable: eligible > 0 && share <= maxShare,
  };
}

export type SuccessCohortReason =
  | "preserved"
  | "success-regressed-seed"
  | "success-new-violation"
  | "evaluator-unavailable"
  | "success-empty"
  | "underpowered"
  | "success-degraded";

export interface SuccessCohortVerdict {
  /** true unless reason is "preserved". */
  veto: boolean;
  reason: SuccessCohortReason;
  /** Pass-based comparison, same eligibility as the holdout. */
  eligible: number;
  comparable: number;
  improved: number;
  worsened: number;
  tied: number;
  /** One-sided exact sign-flip p that the candidate is WORSE by more than `margin`; 1 when nothing differs. */
  pDegraded: number;
  /**
   * pDegraded with each outage seed's worst-case "candidate worse" evidence
   * added (and its "candidate better" evidence dropped). <= pDegraded; when only
   * this one reaches alpha the veto reads evaluator-unavailable.
   */
  pDegradedWorstCase: number;
  /** Smallest pDegraded `comparable` seeds could reach. Above alpha the cohort is "underpowered" (a veto). */
  bestPossibleP: number;
  margin: number;
  regressedSeeds: string[];
  /** Seeds where a candidate replay violated and no baseline replay did. */
  newViolationSeeds: string[];
  /** Seeds checked for violations: replayed in both arms, outage and unresolvable included. */
  violationChecked: number;
  evaluatorUnavailableSeeds: string[];
  evaluatorOutageShare: number;
  /** Outage seeds whose worst case shows a reliably won call reliably lost; any one vetoes as evaluator-unavailable. */
  outageRegressionSeeds: string[];
  baseline: { passes: number; trials: number; violations: number };
  candidate: { passes: number; trials: number; violations: number };
}

export interface SuccessCohortOptions extends GateOptions {
  /**
   * Non-inferiority margin in per-seed pass-rate units (default 0). The
   * degradation veto fires only on significant evidence the candidate is
   * worse by MORE than this on average: 0.05 tolerates a 5-point per-seed
   * drop. The test shifts each difference by the margin before the sign
   * flip; at 0 that is exact (the arms are exchangeable under the null), above
   * 0 it assumes the shifted differences are symmetric -- an approximation.
   * The per-seed vetoes ignore the margin.
   */
  margin?: number;
}

/** Margin resolution in pass-rate units, so the shifted DP stays on integers. */
const MARGIN_RESOLUTION = 1000;

/**
 * The success-regression cohort: calls that already WON, replayed under both
 * prompts, evaluator-only. Vetoes, in precedence order:
 *   success-regressed-seed  a won call the baseline passes on every replay and
 *                           the candidate fails on every replay;
 *   success-new-violation   any candidate replay with a critical violation on
 *                           a seed whose baseline replays had none. Violations
 *                           are deterministic, so this check reads EVERY seed
 *                           replayed in both arms -- outage and unresolvable
 *                           seeds included: compliance does not depend on the
 *                           judge;
 *   evaluator-unavailable   the outage rule of judgeHoldout: share cap, lost
 *                           power, or an outage seed whose worst case
 *                           (worstCaseForCandidate) shows a won call lost
 *                           (outageRegressionSeeds) -- an outage must not
 *                           hide the loss this cohort exists to catch, and a
 *                           won call the candidate deflected while its judge
 *                           was down still reads as lost;
 *   success-empty           nothing comparable -- "no evidence of harm" from no
 *                           evidence is a false green, so it vetoes;
 *   underpowered            1 to minSeedsForAlpha(alpha) - 1 comparable seeds:
 *                           the degradation test cannot reach alpha, so only
 *                           half the gate ran. Same reasoning as success-empty
 *                           (and the same name as the holdout's refusal);
 *   success-degraded        one-sided exact sign-flip p (candidate worse by
 *                           more than `margin`) <= alpha;
 *   evaluator-unavailable   only the worst case (outage seeds' worst-case
 *                           "worse" evidence added) reaches alpha;
 *   else preserved.
 * Per-seed vetoes come first because an outage cannot manufacture them; the
 * statistic comes last because it is the one an outage can bias.
 */
export function judgeSuccessCohort(
  baseline: SeedTrials[],
  candidate: SeedTrials[],
  opts: SuccessCohortOptions = {},
): SuccessCohortVerdict {
  const alpha = opts.alpha ?? DEFAULT_GATE_ALPHA;
  const maxShare = opts.maxEvaluatorOutageShare ?? DEFAULT_MAX_EVALUATOR_OUTAGE_SHARE;
  const margin = opts.margin ?? 0;
  const { eligible, pairs, worst, outage } = pairSeeds(baseline, candidate);
  const L = diffScale([...pairs, ...worst]);
  const s = pairStats(pairs, L);
  const outageRegressionSeeds = worst.filter(isRegression).map(({ b }) => b.id);

  const cand = new Map(candidate.map((c) => [c.id, c]));
  const checked = baseline.flatMap((b) => {
    const c = cand.get(b.id);
    return b.passes.length > 0 && c && c.passes.length > 0 ? [{ b, c }] : [];
  });
  const newViolationSeeds = checked
    .filter(({ b, c }) => !b.violations.some(Boolean) && c.violations.some(Boolean))
    .map(({ b }) => b.id);
  const violationsOf = (side: "b" | "c") => checked.reduce((n, p) => n + count(p[side].violations), 0);

  // Candidate-WORSE statistic: e = (baseline - candidate) - margin, on the
  // integer scale. Margin 0 keeps the holdout's exact unit; a margin moves to
  // a 1/1000 grid so the shift stays an integer.
  const k = margin ? MARGIN_RESOLUTION : 1;
  const marginUnits = Math.round(margin * L * k);
  const worse = (d: number) => -d * k - marginUnits;
  const judgedE = s.diffs.map(worse);
  const pDegraded = signFlipP(judgedE);
  // One-sided: an outage seed's worst-case "worse" evidence is added, its
  // "better" evidence dropped -- pDegradedWorstCase <= pDegraded always.
  const pDegradedWorstCase = signFlipP([...judgedE, ...worst.map((p) => Math.max(worse(scaledDiff(p, L)), 0))]);
  const comparable = pairs.length;
  const bestPossibleP = bestP(comparable);

  const reason: SuccessCohortReason = s.regressedSeeds.length
    ? "success-regressed-seed"
    : newViolationSeeds.length
      ? "success-new-violation"
      : outageRefuses(eligible, outage.length, alpha, maxShare, outageRegressionSeeds.length)
        ? "evaluator-unavailable"
        : comparable === 0
          ? "success-empty"
          : bestPossibleP > alpha
            ? "underpowered"
            : pDegraded <= alpha
              ? "success-degraded"
              : pDegradedWorstCase <= alpha
                ? "evaluator-unavailable"
                : "preserved";

  return {
    veto: reason !== "preserved",
    reason,
    eligible,
    comparable,
    improved: s.improved,
    worsened: s.worsened,
    tied: comparable - s.improved - s.worsened,
    pDegraded,
    pDegradedWorstCase,
    bestPossibleP,
    margin,
    regressedSeeds: s.regressedSeeds,
    newViolationSeeds,
    violationChecked: checked.length,
    evaluatorUnavailableSeeds: outage,
    evaluatorOutageShare: eligible ? outage.length / eligible : 0,
    outageRegressionSeeds,
    baseline: { ...s.baseTotals, violations: violationsOf("b") },
    candidate: { ...s.candTotals, violations: violationsOf("c") },
  };
}

type OutageFields = "eligible" | "evaluatorUnavailableSeeds" | "evaluatorOutageShare" | "outageRegressionSeeds" | "worstCaseP";

/** The outage tail shared by both describe lines. */
function describeOutage(outage: number, eligible: number | undefined, possibleRegressions: ReadonlyArray<string> | undefined): string {
  return (
    (outage ? ` · evaluator outage ${outage}/${eligible ?? "?"}` : "") +
    (possibleRegressions?.length ? ` · possible regression under outage ${possibleRegressions.join(",")}` : "")
  );
}

/**
 * One line for cron_log details, Telegram and the CLI -- the same words everywhere.
 * Accepts a verdict written before 2026-10-09 (a persisted kv row, an old
 * fixture) that has no outage fields: it describes it without them rather
 * than throwing inside the cron's reporting path.
 */
export function describeVerdict(v: Omit<GateVerdict, OutageFields> & Partial<Pick<GateVerdict, OutageFields>>): string {
  const outage = v.evaluatorUnavailableSeeds?.length ?? 0;
  const worst = outage && v.worstCaseP !== undefined && v.worstCaseP !== v.pValue ? ` · worst-case p=${v.worstCaseP.toFixed(3)}` : "";
  return (
    `${v.reason} · seeds +${v.improved} -${v.worsened} =${v.tied} of ${v.comparable}` +
    ` · perm p=${v.pValue.toFixed(3)} (best possible ${v.bestPossibleP.toFixed(3)})` +
    ` · replays ${v.candidate.passes}/${v.candidate.trials} vs ${v.baseline.passes}/${v.baseline.trials}` +
    ` · baseline self-disagreement ${v.baselineSelfDisagreement}/${v.comparable}` +
    (v.regressedSeeds.length ? ` · regressed ${v.regressedSeeds.join(",")}` : "") +
    describeOutage(outage, v.eligible, v.outageRegressionSeeds) +
    worst
  );
}

/** The success-cohort twin of describeVerdict. */
export function describeSuccessVerdict(v: SuccessCohortVerdict): string {
  return (
    `success ${v.reason} · seeds +${v.improved} -${v.worsened} =${v.tied} of ${v.comparable}` +
    ` · worse p=${v.pDegraded.toFixed(3)} (best possible ${v.bestPossibleP.toFixed(3)}${v.margin ? `, margin ${v.margin}` : ""})` +
    ` · replays ${v.candidate.passes}/${v.candidate.trials} vs ${v.baseline.passes}/${v.baseline.trials}` +
    ` · violating replays ${v.candidate.violations} vs ${v.baseline.violations} over ${v.violationChecked} seeds` +
    (v.regressedSeeds.length ? ` · regressed ${v.regressedSeeds.join(",")}` : "") +
    (v.newViolationSeeds.length ? ` · new violation ${v.newViolationSeeds.join(",")}` : "") +
    describeOutage(v.evaluatorUnavailableSeeds.length, v.eligible, v.outageRegressionSeeds) +
    (v.pDegradedWorstCase !== v.pDegraded ? ` · worst-case worse p=${v.pDegradedWorstCase.toFixed(3)}` : "")
  );
}
