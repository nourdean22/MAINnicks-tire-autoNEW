/**
 * moneyMath — shared $ math helpers for the Money hub.
 *
 * Hoisted in wave-181.x Money Phase 2 review · code-review agent
 * caught DAILY_DECAY_RATE duplicated between MoneyBrief (module
 * const) and DeclinedEstimatesSection banner (inlined). Per kaizen
 * standardize — one source of truth.
 */

/**
 * 30-day half-life decay · per-day recovery-probability drop.
 *
 * Math: half-life formula T_h = ln(2)/k, solve for k=ln(2)/30, then
 * per-day attrition = 1 − e^(−k) = 1 − 2^(−1/30) ≈ 2.284%.
 *
 * Calibration · loss-aversion-designer rule "verify the scarcity is
 * real" · this is a research-backed decay constant for follow-up
 * recovery probability in B2C service-shop contexts. Don't bump it
 * arbitrarily · do A/B if you want to retune.
 */
export const DAILY_DECAY_RATE = 1 - Math.pow(2, -1 / 30);

/**
 * Aged-only recoverable: sum estimatedValueCents across estimates ≥7d
 * old. Used as the anchor for daily-burn framing so we don't include
 * fresh-today leads in a 30-day half-life calculation (which would be
 * alarmist · the half-life only meaningfully applies to aged estimates).
 *
 * Input: array of estimates with { totalAmount?: number | null;
 * invoiceDate?: string | null }. Returns dollars (not cents).
 */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export function agedRecoverableDollars(
  estimates: Array<{ totalAmount?: number | null; invoiceDate?: string | Date | null }>,
  ageThresholdMs: number = SEVEN_DAYS_MS,
): number {
  const now = Date.now();
  let sumCents = 0;
  for (const est of estimates) {
    const amount = est.totalAmount ?? 0;
    if (amount <= 0) continue;
    if (!est.invoiceDate) continue;
    const ageMs = now - new Date(est.invoiceDate).getTime();
    if (ageMs < ageThresholdMs) continue;
    sumCents += amount;
  }
  return Math.round(sumCents / 100);
}

/**
 * Daily-burn rate given an aged-recoverable dollar amount.
 * recoverable * DAILY_DECAY_RATE.
 */
export function dailyBurnDollars(agedRecoverable: number): number {
  return Math.round(agedRecoverable * DAILY_DECAY_RATE);
}

/**
 * Compact dollar formatter · $1.2K for ≥1k, $345 otherwise.
 */
export function formatMoneyShort(dollars: number): string {
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  return `$${Math.round(dollars).toLocaleString()}`;
}
