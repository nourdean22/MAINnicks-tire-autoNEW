/**
 * Strategic Frameworks Registry · v10.0.235 · the heart of Nick's
 * business-genius reasoning stack.
 *
 * When Nour asks Nick about anything business / money / strategy /
 * marketing / pricing / competitive, a relevant subset of these
 * frameworks gets injected as a "STRATEGIC LENS" block in the
 * system prompt for that turn. Nick reasons through the framework,
 * surfaces the lens by name, and answers with depth instead of
 * surface-level hot-take.
 *
 * Adding a new framework:
 *   1. Drop a new file in `frameworks/` exporting a `StrategicFramework`.
 *   2. Import + register it in REGISTRY below.
 *   3. (Optional) add a test case in tests/ai/strategic-frameworks.test.ts.
 *
 * Future additions planned · Lean Canvas, OKRs, RICE, ICE, Blue Ocean,
 * North-Star metric, AARRR, Crossing the Chasm, Flywheel, Wardley
 * Mapping, ICP definition, ToC (Theory of Constraints), Cohort
 * analysis, Funnel math, Unit economics, Marketplace dynamics.
 *
 * Each framework is a LENS, not a procedure. The detector picks the
 * BEST matches (max 3 by default) so the injected block stays compact.
 */

import type { FrameworkMatch, StrategicFramework } from "./types";

// ── Registry · order doesn't matter, all are scored equally ─────
// v10.0.235 baseline (9 lenses):
import { osterwalderCanvas } from "./frameworks/osterwalder-canvas";
import { jobsToBeDone } from "./frameworks/jtbd";
import { launchStrategy } from "./frameworks/launch-strategy";
import { monetization } from "./frameworks/monetization";
import { pricingStrategy } from "./frameworks/pricing-strategy";
import { growthEngine } from "./frameworks/growth-engine";
import { awarenessStages } from "./frameworks/awareness-stages";
import { competitiveLandscape } from "./frameworks/competitive-landscape";
import { kotlerMacro } from "./frameworks/kotler-macro";
// v10.0.236 expansion (+14 lenses · finance · operator · meta):
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
// v10.0.238 expansion (+6 classic strategy lenses):
import { portersFiveForces } from "./frameworks/porters-five-forces";
import { sevenPowers } from "./frameworks/seven-powers";
import { theoryOfConstraints } from "./frameworks/theory-of-constraints";
import { unitEconomics } from "./frameworks/unit-economics";
import { northStarMetric } from "./frameworks/north-star-metric";
import { crossingTheChasm } from "./frameworks/crossing-the-chasm";
// v10.0.239 expansion (+6 lean / mental-model lenses):
import { aarrrMetrics } from "./frameworks/aarrr-metrics";
import { leanCanvas } from "./frameworks/lean-canvas";
import { inversion } from "./frameworks/inversion";
import { fiveWhys } from "./frameworks/five-whys";
import { innovatorsDilemma } from "./frameworks/innovators-dilemma";
import { blueOcean } from "./frameworks/blue-ocean";
// v10.0.240 expansion (+6 situational / focus / customer lenses):
import { wardleyMapping } from "./frameworks/wardley-mapping";
import { okrs } from "./frameworks/okrs";
import { paretoPrinciple } from "./frameworks/pareto-principle";
import { cohortAnalysis } from "./frameworks/cohort-analysis";
import { marketplaceDynamics } from "./frameworks/marketplace-dynamics";
import { idealCustomerProfile } from "./frameworks/ideal-customer-profile";
// v10.0.241 expansion (+2 capital / pricing-power lenses):
import { pricingPower } from "./frameworks/pricing-power";
import { capitalAllocation } from "./frameworks/capital-allocation";
// v10.0.243 expansion (+2 negotiation + cognitive-bias lenses):
import { negotiation } from "./frameworks/negotiation";
import { survivorshipBias } from "./frameworks/survivorship-bias";
// v10.0.245 expansion (+2 mental-model lenses):
import { hanlonsRazor } from "./frameworks/hanlons-razor";
import { secondOrderThinking } from "./frameworks/second-order-thinking";
// v10.0.246 expansion (+2 distribution + tradeoff lenses):
import { powerLaw } from "./frameworks/power-law";
import { opportunityCost } from "./frameworks/opportunity-cost";
// v10.0.247 expansion (+2 behavioral + tempo lenses):
import { lossAversion } from "./frameworks/loss-aversion";
import { oodaLoop } from "./frameworks/ooda-loop";

export const REGISTRY: StrategicFramework[] = [
  // Core 9 (v10.0.235)
  osterwalderCanvas,
  jobsToBeDone,
  launchStrategy,
  monetization,
  pricingStrategy,
  growthEngine,
  awarenessStages,
  competitiveLandscape,
  kotlerMacro,
  // Operator + finance lenses (v10.0.236)
  warrenBuffett,
  steveJobs,
  elonMusk,
  startupMetrics,
  startupAnalyst,
  financialModeling,
  financialProjections,
  marketOpportunity,
  teamComposition,
  sequencePsychologist,
  supplyChainRisk,
  taskIntelligence,
  // Meta-lenses · pair with another framework
  trustCalibrator,
  verificationBeforeCompletion,
  systematicDebugging,
  // Classic strategy lenses (v10.0.238)
  portersFiveForces,
  sevenPowers,
  theoryOfConstraints,
  unitEconomics,
  northStarMetric,
  crossingTheChasm,
  // Lean / mental-model lenses (v10.0.239)
  aarrrMetrics,
  leanCanvas,
  inversion,
  fiveWhys,
  innovatorsDilemma,
  blueOcean,
  // Situational + focus + customer lenses (v10.0.240)
  wardleyMapping,
  okrs,
  paretoPrinciple,
  cohortAnalysis,
  marketplaceDynamics,
  idealCustomerProfile,
  // Capital + pricing-power lenses (v10.0.241)
  pricingPower,
  capitalAllocation,
  // Negotiation + cognitive-bias lenses (v10.0.243)
  negotiation,
  survivorshipBias,
  // Mental-model lenses (v10.0.245)
  hanlonsRazor,
  secondOrderThinking,
  // Distribution + tradeoff lenses (v10.0.246)
  powerLaw,
  opportunityCost,
  // Behavioral + tempo lenses (v10.0.247)
  lossAversion,
  oodaLoop,
];

export type { StrategicFramework, FrameworkMatch } from "./types";

/**
 * Quick check · should we even bother running framework detection?
 * Returns true if ANY framework (or its top-level keyword set) hits.
 *
 * v10.0.235 design note · the original implementation used a separate
 * BUSINESS_TOPLEVEL keyword list as a pre-filter. That double-gate
 * was redundant + brittle (kept missing plurals + new keywords). The
 * cost of running all framework triggers up front is ~9 regex tests
 * total (cheap) and the trigger lists self-document what counts as
 * business intent. The pre-filter is now derived implicitly from the
 * union of all framework triggers.
 */
export function hasBusinessIntent(text: string): boolean {
  if (!text || text.length < 8) return false;
  // Fast-path · scan all framework triggers · same loop as
  // pickFrameworks but stops at first match for speed.
  for (const f of REGISTRY) {
    if (f.antiTriggers?.some((re) => re.test(text))) continue;
    if (f.triggers.some((re) => re.test(text))) return true;
  }
  // Broader money/business keywords that don't tie to a specific
  // framework but should still trigger the strategic-lens block.
  const BROAD = [
    /\b(business|revenue|profit|margin|sales|monetiz|growth|gtm|saas|conversion)\b/i,
    /\b(customers?|clients?|prospects?|leads?|competitors?)\b/i,
    /\b(money|cash\s*flow|p\s*&\s*l|p\s+and\s+l|burn(\s+rate)?|runway|capital)\b/i,
    /\b(scale|scaling|expand(ing)?|hire|fire|team|partnership|acquisition|merger|exit)\b/i,
    /\b(ltv|cac|arpu|mrr|arr|nps|churn)\b/i,
  ];
  return BROAD.some((re) => re.test(text));
}

/**
 * Score a single framework against the user message · returns null
 * when no positive trigger hit OR an anti-trigger fired.
 */
function scoreFramework(
  framework: StrategicFramework,
  text: string,
): FrameworkMatch | null {
  // Anti-triggers · short-circuit if they hit
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
 * Pick the top-N strategic frameworks for this user message.
 * Returns empty array when no business intent OR no framework matches.
 *
 * Default `topN: 3` keeps the injected prompt block compact · adding
 * more lenses past 3 gives diminishing returns and bloats the prompt.
 */
export function pickFrameworks(
  text: string,
  topN = 3,
): FrameworkMatch[] {
  if (!hasBusinessIntent(text)) return [];
  const matches: FrameworkMatch[] = [];
  for (const f of REGISTRY) {
    const m = scoreFramework(f, text);
    if (m) matches.push(m);
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, topN);
}

/**
 * Compose the system-prompt block to inject for this turn. Returns
 * an empty string when no framework triggers · caller can append the
 * result without an additional null check.
 *
 * The block is structured so Nick can pattern-match on it:
 *   ## STRATEGIC LENS
 *   When reasoning about this question, apply ONE of these lenses.
 *   Name the lens you used.
 *
 *   ### {Framework Name}
 *   {one-liner}
 *
 *   {lens reasoning}
 *
 *   ### {Next Framework}
 *   ...
 */
export function composeStrategicLensBlock(text: string, topN = 3): string {
  // Fast no-op when there's no business signal at all
  if (!hasBusinessIntent(text)) return "";

  const matches = pickFrameworks(text, topN);

  // Specific frameworks matched · render the targeted block
  if (matches.length > 0) {
    const sections = matches
      .map((m) => {
        const f = m.framework;
        return `### ${f.name}\n${f.oneLiner}\n\n${f.lens}`;
      })
      .join("\n\n");

    return `## STRATEGIC LENS

When reasoning about this question, apply ONE of these strategic lenses
that fits best. Name the lens you used at the top of your answer so
Nour can see how you're thinking. If multiple apply, pick the one
that most changes the next decision · don't list all of them.

${sections}

After picking the lens, reason through it explicitly. Surface the
2-3 specific levers / tradeoffs / risks that change the answer.
Nour wants depth from a real framework, not a hot-take that sounds
strategic.`;
  }

  // v10.0.235 · generic fallback · business intent hit but no
  // specific framework triggered. Still nudge Nick toward
  // structured thinking · list the registry headlines so the model
  // can pick a relevant one based on its own read of the question.
  //
  // 2026-05-23 · Wave E · filter to FEATURED lenses only.
  // Pre-fix this dumped ALL 49 headlines · ~700-1000 tokens per
  // generic-fallback fire · ~80 tokens of which the model actually
  // used. Featured-only keeps the fallback compact (~150 tokens)
  // while preserving the choice set for Nick. Fallback to ALL
  // when zero lenses are marked featured (safety net).
  const featuredLenses = REGISTRY.filter((f) => f.featured);
  const lensesToList = featuredLenses.length > 0 ? featuredLenses : REGISTRY;
  const headlines = lensesToList
    .map((f) => `· **${f.name}** — ${f.oneLiner}`)
    .join("\n");

  return `## STRATEGIC LENS

This is a business / money / strategy question · apply structured
thinking, not a surface-level take. Name the lens you used at the
top of your answer so Nour can see how you're reasoning.

Available lenses:
${headlines}

Pick the ONE lens that most changes the decision · reason through
it explicitly · surface the 2-3 levers / tradeoffs / risks that
matter. Nour wants framework-grade depth, not a hot-take that
sounds strategic.`;
}
