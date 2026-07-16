/**
 * Canonical GSC prefetch for SEO-related chat turns.
 *
 * Headline clicks, impressions, CTR, and position come from the official
 * no-dimension Search Console aggregate. Top queries/pages remain separately
 * labeled dimensional detail. A failed bridge injects an explicit unavailable
 * state so the model cannot fabricate numbers.
 */

import { queryCanonicalGscSummary } from "@/lib/nickstire/canonical-metrics";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/chat");

const SEO_QUERY_REGEX =
  /\b(seo|gsc|google search console|search console|impressions?|clicks|ctr|rankings?|search performance|organic|traffic|keywords?|nickstire\.org|autonicks\.com|search ranks?|website performance|aeo)\b/i;

export async function buildGscPrefetch(userTextSlice: string): Promise<string | null> {
  if (!SEO_QUERY_REGEX.test(userTextSlice)) return null;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const lower = userTextSlice.toLowerCase();
    let from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    let to = today;
    let windowLabel = "last 30 days";

    if (/\byesterday\b/.test(lower)) {
      from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      to = from;
      windowLabel = "yesterday";
    } else if (/\btoday\b/.test(lower)) {
      from = today;
      to = today;
      windowLabel = "today";
    } else if (/\blast\s*7\s*days?\b|\bthis\s*week\b/.test(lower)) {
      from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      windowLabel = "last 7 days";
    }

    const startedAt = Date.now();
    // timeoutMs 6s (bridge default is 15s) · this await sits on the
    // pre-stream critical path — the user sees zero bytes until it
    // resolves. A slow Search Console bridge degrades to the explicit
    // UNAVAILABLE block below (the bridge returns {error} on abort),
    // so the model still can't fabricate numbers.
    const result = await queryCanonicalGscSummary({ from, to, timeoutMs: 6_000 });
    log.info("gsc_prefetch", {
      windowLabel,
      from,
      to,
      ms: Date.now() - startedAt,
      ok: "data" in result,
      source: "data" in result ? result.data.source : "unavailable",
    });

    if (!("data" in result)) {
      return `# GSC DATA UNAVAILABLE · ${windowLabel}\n\nThe canonical Search Console aggregate request failed: \`${result.error}\`. Do not invent or substitute stored dimensional totals. State that official aggregate data is temporarily unavailable.\n\n`;
    }

    const d = result.data;
    const hasNumbers = d.totalClicks > 0 || d.totalImpressions > 0;
    const ctrPercent = d.avgCtr * 100;

    if (!hasNumbers) {
      return `# OFFICIAL GSC AGGREGATE · ${windowLabel} (${from} to ${to}) · ZERO CAPTURED\n\nSource: ${d.source}. Definition: ${d.metricDefinitionVersion}. The official no-dimension aggregate returned zero clicks and zero impressions. Do not replace these values with dimensional detail or invent an outage explanation.\n\n`;
    }

    return `# OFFICIAL GSC AGGREGATE INJECTED · ${windowLabel} (${from} to ${to})\n\nThe following headline metrics came directly from the no-dimension Search Console aggregate and are authoritative for this window:\n\n\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\`\n\nRules:\n- Open with ${d.totalClicks} clicks, ${d.totalImpressions} impressions, ${ctrPercent.toFixed(2)}% CTR, and average position ${d.avgPosition.toFixed(1)}.\n- Treat avgCtr as a ratio because ctrUnit is \"ratio\"; do not multiply it more than once.\n- Top queries and top pages are dimensional detail, not substitutes for headline totals.\n- Cite source ${d.source} and definition ${d.metricDefinitionVersion}.\n- Do not fabricate outages, discrepancies, or missing access.\n\n`;
  } catch (error) {
    log.warn("gsc_prefetch_exception", { err: sanitizeError(error) });
    return null;
  }
}
