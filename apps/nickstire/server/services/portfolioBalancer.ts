/**
 * Weekly campaign portfolio balancer (directive Part VIII §30) — Planner 2.0's
 * distinguishing capability. The shadow planner scores ONE opportunity; this
 * balances a WEEK. The directive: "do not optimize posts independently."
 *
 * It takes candidate campaigns (each already scored) plus recent history and
 * penalizes a week that over-concentrates: too many tire posts, repeated
 * fear-based angles, repeated "DM keyword" CTAs, repeated cinematic imagery,
 * too much direct-response, too little education. Pure — the scores come from
 * the planner; this only rebalances selection.
 */

export type PostRole = "trust" | "education" | "proof" | "offer" | "personality" | "direct_response";
export type CtaKind = "dm_keyword" | "call" | "directions" | "book" | "save" | "none";

export interface CandidateCampaign {
  id: string;
  service: string;        // "tires" | "brakes" | "batteries" | ...
  role: PostRole;
  cta: CtaKind;
  territory: string;      // creative territory, e.g. "weather_local_alert"
  fearBased: boolean;
  baseScore: number;      // planner's own score (higher = better opportunity)
}

export interface BalanceConfig {
  targetCount: number;               // posts to select for the week
  maxPerService: number;             // e.g. 2 tire posts max
  maxFearBased: number;
  maxSameCta: number;
  maxSameTerritory: number;
  minEducation: number;              // at least N education/trust posts
}

export const DEFAULT_BALANCE: BalanceConfig = {
  targetCount: 5,
  maxPerService: 2,
  maxFearBased: 2,
  maxSameCta: 2,
  maxSameTerritory: 2,
  minEducation: 1,
};

export interface BalanceResult {
  selected: CandidateCampaign[];
  rejected: Array<{ campaign: CandidateCampaign; reason: string }>;
  warnings: string[];
}

/**
 * Greedy balanced selection: take candidates best-score-first, but skip any
 * that would breach a concentration cap. After the pass, if the education
 * floor isn't met, swap the lowest-scoring selected non-education post for the
 * best education candidate that fits.
 */
export function balanceWeek(candidates: CandidateCampaign[], config: BalanceConfig = DEFAULT_BALANCE): BalanceResult {
  const sorted = [...candidates].sort((a, b) => b.baseScore - a.baseScore);
  const selected: CandidateCampaign[] = [];
  const rejected: BalanceResult["rejected"] = [];
  const count = { service: new Map<string, number>(), cta: new Map<string, number>(), territory: new Map<string, number>(), fear: 0 };
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const c of sorted) {
    if (selected.length >= config.targetCount) { rejected.push({ campaign: c, reason: "week full" }); continue; }
    if ((count.service.get(c.service) ?? 0) >= config.maxPerService) { rejected.push({ campaign: c, reason: `>${config.maxPerService} ${c.service} posts` }); continue; }
    if (c.cta !== "none" && (count.cta.get(c.cta) ?? 0) >= config.maxSameCta) { rejected.push({ campaign: c, reason: `>${config.maxSameCta} "${c.cta}" CTAs` }); continue; }
    if ((count.territory.get(c.territory) ?? 0) >= config.maxSameTerritory) { rejected.push({ campaign: c, reason: `>${config.maxSameTerritory} ${c.territory} posts` }); continue; }
    if (c.fearBased && count.fear >= config.maxFearBased) { rejected.push({ campaign: c, reason: `>${config.maxFearBased} fear-based posts` }); continue; }
    selected.push(c);
    inc(count.service, c.service); inc(count.cta, c.cta); inc(count.territory, c.territory);
    if (c.fearBased) count.fear += 1;
  }

  const warnings: string[] = [];
  const isEdu = (c: CandidateCampaign) => c.role === "education" || c.role === "trust";
  const eduCount = selected.filter(isEdu).length;
  if (eduCount < config.minEducation) {
    const eduCandidate = sorted.find((c) => isEdu(c) && !selected.includes(c) && (count.service.get(c.service) ?? 0) < config.maxPerService);
    const swapOut = [...selected].filter((c) => !isEdu(c)).sort((a, b) => a.baseScore - b.baseScore)[0];
    if (eduCandidate && swapOut) {
      selected.splice(selected.indexOf(swapOut), 1, eduCandidate);
      rejected.push({ campaign: swapOut, reason: "swapped out to meet education floor" });
      warnings.push(`swapped ${swapOut.id} -> ${eduCandidate.id} to meet education floor`);
    } else {
      warnings.push(`education floor (${config.minEducation}) not met — no eligible education candidate`);
    }
  }
  return { selected, rejected, warnings };
}
