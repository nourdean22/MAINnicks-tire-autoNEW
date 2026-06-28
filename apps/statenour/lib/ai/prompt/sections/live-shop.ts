/**
 * lib/ai/prompt/sections/live-shop.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for the v1 "LIVE METRICS" + "LIVE SHOP STATUS"
 * blocks (system-prompt.ts:1287-1335 pre-split). Renders:
 *
 *   · "LIVE METRICS (real-time)" line with customer/lead/job counts
 *     plus latest financial + empire-score lines when available.
 *   · "LIVE SHOP STATUS" line from the live nickstire query API
 *     (today revenue + invoice count + attention-needed alerts +
 *     urgent leads).
 *
 * Caller pre-fetches all the data; this is pure string assembly.
 */

interface LiveMetricsInput {
  customerCount?: number;
  openLeadCount?: number;
  activeJobCount?: number;
  latestFinancial: {
    date: string;
    businessRevenue: number | null;
    ownerTakeHome: number | null;
    totalDebt: number | null;
    netWorthEstimate: number | null;
  } | null;
  latestEmpire: {
    moneyScore: number;
    moneyDetail: unknown;
  } | null;
}

export function renderLiveMetrics(input: LiveMetricsInput): string[] {
  const { customerCount, openLeadCount, activeJobCount, latestFinancial, latestEmpire } = input;
  const p: string[] = [];

  p.push(`### LIVE METRICS (real-time)`);
  if (customerCount !== undefined || openLeadCount !== undefined || activeJobCount !== undefined) {
    p.push(`Customers in DB: ${customerCount ?? "?"} | Open leads: ${openLeadCount ?? "?"} | Active jobs: ${activeJobCount ?? "?"}`);
  }
  if (latestFinancial) {
    p.push(`Latest financial (${latestFinancial.date}): Revenue $${latestFinancial.businessRevenue || "?"} | Take-home $${latestFinancial.ownerTakeHome || "?"} | Debt $${latestFinancial.totalDebt || "?"} | Net worth $${latestFinancial.netWorthEstimate || "?"}`);
  }
  if (latestEmpire) {
    const md = latestEmpire.moneyDetail as Record<string, unknown> | null;
    p.push(`Empire score (money): ${latestEmpire.moneyScore}/10${md ? ` — ${JSON.stringify(md).slice(0, 200)}` : ""}`);
  }
  p.push(``);

  return p;
}

/**
 * Renders the LIVE SHOP STATUS line. Caller passes the result of
 * `queryNickBatch([revenue_today, attention_needed, leads_urgent])`
 * already destructured into the simple shape this expects. If the
 * caller's primary fetch fails, it falls back to an AuditEvent
 * `business_metrics_sync` payload — caller resolves the fallback
 * and passes the result via `fallbackPulse`.
 *
 * Both `liveSnapshot` and `fallbackPulse` are optional; emit nothing
 * if both are null.
 */
export function renderLiveShopStatus(input: {
  liveSnapshot: {
    revenueDollars: number | null;
    invoiceCount: number | null;
    attentionMessages: string[];
    urgentLeadsCount: number;
  } | null;
  fallbackPulse: {
    asOf: string;
    todayEstimate: number | null;
    weekRevenue: number | null;
  } | null;
}): string[] {
  const { liveSnapshot, fallbackPulse } = input;
  const p: string[] = [];

  if (liveSnapshot) {
    p.push(`LIVE SHOP STATUS (real-time from nickstire.org):`);
    if (liveSnapshot.revenueDollars != null || liveSnapshot.invoiceCount != null) {
      p.push(`Today: $${liveSnapshot.revenueDollars || 0} revenue, ${liveSnapshot.invoiceCount || 0} jobs`);
    }
    if (liveSnapshot.attentionMessages.length > 0) {
      p.push(`⚠️ ATTENTION: ${liveSnapshot.attentionMessages.join(" | ")}`);
    }
    if (liveSnapshot.urgentLeadsCount > 0) {
      p.push(`🔴 ${liveSnapshot.urgentLeadsCount} URGENT leads need contact NOW`);
    }
  } else if (fallbackPulse) {
    p.push(`SHOP PULSE (cached ${fallbackPulse.asOf}):`);
    p.push(`Today: $${fallbackPulse.todayEstimate || 0}, Week: $${fallbackPulse.weekRevenue || 0}`);
  }

  p.push(``);
  return p;
}
