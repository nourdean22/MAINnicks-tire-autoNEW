/**
 * XP DRIFT - statistical cadence-shift detector over the mastery XP log.
 *
 * Cheap math, no LLM: compares each stat's recent 7-day XP rate against its
 * trailing 28-day baseline and flags stats that have clearly DECAYED (the
 * thing you were building is slipping) or SURGED. This is the analytical
 * backbone for proactive coaching - the math finds WHEN something shifted;
 * the narrator (template now, LLM later) explains WHY. Keeping detection
 * statistical (not LLM) is deliberate: a modest local model is bad at
 * numeric reasoning, and this is robust + free.
 *
 * Reuses credit.ts's existing DB-side GROUP BY sum - no new query, no
 * migration. Read-only.
 */
import { xpEventTotalsSince } from "./credit";
import { daysAgo } from "@/lib/utils/datetime";

export interface XpDrift {
  stat: string;
  direction: "decay" | "surge";
  recentPerDay: number;
  baselinePerDay: number;
  /** recentPerDay / baselinePerDay - below 1 = slowing, above 1 = accelerating. */
  ratio: number;
}

// Conservative on purpose: a daily ticker that cries "drift" on noise is
// worse than silence. Only flag stats that WERE meaningfully active and
// whose rate clearly moved.
const MIN_BASELINE_XP_28D = 20; // ~0.7 XP/day floor before we'll call drift
const DECAY_RATIO = 0.4; // recent <= 40% of baseline = slipping
const SURGE_RATIO = 2.5; // recent >= 250% of baseline = surging

/**
 * Returns drifting stats, most-significant first (decays before surges -
 * a slip is the higher-value coaching nudge). Empty when nothing's drifting.
 */
export async function detectXpDrift(): Promise<XpDrift[]> {
  const [last7, last35] = await Promise.all([
    xpEventTotalsSince(daysAgo(7)),
    xpEventTotalsSince(daysAgo(35)),
  ]);

  const drifts: XpDrift[] = [];
  for (const [stat, total35] of last35) {
    const recent7 = last7.get(stat) ?? 0;
    const prior28 = Math.max(0, total35 - recent7);
    if (prior28 < MIN_BASELINE_XP_28D) continue; // not enough history to judge

    const recentPerDay = recent7 / 7;
    const baselinePerDay = prior28 / 28;
    if (baselinePerDay <= 0) continue;

    const ratio = recentPerDay / baselinePerDay;
    if (ratio <= DECAY_RATIO) {
      drifts.push({ stat, direction: "decay", recentPerDay, baselinePerDay, ratio });
    } else if (ratio >= SURGE_RATIO) {
      drifts.push({ stat, direction: "surge", recentPerDay, baselinePerDay, ratio });
    }
  }

  return drifts.sort((a, b) => {
    if (a.direction !== b.direction) return a.direction === "decay" ? -1 : 1;
    return Math.abs(1 - b.ratio) - Math.abs(1 - a.ratio);
  });
}
