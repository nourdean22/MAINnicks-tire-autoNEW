/**
 * buildGscPrefetch · chat-route extract
 *
 * Lifted VERBATIM from app/api/ai/chat/route.ts (the GSC pre-fetch +
 * inject block, original lines ~897-978).
 *
 * v10.0.511 · GSC pre-fetch + inject · the 2026-05-12 smoke tests
 * showed venice-uncensored consistently ignores the tool-call-first
 * directive on SEO queries even when getGscSummary is in the toolset
 * (post v10.0.510 pruner expansion). The model invents narratives
 * about "Google logging errors" instead of calling the tool.
 *
 * This pre-fetch bypasses the model's tool-call decision entirely:
 * when SEO/GSC regex matches the user content, we call queryNick
 * ourselves BEFORE streamText runs and inject the JSON result as a
 * system-prompt addendum. The model has the real numbers in its
 * context · fabrication becomes structurally impossible.
 *
 * If the call fails or returns no data, we inject a "NO DATA AVAILABLE"
 * block so the model says that instead of fabricating.
 *
 * Cost: 1 extra bridge call per matching turn (~200-500ms). Latency
 * hit is acceptable for the failure-mode it eliminates.
 *
 * Returns the ready-to-prepend block (ending in two newlines) for the
 * matching branch, or null when the regex doesn't match / on a caught
 * exception. The caller does `finalSystemPrompt = block + finalSystemPrompt`.
 */

import { queryNick } from "@/lib/nickstire/query";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/chat");

const SEO_QUERY_REGEX =
  /\b(seo|gsc|google search console|search console|impressions?|clicks|ctr|rankings?|search performance|organic|traffic|keywords?|nickstire\.org|autonicks\.com|search ranks?|website performance|aeo)\b/i;

/**
 * @returns the GSC system-prompt addendum to prepend (with its trailing
 * blank line), or null when the user content isn't an SEO/GSC query or
 * the bridge call threw.
 */
export async function buildGscPrefetch(userTextSlice: string): Promise<string | null> {
  if (SEO_QUERY_REGEX.test(userTextSlice)) {
    try {
      // Date range parsing: pull "yesterday" / "today" / "last 7 days"
      // from user content · default 30 days.
      const today = new Date().toISOString().slice(0, 10);
      const lower = userTextSlice.toLowerCase();
      let from = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
      let to = today;
      let windowLabel = "last 30 days";
      if (/\byesterday\b/.test(lower)) {
        from = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
        to = from;
        windowLabel = "yesterday";
      } else if (/\btoday\b/.test(lower)) {
        from = today;
        to = today;
        windowLabel = "today";
      } else if (/\blast\s*7\s*days?\b|\bthis\s*week\b/.test(lower)) {
        from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
        windowLabel = "last 7 days";
      }
      const gscStart = Date.now();
      const res = await queryNick<{ totalClicks?: number; totalImpressions?: number; avgCtr?: number; avgPosition?: number; daysCovered?: number } | { error: string }>(
        "gsc_summary",
        { from, to },
      );
      const gscMs = Date.now() - gscStart;
      log.info("gsc_prefetch", { windowLabel, from, to, ms: gscMs, ok: "data" in res });
      if ("data" in res && res.data) {
        const d = res.data as { totalClicks?: number; totalImpressions?: number; avgCtr?: number; avgPosition?: number; daysCovered?: number };
        const hasNumbers = (d.totalClicks ?? 0) > 0 || (d.totalImpressions ?? 0) > 0;
        if (hasNumbers) {
          log.info("gsc_data_injected", { windowLabel, hasNumbers });
          return `# 🚨 LIVE GSC DATA INJECTED · ${windowLabel} (${from} to ${to}) · YOU MUST CITE THESE NUMBERS 🚨\n\nThe operator just asked about SEO / search performance. The nickstire bridge was queried LIVE BEFORE you started typing this reply. The actual data is here:\n\n\`\`\`json\n${JSON.stringify(d, null, 2)}\n\`\`\`\n\n## HARD RULES (violations are failures):\n\n- **DO NOT START YOUR REPLY WITH** "I cannot" / "Sorry" / "Unfortunately" / "I'm unable" / "I don't have access" — THE DATA IS RIGHT ABOVE. Saying you don't have it is FALSE.\n- **DO NOT FABRICATE** "Google logging errors", "data discrepancies", "outages between 2025 and 2026", or any narrative explaining away the numbers. The numbers ARE the truth.\n- **OPEN YOUR REPLY** by stating the actual numbers. Example shape: "${windowLabel} on nickstire.org: ${d.totalClicks ?? 0} clicks, ${d.totalImpressions ?? 0} impressions${typeof d.avgCtr === "number" ? `, ${(d.avgCtr * 100).toFixed(2)}% CTR` : ""}${typeof d.avgPosition === "number" ? `, avg position ${d.avgPosition.toFixed(1)}` : ""}."
- If a number is ZERO, that means LITERALLY ZERO · acknowledge that directly: "no clicks captured for that window."
- If the operator asks for top queries, you can additionally call \`getGscTopQueries\` for the same date range.
- Voice: concrete · direct · no hedging. Nour wants the numbers, not a tour.

`;
        } else {
          log.info("gsc_no_data", { windowLabel });
          return `# 🚨 GSC DATA · ${windowLabel} (${from} to ${to}) · ZERO TRAFFIC CAPTURED 🚨\n\nThe nickstire bridge was queried LIVE for the requested window and returned zero clicks AND zero impressions. This is the actual state · not an unavailable bridge.\n\n## HARD RULES:\n\n- **DO NOT FABRICATE** "Google logging errors", "outages", or any narrative. The pipeline ran · the data is genuinely zero.\n- **DO NOT SAY** "I cannot provide information" / "Sorry, unable to" / "I don't have access" — you DO have the data. The data is "zero captured."
- **OPEN YOUR REPLY** with: "No GSC data captured for ${windowLabel}." Then explain the two likely reasons (pipeline runs nightly so today's data may not be populated yet, OR the period had genuinely no search traffic). Suggest a wider window (e.g. last 7 days) as the next move.
- Voice: direct · brief · helpful. Don't apologize · just report and offer next step.

`;
        }
      } else {
        const errText = "error" in res ? res.error : "unknown";
        log.warn("gsc_prefetch_failed", { errText, windowLabel });
        return `# 🚨 GSC BRIDGE FAILED · ${windowLabel} 🚨\n\nThe pre-fetch attempt errored: \`${errText}\`. The bridge is unavailable right now.\n\n## HARD RULES:\n\n- **DO NOT FABRICATE** numbers or "logging error" narratives.
- **OPEN YOUR REPLY** with: "GSC bridge isn't responding right now (${errText}). Try again in a few minutes."
- Voice: brief · operator wants to know it's a transient · not a deep apology.

`;
      }
    } catch (err) {
      log.warn("gsc_prefetch_exception", { err: sanitizeError(err) });
      // Non-fatal · fall through to existing path · model still has
      // getGscSummary available in toolset (v10.0.510 pruner expansion)
    }
  }
  return null;
}
