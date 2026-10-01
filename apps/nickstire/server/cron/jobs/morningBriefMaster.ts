/**
 * Q-23 phase 8 · the morning brief's Master Intelligence block.
 *
 * The admin Intelligence HQ already wears provenance on these numbers (phases
 * 1-7). The morning brief printed the same report to Telegram with none of it:
 *
 *   - "BUSINESS HEALTH: 50/100" on a run where most engines failed. The score is
 *     a model, never a measurement, and with >= 1/3 of its engines failed the
 *     report itself sets `scoreReliable: false` (it averaged over silence).
 *   - "Churn risk: 0" when the churn engine's read failed. `settled()` maps a
 *     failed or `unavailable` engine to null, and null became 0.
 *   - "Reviews/wk: 0" on EVERY run. It read `weeklyRate` / `monthlyRate`, which
 *     analyzeReviewVelocity has never returned (masterIntelligence.ts documents
 *     the same dead field in its own review block). It now prints the monthly
 *     count the engine actually measures.
 *
 * Pure so it can be tested without the cron's DB and LLM.
 */

type EngineResult = Record<string, unknown> | null | undefined;

export interface MasterBriefInput {
  summary: {
    score: number;
    scoreReliable?: boolean;
    enginesFailed?: number;
    enginesTotal?: number;
    topAlert: string;
    topOpportunity: string;
    topRisk: string;
  };
  customers: { churnRisk: EngineResult };
  marketing: { reviewVelocity: EngineResult };
}

/** predictChurn returns at most this many high-risk customers. */
const CHURN_HIGH_RISK_CAP = 25;

function formatChurnCount(churnRisk: EngineResult): string {
  const list = churnRisk?.highRisk;
  if (!Array.isArray(list)) return "unknown, not zero (the churn read failed)";
  return list.length >= CHURN_HIGH_RISK_CAP
    ? `${list.length}+`
    : String(list.length);
}

function formatMonthlyReviews(reviewVelocity: EngineResult): string {
  const n = reviewVelocity?.thisMonth;
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "unknown";
}

function formatHealthLine(summary: MasterBriefInput["summary"]): string {
  // An older cached report may lack the flag; treat absent as reliable, as the admin panel does.
  if (summary.scoreReliable === false) {
    const failed = summary.enginesFailed ?? "?";
    const total = summary.enginesTotal ?? "?";
    return `BUSINESS HEALTH: UNKNOWN (${failed} of ${total} engines failed; not an average, do not quote a score)`;
  }
  return `BUSINESS HEALTH (ESTIMATE, modeled not measured): ${Math.round(summary.score)}/100`;
}

export function formatMasterBriefBlock(
  master: MasterBriefInput,
  newCustomersThisMonth: number | string
): string {
  const s = master.summary;
  let block = `\n${formatHealthLine(s)}`;
  block += `\n🔔 Alert: ${s.topAlert}`;
  block += `\n💡 Opportunity: ${s.topOpportunity}`;
  block += `\n⚠️ Risk: ${s.topRisk}`;
  block += `\nKEY: Churn risk: ${formatChurnCount(master.customers.churnRisk)}`;
  block += ` | New customers: ${newCustomersThisMonth}`;
  block += ` | Reviews this month: ${formatMonthlyReviews(master.marketing.reviewVelocity)}`;
  return block;
}
