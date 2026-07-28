/**
 * Cron · Unmatched Tire Demand Signal
 *
 * Complementary signal to existing analyzeTireInventory(): instead of
 * looking at WHAT WE SOLD, this looks at estimates that never resolved.
 * Aggregates unmatched tire-related estimates from alg_estimates over
 * the last 90 days, extracts size heuristically from serviceDescription,
 * ranks by total unresolved value × frequency, and cross-references
 * Gateway live inventory.
 *
 * revenue-truth-correction (2026-07-28): this job previously reported
 * the pool as "$X in lost tire revenue because we didn't have them on
 * the shelf" and told the operator to stock the sizes. An unmatched
 * estimate does NOT prove inventory was unavailable, that the customer
 * declined because of stock, that they'd have bought if stocked, that
 * the whole estimate was tire revenue, or that the sale is lost rather
 * than unresolved. The DEMAND ranking is real and useful; the stockout
 * CAUSATION was invented. The alert now reports the signal and tells
 * the operator what to verify before ordering.
 *
 * Different from analyzeTireInventory in dataPipelines.ts:551:
 *   - That one reports WHAT WE SOLD + low-stock at Gateway for those
 *   - This one reports which sizes keep appearing in estimates that
 *     never became invoices — demand pressure with unknown outcomes
 *
 * Tier 4 (daily). Wave-181.112.
 */

import { sql } from "drizzle-orm";
import { sendTelegram } from "../../services/telegram";
import { createLogger } from "../../lib/logger";

const log = createLogger("cron:inventory-demand-forecast");

interface ProcessResult {
  recordsProcessed: number;
  details: string;
}

// Regex to extract a tire size like 225/65R17 or 225/65/17 from any text.
// Conservative: tens of thousands of tire-size variants exist; we capture
// the common ones (3 numbers, R-letter optional). Misses oddball formats
// (LT, AT, ZR) but those are <5% of demand and operator can manually
// review the long tail.
const SIZE_RE = /\b(\d{3})[\s\/\-]+(\d{2,3})[\s\/\-]*(R|ZR|XL)?[\s\/\-]*(\d{2})\b/i;

function extractSize(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(SIZE_RE);
  if (!m) return null;
  // Canonical format: 225/65R17 (slash + R + 2-digit rim)
  return `${m[1]}/${m[2]}R${m[4]}`;
}

const LOOKBACK_DAYS = 90;
const MIN_OCCURRENCES = 2; // ignore one-off mentions
const TOP_N = 10;

export async function processInventoryDemandForecast(): Promise<ProcessResult> {
  const start = Date.now();
  log.info("[inventory-demand-forecast] start");

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  // 1. Pull declined tire-related estimates last 90d
  type DeclinedRow = { id: number; serviceDescription: string | null; estimatedAmount: number; estimateDate: Date };
  let declinedRows: DeclinedRow[];
  try {
    const r = await d.execute(sql`
      SELECT id, service_description AS serviceDescription, estimated_amount AS estimatedAmount, estimate_date AS estimateDate
      FROM alg_estimates
      WHERE matched_invoice_id IS NULL
        AND estimate_date >= DATE_SUB(NOW(), INTERVAL ${LOOKBACK_DAYS} DAY)
        AND service_description IS NOT NULL
        AND LOWER(service_description) LIKE '%tire%'
    `);
    // mysql2 returns [rows, fields] · normalize
    declinedRows = (Array.isArray(r) && Array.isArray(r[0]) ? r[0] : r) as DeclinedRow[];
  } catch (e) {
    log.error("[inventory-demand-forecast] DB pull failed", { error: e instanceof Error ? e.message : String(e) });
    return { recordsProcessed: 0, details: "DB pull failed" };
  }

  if (!declinedRows || declinedRows.length === 0) {
    log.info("[inventory-demand-forecast] no declined tire estimates in window");
    return { recordsProcessed: 0, details: "No declined tire data in 90d window" };
  }

  // 2. Aggregate by extracted size
  type DemandRow = { size: string; count: number; unresolvedValueCents: number; sampleDescriptions: string[] };
  const bySize = new Map<string, DemandRow>();

  for (const row of declinedRows) {
    const size = extractSize(row.serviceDescription);
    if (!size) continue;
    const existing = bySize.get(size) ?? { size, count: 0, unresolvedValueCents: 0, sampleDescriptions: [] };
    existing.count++;
    existing.unresolvedValueCents += row.estimatedAmount;
    if (existing.sampleDescriptions.length < 2 && row.serviceDescription) {
      existing.sampleDescriptions.push(row.serviceDescription.slice(0, 60));
    }
    bySize.set(size, existing);
  }

  // 3. Rank · filter low-occurrence noise · take top N
  const ranked = [...bySize.values()]
    .filter((d) => d.count >= MIN_OCCURRENCES)
    .sort((a, b) => b.unresolvedValueCents - a.unresolvedValueCents)
    .slice(0, TOP_N);

  const totalUnresolved = ranked.reduce((sum, r) => sum + r.unresolvedValueCents, 0);
  const totalDollars = Math.round(totalUnresolved / 100);

  if (ranked.length === 0) {
    log.info("[inventory-demand-forecast] no size-extractable demand patterns above threshold");
    return { recordsProcessed: declinedRows.length, details: `parsed ${declinedRows.length} rows · 0 sizes met ${MIN_OCCURRENCES}+ threshold` };
  }

  // 4. Cross-reference Gateway inventory for the top sizes
  type GatewayCheck = { size: string; available: boolean; brandsAvailable: number };
  const gatewayChecks: GatewayCheck[] = [];
  try {
    const { searchTiresBySize } = await import("../../services/gatewayClient");
    for (const r of ranked) {
      try {
        const tires = await searchTiresBySize(r.size);
        const brandsAvailable = Array.isArray(tires) ? tires.length : 0;
        gatewayChecks.push({ size: r.size, available: brandsAvailable > 0, brandsAvailable });
      } catch (e) {
        gatewayChecks.push({ size: r.size, available: false, brandsAvailable: 0 });
        log.warn(`[inventory-demand-forecast] Gateway check failed for ${r.size}`, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    log.warn("[inventory-demand-forecast] Gateway client unavailable · proceeding without availability cross-check", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Fall through with empty gateway data · alert still useful
    for (const r of ranked) gatewayChecks.push({ size: r.size, available: false, brandsAvailable: 0 });
  }

  // 5. Compose Telegram alert (HTML-safe · operator voice per agent #3 report)
  const lines: string[] = [];
  lines.push(`📊 UNMATCHED TIRE DEMAND SIGNAL · $${totalDollars.toLocaleString()} in unresolved tire estimates (${LOOKBACK_DAYS}d)`);
  lines.push("");
  lines.push(`Top ${ranked.length} sizes by unresolved estimate value:`);
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const gw = gatewayChecks[i];
    const gwTag = gw && gw.available ? ` · ${gw.brandsAvailable} brands @ Gateway` : " · ⚠ NOT at Gateway";
    lines.push(`${i + 1}. ${r.size} · ${r.count} unresolved · $${Math.round(r.unresolvedValueCents / 100).toLocaleString()} quoted${gwTag}`);
  }
  lines.push("");
  lines.push("Signal only — unmatched ≠ stockout-caused loss. Before ordering: was the size actually out? what was quoted vs. competitors? did the customer say why they passed?");

  try {
    await sendTelegram(lines.join("\n"));
  } catch (e) {
    log.warn("[inventory-demand-forecast] telegram failed", { error: e instanceof Error ? e.message : String(e) });
  }

  const durMs = Date.now() - start;
  log.info(`[inventory-demand-forecast] done in ${durMs}ms · ranked=${ranked.length} totalUnresolved=$${totalDollars}`);

  return {
    recordsProcessed: ranked.length,
    details: `parsed ${declinedRows.length} unmatched rows · ${ranked.length} sizes ranked · $${totalDollars} unresolved · top: ${ranked[0]?.size ?? "none"} ($${Math.round((ranked[0]?.unresolvedValueCents ?? 0) / 100)})`,
  };
}
