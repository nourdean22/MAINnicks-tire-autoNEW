/**
 * Which themes actually EARNED distribution — not which got likes.
 *
 * THE DEFECT THIS REPLACES. `getReelGenerationSignal` ranked themes by
 * `instagramAnalytics.engagementRate`, which is
 * `(likes + comments) / followers`. On Reels that is close to a vanity metric:
 * likes and comments come mostly from people the algorithm ALREADY delivered
 * the post to, so ranking by it asks "what did our existing audience react to"
 * when the question is "what does Instagram push to strangers".
 *
 * Meanwhile `ig_metric_snapshots` has carried the metrics that DO predict
 * distribution — `saved`, `shares`, `views`, `avgWatchTimeMs`, `skipRate` —
 * since migration 0108, and nothing ranked on them. 475 rows as of 2026-08-16,
 * every one with saves and shares, 155 with watch-time and skip-rate.
 *
 * Pure by design: the IO half lives in server/pipelines/instagram-data.ts. This
 * file takes rows and returns a ranking, so the weighting is testable without a
 * database.
 */

/** One post's themes plus whatever Instagram actually reported for it. */
export interface ThemePerformanceRow {
  themes: string[];
  reach?: number | null;
  saved?: number | null;
  shares?: number | null;
  views?: number | null;
  avgWatchTimeMs?: number | null;
  /** 0..1. Fraction who skipped. LOWER is better — the only inverted metric. */
  skipRate?: number | null;
}

export interface ScoredTheme {
  theme: string;
  /** Mean distribution score across the posts carrying this theme, 0..1-ish. */
  score: number;
  /** How many posts backed it. One post is an anecdote, not a signal. */
  posts: number;
  /** Which metrics were actually present — never inferred from a default. */
  basis: Array<"saves" | "shares" | "retention">;
}

/**
 * Weights. Saves and shares outrank retention because they are ACTIONS a viewer
 * took — a save is "I will need this", a share is "someone I know needs this" —
 * and for a tire shop both map to intent far better than watching to the end.
 * Retention is real signal but a 6-second clip can be watched fully out of
 * inertia, so it is a supporting term rather than a driver.
 */
const W_SAVES = 0.45;
const W_SHARES = 0.35;
const W_RETENTION = 0.20;

/**
 * A theme needs this many posts before it can be ranked. Below it the mean is
 * noise: one lucky Reel would otherwise pin the whole content calendar to
 * whatever it happened to be about.
 */
export const MIN_POSTS_PER_THEME = 2;

/** Normalise a rate into 0..1 without letting one viral post dominate. */
function rate(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  const r = numerator / denominator;
  if (!Number.isFinite(r) || r < 0) return null;
  // 10% save-rate is exceptional for this account; treat it as the ceiling so a
  // single outlier cannot swamp the mean.
  return Math.min(1, r / 0.1);
}

/**
 * Retention from watch time is NOT normalised against a fixed duration: reel
 * length varies and this table does not store it. `skipRate` is the honest
 * inverse when present; watch time alone is used only as a weak fallback,
 * capped at 30s which is the account's standard reel length.
 */
function retention(row: ThemePerformanceRow): number | null {
  if (row.skipRate != null && Number.isFinite(row.skipRate)) {
    return Math.max(0, Math.min(1, 1 - row.skipRate));
  }
  if (row.avgWatchTimeMs != null && Number.isFinite(row.avgWatchTimeMs)) {
    return Math.max(0, Math.min(1, row.avgWatchTimeMs / 30_000));
  }
  return null;
}

/**
 * Score ONE post. Returns null when Instagram reported nothing usable — which
 * is different from scoring zero, and the caller must keep the difference:
 * "not reported" must never be averaged in as "performed badly".
 */
export function scorePost(row: ThemePerformanceRow): { score: number; basis: ScoredTheme["basis"] } | null {
  const saves = rate(row.saved, row.reach ?? row.views);
  const shares = rate(row.shares, row.reach ?? row.views);
  const ret = retention(row);

  const parts: Array<[number, number]> = [];
  const basis: ScoredTheme["basis"] = [];
  if (saves != null) { parts.push([saves, W_SAVES]); basis.push("saves"); }
  if (shares != null) { parts.push([shares, W_SHARES]); basis.push("shares"); }
  if (ret != null) { parts.push([ret, W_RETENTION]); basis.push("retention"); }
  if (parts.length === 0) return null;

  // Re-weight over the metrics that ARE present, so a post missing watch-time
  // is not silently penalised against one that has it.
  const totalWeight = parts.reduce((s, [, w]) => s + w, 0);
  const score = parts.reduce((s, [v, w]) => s + v * w, 0) / totalWeight;
  return { score, basis };
}

/**
 * Rank themes by mean distribution score.
 *
 * Themes below MIN_POSTS_PER_THEME are dropped rather than ranked low — an
 * unproven theme is unknown, not bad, and demoting it would quietly bias the
 * calendar toward whatever was posted most often.
 */
export function rankThemesByDistribution(
  rows: ThemePerformanceRow[],
  limit = 3,
): ScoredTheme[] {
  const acc = new Map<string, { total: number; posts: number; basis: Set<string> }>();

  for (const row of rows) {
    const scored = scorePost(row);
    if (!scored) continue;
    for (const raw of row.themes ?? []) {
      const theme = String(raw).trim().toLowerCase();
      if (!theme || theme === "no-caption") continue;
      const cur = acc.get(theme) ?? { total: 0, posts: 0, basis: new Set<string>() };
      cur.total += scored.score;
      cur.posts += 1;
      for (const b of scored.basis) cur.basis.add(b);
      acc.set(theme, cur);
    }
  }

  return [...acc.entries()]
    .filter(([, v]) => v.posts >= MIN_POSTS_PER_THEME)
    .map(([theme, v]) => ({
      theme,
      score: v.total / v.posts,
      posts: v.posts,
      basis: [...v.basis] as ScoredTheme["basis"],
    }))
    .sort((a, b) => b.score - a.score || b.posts - a.posts)
    .slice(0, limit);
}
