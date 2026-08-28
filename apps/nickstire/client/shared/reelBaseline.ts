/**
 * Nick's OWN measured baseline. Every reel is scored against these numbers and
 * never against a published blog median.
 *
 * WHY THIS EXISTS. Benchmark providers disagree by roughly 10x depending on the
 * denominator they use - Socialinsider quotes a 9.78% REACH rate for 1K-5K
 * accounts while Buffer quotes a ~3.9% median engagement rate against FOLLOWERS.
 * Neither is comparable to the other, and neither is comparable to this shop.
 * The only honest yardstick is what this account actually did.
 *
 * SOURCE: operator's Instagram Insights, 30-day window, read 2026-08-28.
 * Follower count and post count independently confirmed the same day via the
 * Graph API (media_count=630, followers=3266) using the shop's own live token.
 *
 * THE READING. Reach is healthy and is the hard part - 70.5% of it is
 * non-follower, which means distribution works. Everything after the view is
 * broken: 13,871 views produced ONE website tap. The failure is conversion, not
 * reach, so more views into this funnel is more waste.
 */

export interface ReelBaseline {
  windowDays: number;
  measuredOn: string;
  views: number;
  interactions: number;
  profileVisits: number;
  websiteTaps: number;
  uniqueAccountsEngaged: number;
  followers: number;
  postsTotal: number;
  nonFollowerReachPct: number;
}

/** Measured, not estimated. Do not edit without a fresh Insights read. */
export const BASELINE: ReelBaseline = {
  windowDays: 30,
  measuredOn: "2026-08-28",
  views: 13871,
  interactions: 137,
  profileVisits: 74,
  websiteTaps: 1,
  uniqueAccountsEngaged: 35,
  followers: 3269,
  postsTotal: 630,
  nonFollowerReachPct: 70.5,
};

/**
 * A rate ALWAYS travels with its sample size. A bare percentage gets re-quoted
 * as a fact in the next document, and this repo has already learned that twice -
 * so `pct` is never exported without `numerator`/`denominator` beside it.
 */
export interface Rate {
  pct: number;
  numerator: number;
  denominator: number;
  /** e.g. "137 interactions / 13,871 views" - safe to paste into a report. */
  readonly basis: string;
}

const rate = (numerator: number, denominator: number, nLabel: string, dLabel: string): Rate => ({
  pct: denominator > 0 ? (numerator / denominator) * 100 : 0,
  numerator,
  denominator,
  basis: `${numerator.toLocaleString()} ${nLabel} / ${denominator.toLocaleString()} ${dLabel}`,
});

/** Ratios recomputed from the raw counts - never stored, so they cannot drift. */
export const baselineRates = {
  interactionRate: rate(BASELINE.interactions, BASELINE.views, "interactions", "views"),
  profileVisitRate: rate(BASELINE.profileVisits, BASELINE.views, "profile visits", "views"),
  uniqueEngagedRate: rate(BASELINE.uniqueAccountsEngaged, BASELINE.followers, "unique accounts", "followers"),
  websiteTapRate: rate(BASELINE.websiteTaps, BASELINE.views, "website taps", "views"),
};

/**
 * Targets. Each is a multiple of what he already does, not a blog median:
 * interaction ~3x current, profile-visit ~4x current, unique-engaged ~4x.
 * Reach is NOT a growth target - it is a floor to defend, because it already works.
 */
export const TARGETS = {
  interactionRatePct: 3.0,
  profileVisitRatePct: 2.0,
  uniqueEngagedRatePct: 4.0,
  /** Hold, do not "improve". Falling below this means distribution broke. */
  nonFollowerReachFloorPct: 70.5,
};

export interface PostMetrics {
  views: number;
  interactions: number;
  profileVisits: number;
  uniqueAccountsEngaged?: number;
  nonFollowerReachPct?: number;
}

export interface BaselineVerdict {
  metric: string;
  value: number;
  baseline: number;
  target: number;
  /** "above-target" | "above-baseline" | "at-or-below-baseline" */
  verdict: "above-target" | "above-baseline" | "at-or-below-baseline";
}

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

function judge(metric: string, value: number, baseline: number, target: number): BaselineVerdict {
  const verdict =
    value >= target ? "above-target" : value > baseline ? "above-baseline" : "at-or-below-baseline";
  return { metric, value, baseline, target, verdict };
}

/**
 * Score one post against HIS numbers. Pure. Returns a verdict per metric plus a
 * reach-floor breach flag - a post that wins engagement while losing
 * non-follower reach has traded away the only part that currently works.
 */
export function scoreAgainstBaseline(m: PostMetrics): {
  verdicts: BaselineVerdict[];
  reachFloorBreached: boolean;
} {
  const verdicts = [
    judge("interactionRate", pct(m.interactions, m.views), baselineRates.interactionRate.pct, TARGETS.interactionRatePct),
    judge("profileVisitRate", pct(m.profileVisits, m.views), baselineRates.profileVisitRate.pct, TARGETS.profileVisitRatePct),
  ];
  if (typeof m.uniqueAccountsEngaged === "number") {
    verdicts.push(
      judge(
        "uniqueEngagedRate",
        pct(m.uniqueAccountsEngaged, BASELINE.followers),
        baselineRates.uniqueEngagedRate.pct,
        TARGETS.uniqueEngagedRatePct,
      ),
    );
  }
  const reachFloorBreached =
    typeof m.nonFollowerReachPct === "number" && m.nonFollowerReachPct < TARGETS.nonFollowerReachFloorPct;
  return { verdicts, reachFloorBreached };
}
