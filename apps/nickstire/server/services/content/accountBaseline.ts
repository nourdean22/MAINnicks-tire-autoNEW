/**
 * The measured @nicks_tire_euclid baseline — his numbers, not a blog's median.
 *
 * WHY THIS FILE EXISTS. Three content-strategy reports were produced for this
 * account and two of them contradict each other. The tiebreaker is not a better
 * argument, it is the account's own Instagram Insights export. Every rate below
 * carries the denominator it was computed over, because a ratio that travels
 * without its sample size gets re-quoted by the next reader as a fact about the
 * world (the 72%-vs-18% incident is the house precedent).
 *
 * WHAT IT REFUTES. "Produce more faceless AI content" is refuted by these
 * numbers, not by taste: the account already runs a faceless engine at volume
 * and converts at 0.53% profile visits. Reach is not the constraint.
 */

/** A rate that cannot be quoted without the population it was measured over. */
export interface MeasuredRate {
  /** Numerator — the observed count. */
  readonly count: number;
  /** Denominator — what `count` was divided by. Never implicit. */
  readonly of: number;
  /** What the denominator IS, in words. "views" and "followers" are not interchangeable. */
  readonly denominatorLabel: string;
  /** count / of, as a percentage, rounded to 2dp. Derived — never hand-typed. */
  readonly pct: number;
}

function rate(count: number, of: number, denominatorLabel: string): MeasuredRate {
  if (of <= 0) {
    throw new Error(
      `MeasuredRate needs a positive denominator; got ${of} for "${denominatorLabel}". ` +
        "A rate over zero samples is not zero, it is UNMEASURED.",
    );
  }
  return { count, of, denominatorLabel, pct: Math.round((count / of) * 10000) / 100 };
}

/**
 * Verified 30-day Instagram Insights export. Operator-supplied, treated as
 * production evidence (rank 1 in the source-of-truth hierarchy).
 */
export const ACCOUNT_BASELINE = {
  handle: "@nicks_tire_euclid",
  /** The window these numbers describe. A baseline without a date is a rumour. */
  capturedOn: "2026-08-28",
  windowDays: 30,

  /** Raw counts, so every rate below can be recomputed from source. */
  views: 13_871,
  interactions: 137,
  profileVisits: 74,
  websiteTaps: 1,
  uniqueAccountsEngaged: 35,
  followers: 3_269,
  postsLifetime: 630,

  /** The four ratios that matter, each with its denominator attached. */
  rates: {
    /** Interactions per view. The engine's reach is fine; this is where it dies. */
    interactionRate: rate(137, 13_871, "views (30d)"),
    /** Profile visits per view — the first step of the only funnel that earns money. */
    profileVisitRate: rate(74, 13_871, "views (30d)"),
    /** Unique engaged accounts per follower. */
    uniqueEngagedRate: rate(35, 3_269, "followers"),
    /** Website taps per profile visit. n=1 — reported, never ranked on. */
    websiteTapRate: rate(1, 74, "profile visits (30d)"),
  },

  /**
   * 70.5% of reach is non-followers. This is the ONE thing working, it is the
   * cheapest thing to break, and every change below is measured against holding
   * it — a "fix" that lifts interactions while collapsing distribution is a loss.
   */
  nonFollowerReachPct: 70.5,
} as const;

/**
 * Targets. Deliberately expressed against the SAME denominators as the
 * baseline, so a future comparison is arithmetic rather than interpretation.
 */
export const BASELINE_TARGETS = {
  interactionRatePct: 3.0,
  profileVisitRatePct: 2.0,
  uniqueEngagedRatePct: 4.0,
  /** A floor, not a target: hold what already works. */
  nonFollowerReachFloorPct: 70.5,
} as const;

/** Sample sizes below this cannot support a ranking claim, only a look. */
export const MIN_SAMPLE_FOR_RANKING = 10;

export interface PostMetrics {
  readonly views: number;
  readonly interactions: number;
  readonly profileVisits: number;
  readonly saves: number;
  readonly sends: number;
  readonly follows: number;
  readonly websiteTaps: number;
  /** Fraction of viewers reaching the end, 0-1. NULL when IG did not report it. */
  readonly retention: number | null;
  /** Fraction of reach from non-followers, 0-1. NULL when not reported. */
  readonly nonFollowerReach: number | null;
}

export type DiagnosisCode =
  | "HOOK_OVERPROMISED"
  | "WEAK_FRANCHISE_IDENTITY"
  | "BIO_AND_OFFER_BROKEN"
  | "REPACKAGE_OPENING"
  | "HOLDING"
  | "UNMEASURED";

export interface Diagnosis {
  readonly code: DiagnosisCode;
  /** What to change. Not a number — an instruction. */
  readonly change: string;
  /** What NOT to change, where the wrong fix is the tempting one. */
  readonly doNotChange: string;
  /** The measured facts that produced this call, quoted with denominators. */
  readonly evidence: string;
}

/**
 * DECISION RULES AS LOGIC, not as a dashboard of numbers.
 *
 * The account does not need another chart. Each rule below names the change to
 * make AND the change to resist, because in three of the four cases the
 * intuitive fix is the wrong one (a poor-retention post tempts you to rewrite
 * the hook that is doing its job).
 *
 * Order matters: the funnel is evaluated from the deepest failure outward, so
 * "your bio is broken" wins over "your opening is weak" when both are true —
 * fixing the opening first would just send more people to the same dead end.
 */
export function diagnose(m: PostMetrics): Diagnosis {
  const per = (n: number) => (m.views > 0 ? n / m.views : 0);

  if (m.views < MIN_SAMPLE_FOR_RANKING) {
    return {
      code: "UNMEASURED",
      change: `Nothing yet — ${m.views} views is below the ${MIN_SAMPLE_FOR_RANKING}-view floor for any read.`,
      doNotChange: "Do not rewrite anything off a sample this small.",
      evidence: `views=${m.views} (< ${MIN_SAMPLE_FOR_RANKING})`,
    };
  }

  const visitRate = per(m.profileVisits);
  const tapRate = m.profileVisits > 0 ? m.websiteTaps / m.profileVisits : 0;

  // Deepest failure first: they arrived at the profile and left.
  if (visitRate >= BASELINE_TARGETS.profileVisitRatePct / 100 && tapRate < 0.05) {
    return {
      code: "BIO_AND_OFFER_BROKEN",
      change:
        "Fix the bio and the offer — the content already earned the visit and the profile lost it.",
      doNotChange:
        "Do not touch this post's hook, script, or format. They worked; the destination did not.",
      evidence: `profile visits ${m.profileVisits}/${m.views} views = ${(visitRate * 100).toFixed(2)}% (>= target ${BASELINE_TARGETS.profileVisitRatePct}%), website taps ${m.websiteTaps}/${m.profileVisits} visits = ${(tapRate * 100).toFixed(1)}%`,
    };
  }

  // They watched and shared but did not stay for the franchise.
  if (per(m.sends) >= 0.01 && m.follows <= 1) {
    return {
      code: "WEAK_FRANCHISE_IDENTITY",
      change:
        "Strengthen the franchise signature — name the series on-screen and end on the recurring promise, so a send converts into a follow.",
      doNotChange: "Do not chase a new topic; the topic is already earning sends.",
      evidence: `sends ${m.sends}/${m.views} views = ${(per(m.sends) * 100).toFixed(2)}%, follows ${m.follows}`,
    };
  }

  // Reach came, retention did not.
  if (m.retention !== null && m.views >= 500 && m.retention < 0.35) {
    return {
      code: "HOOK_OVERPROMISED",
      change:
        "Fix the PAYOFF, not the hook — deliver in the first 3 seconds what the opening promised.",
      doNotChange:
        "Do not weaken the hook. It earned the views; rewriting it costs reach and leaves the drop-off where it is.",
      evidence: `views ${m.views}, retention ${(m.retention * 100).toFixed(0)}% (< 35%)`,
    };
  }

  // People kept it but it never travelled.
  if (per(m.saves) >= 0.02 && m.nonFollowerReach !== null && m.nonFollowerReach < 0.5) {
    return {
      code: "REPACKAGE_OPENING",
      change:
        "Repackage the OPENING only — same body, new first frame and first line. The content is worth keeping; distribution never picked it up.",
      doNotChange: "Do not rewrite the body or re-shoot. Saves prove the substance landed.",
      evidence: `saves ${m.saves}/${m.views} views = ${(per(m.saves) * 100).toFixed(2)}%, non-follower reach ${(m.nonFollowerReach * 100).toFixed(0)}% (< 50%)`,
    };
  }

  return {
    code: "HOLDING",
    change: "No single failure dominates — leave it and let the sample grow.",
    doNotChange: "Do not tune on noise.",
    evidence: `views ${m.views}, interactions ${m.interactions}, profile visits ${m.profileVisits}`,
  };
}

/**
 * Operator-only actions. Recorded so they stay visible as blockers instead of
 * being silently designed around — none of them can be done from this codebase.
 */
export const OPERATOR_ACTIONS = [
  "Bio + link destination (the BIO_AND_OFFER_BROKEN rule has no code-side fix).",
  "Story Highlights covering the recurring franchises.",
  "Pinned posts — the three that best state what the shop is.",
  "Filming real shop footage (unlocks every zero-credit REAL concept in the catalog).",
] as const;
