/**
 * @statenour/lenses · v0.1.0
 *
 * 49 strategic reasoning lenses for AI agents · typed registry +
 * trigger-based detector + ready-to-inject prompt block composer.
 *
 * Extracted from the statenour-os operator OS (autonicks.com) where
 * the lenses are honed against ~14 months of live operator chat data.
 * The registry, types, and detector live here; the consuming
 * application owns the prompt assembly + how lenses are presented
 * to the user.
 *
 * Public API:
 *   · REGISTRY: StrategicFramework[]   · the 49 lenses
 *   · detectLenses(message, opts?)     · top-N matches by trigger score
 *   · formatLensBlock(matches)         · system-prompt section composer
 *   · hasStrategicIntent(message)      · cheap pre-filter
 *   · pickFeaturedLenses()             · the curated baseline subset
 *
 * Types re-exported · see types.ts:
 *   · StrategicFramework · FrameworkMatch
 */

import type { FrameworkMatch, StrategicFramework } from "./types";

// ── Imports · all 49 lenses ──────────────────────────────────
import { osterwalderCanvas } from "./frameworks/osterwalder-canvas";
import { jobsToBeDone } from "./frameworks/jtbd";
import { launchStrategy } from "./frameworks/launch-strategy";
import { monetization } from "./frameworks/monetization";
import { pricingStrategy } from "./frameworks/pricing-strategy";
import { growthEngine } from "./frameworks/growth-engine";
import { awarenessStages } from "./frameworks/awareness-stages";
import { competitiveLandscape } from "./frameworks/competitive-landscape";
import { kotlerMacro } from "./frameworks/kotler-macro";
import { warrenBuffett } from "./frameworks/warren-buffett";
import { steveJobs } from "./frameworks/steve-jobs";
import { elonMusk } from "./frameworks/elon-musk";
import { startupMetrics } from "./frameworks/startup-metrics";
import { startupAnalyst } from "./frameworks/startup-analyst";
import { financialModeling } from "./frameworks/financial-modeling";
import { financialProjections } from "./frameworks/financial-projections";
import { marketOpportunity } from "./frameworks/market-opportunity";
import { teamComposition } from "./frameworks/team-composition";
import { sequencePsychologist } from "./frameworks/sequence-psychologist";
import { supplyChainRisk } from "./frameworks/supply-chain-risk";
import { taskIntelligence } from "./frameworks/task-intelligence";
import { trustCalibrator } from "./frameworks/trust-calibrator";
import { verificationBeforeCompletion } from "./frameworks/verification-before-completion";
import { systematicDebugging } from "./frameworks/systematic-debugging";
import { portersFiveForces } from "./frameworks/porters-five-forces";
import { sevenPowers } from "./frameworks/seven-powers";
import { theoryOfConstraints } from "./frameworks/theory-of-constraints";
import { unitEconomics } from "./frameworks/unit-economics";
import { northStarMetric } from "./frameworks/north-star-metric";
import { crossingTheChasm } from "./frameworks/crossing-the-chasm";
import { aarrrMetrics } from "./frameworks/aarrr-metrics";
import { leanCanvas } from "./frameworks/lean-canvas";
import { inversion } from "./frameworks/inversion";
import { fiveWhys } from "./frameworks/five-whys";
import { innovatorsDilemma } from "./frameworks/innovators-dilemma";
import { blueOcean } from "./frameworks/blue-ocean";
import { wardleyMapping } from "./frameworks/wardley-mapping";
import { okrs } from "./frameworks/okrs";
import { paretoPrinciple } from "./frameworks/pareto-principle";
import { cohortAnalysis } from "./frameworks/cohort-analysis";
import { marketplaceDynamics } from "./frameworks/marketplace-dynamics";
import { idealCustomerProfile } from "./frameworks/ideal-customer-profile";
import { pricingPower } from "./frameworks/pricing-power";
import { capitalAllocation } from "./frameworks/capital-allocation";
import { negotiation } from "./frameworks/negotiation";
import { survivorshipBias } from "./frameworks/survivorship-bias";
import { hanlonsRazor } from "./frameworks/hanlons-razor";
import { secondOrderThinking } from "./frameworks/second-order-thinking";
import { powerLaw } from "./frameworks/power-law";
import { opportunityCost } from "./frameworks/opportunity-cost";
import { lossAversion } from "./frameworks/loss-aversion";
import { oodaLoop } from "./frameworks/ooda-loop";
// 2026-07-27 · Greene, Mastery Book V — the creative-active strategies.
// The registry's existing 51 lenses are business-ANALYSIS lenses (how to
// evaluate a market, a price, a decision). These are creative-PROCESS
// lenses (how to make original work), which is a genuinely absent axis.
//
// Eight of Greene's nine, not all nine: "The Open Field" is the same
// argument as `blue-ocean` (uncontested space, refuse the incumbents'
// scoreboard), and a near-duplicate lens would split trigger matches and
// dilute both. Blue Ocean states it better with the ERRC grid — routing
// open-field questions there is the correct behavior, not a gap.
//
// All eight are non-featured on purpose: featured lenses are listed in
// the generic business/strategy fallback, which previously dumped every
// headline and cost ~700-1000 tokens on casual mentions. These fire only
// on their own triggers, so they add nothing to the common path.
import { authenticVoice } from "./frameworks/authentic-voice";
import { factOfGreatYield } from "./frameworks/fact-of-great-yield";
import { mechanicalIntelligence } from "./frameworks/mechanical-intelligence";
import { naturalPowers } from "./frameworks/natural-powers";
import { theHighEnd } from "./frameworks/the-high-end";
import { evolutionaryHijack } from "./frameworks/evolutionary-hijack";
import { dimensionalThinking } from "./frameworks/dimensional-thinking";
import { alchemicalCreativity } from "./frameworks/alchemical-creativity";

/**
 * The 49-lens registry. Order doesn't matter · `detectLenses` scores
 * all candidates and returns top-N.
 */
export const REGISTRY: StrategicFramework[] = [
  osterwalderCanvas, jobsToBeDone, launchStrategy, monetization, pricingStrategy,
  growthEngine, awarenessStages, competitiveLandscape, kotlerMacro,
  warrenBuffett, steveJobs, elonMusk, startupMetrics, startupAnalyst,
  financialModeling, financialProjections, marketOpportunity, teamComposition,
  sequencePsychologist, supplyChainRisk, taskIntelligence,
  trustCalibrator, verificationBeforeCompletion, systematicDebugging,
  portersFiveForces, sevenPowers, theoryOfConstraints, unitEconomics,
  northStarMetric, crossingTheChasm,
  aarrrMetrics, leanCanvas, inversion, fiveWhys, innovatorsDilemma, blueOcean,
  wardleyMapping, okrs, paretoPrinciple, cohortAnalysis, marketplaceDynamics,
  idealCustomerProfile,
  pricingPower, capitalAllocation,
  negotiation, survivorshipBias,
  hanlonsRazor, secondOrderThinking,
  powerLaw, opportunityCost,
  lossAversion, oodaLoop,
  // Greene · Mastery Book V · creative-active strategies
  authenticVoice, factOfGreatYield, mechanicalIntelligence, naturalPowers,
  theHighEnd, evolutionaryHijack, dimensionalThinking, alchemicalCreativity,
];

export type { StrategicFramework, FrameworkMatch } from "./types";

/**
 * Cheap pre-filter · returns true if the input text shows strategic
 * intent (worth running the registry detector against). Fast-path
 * for hot loops · ~9 regex tests across the union of all trigger
 * patterns plus 5 broad business keywords.
 */
export function hasStrategicIntent(text: string): boolean {
  if (!text || text.length < 8) return false;
  for (const f of REGISTRY) {
    if (f.antiTriggers?.some((re) => re.test(text))) continue;
    if (f.triggers.some((re) => re.test(text))) return true;
  }
  const BROAD = [
    /\b(business|revenue|profit|margin|sales|monetiz|growth|gtm|saas|conversion)\b/i,
    /\b(customers?|clients?|prospects?|leads?|competitors?)\b/i,
    /\b(money|cash\s*flow|p\s*&\s*l|p\s+and\s+l|burn(\s+rate)?|runway|capital)\b/i,
    /\b(scale|scaling|expand(ing)?|hire|fire|team|partnership|acquisition|merger|exit)\b/i,
    /\b(ltv|cac|arpu|mrr|arr|nps|churn)\b/i,
  ];
  return BROAD.some((re) => re.test(text));
}

function scoreFramework(
  framework: StrategicFramework,
  text: string,
): FrameworkMatch | null {
  if (framework.antiTriggers?.some((re) => re.test(text))) return null;
  const matched: string[] = [];
  for (const trigger of framework.triggers) {
    const m = text.match(trigger);
    if (m) matched.push(m[0]);
  }
  if (matched.length === 0) return null;
  const score = matched.length * (framework.weight ?? 1.0);
  return { framework, score, matched };
}

/**
 * Run the registry's trigger regexes against the user message. Returns
 * the top-N matches by score (positive triggers × weight), with
 * anti-trigger suppression. Default topN=3 keeps prompt bloat
 * controlled · adding more lenses past 3 gives diminishing returns.
 */
export function detectLenses(
  text: string,
  opts?: { topN?: number },
): FrameworkMatch[] {
  if (!hasStrategicIntent(text)) return [];
  const topN = opts?.topN ?? 3;
  const matches: FrameworkMatch[] = [];
  for (const f of REGISTRY) {
    const m = scoreFramework(f, text);
    if (m) matches.push(m);
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topN);
}

/**
 * The curated baseline subset · ~9 lenses marked `featured: true` in
 * the registry. Useful for compact fallback lists when no specific
 * trigger fires but you still want to nudge the model toward
 * structured thinking.
 */
export function pickFeaturedLenses(): StrategicFramework[] {
  return REGISTRY.filter((f) => f.featured);
}

/**
 * Compose a system-prompt section from a list of matches. Returns
 * an empty string when matches.length === 0 · safe to append without
 * a null check.
 *
 * Format:
 *   ## STRATEGIC LENS
 *   When reasoning about this question, apply ONE of these strategic
 *   lenses ...
 *
 *   ### {Framework Name}
 *   {oneLiner}
 *
 *   {lens reasoning}
 *
 *   ### {Next Framework} ...
 */
export function formatLensBlock(matches: FrameworkMatch[]): string {
  if (matches.length === 0) return "";
  const sections = matches
    .map((m) => {
      const f = m.framework;
      return `### ${f.name}\n${f.oneLiner}\n\n${f.lens}`;
    })
    .join("\n\n");
  return `## STRATEGIC LENS

When reasoning about this question, apply ONE of these strategic lenses
that fits best. Name the lens at the top of your answer so the reader
can see how you're thinking. If multiple apply, pick the one that most
changes the next decision · don't list all of them.

${sections}

After picking the lens, reason through it explicitly. Surface the
2-3 specific levers / tradeoffs / risks that change the answer.`;
}
