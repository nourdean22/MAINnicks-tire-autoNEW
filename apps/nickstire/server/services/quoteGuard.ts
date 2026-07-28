/**
 * Quote Quality & Profit Guard (plan PR-7, truth-doctrine build).
 *
 * Evaluates a quote against quality checks where every check returns
 * pass | fail | unknown — and UNKNOWN IS THE POINT. The repo's own
 * finding stands: parts/labor cost is captured on too few rows to
 * support profit analysis, so this guard's primary early value is
 * making the missing capture LOUD ("profit unverifiable — parts cost
 * not captured"), never papering over it with an assumed margin.
 *
 * Hard rules:
 *   - NO fabricated numbers. A profit figure exists in the output ONLY
 *     when estimatedPartsCost was actually captured (>0).
 *   - NO price advice. The guard flags quality problems (below supplier
 *     cost, duplicate open quotes, absent cost capture); pricing stays
 *     an operator decision.
 *   - Checks that need data the shop doesn't capture yet (labor hours,
 *     calibration flags, disclosures) return `unknown` with the reason,
 *     so the checklist doubles as the capture roadmap.
 *
 * Computable TODAY:
 *   - amount sanity bounds
 *   - overlapping open estimates for the same phone (plan: "active
 *     overlapping estimate")
 *   - implied parts margin WHEN estimatedPartsCost > 0 (never assumed)
 *   - tire quotes vs LIVE Gateway supplier cost. Field-name trap is
 *     real and documented in gatewayClient.ts: `selling_price` is
 *     Nick's COST from D&K; `cost_price` is suggested retail (2x).
 */
import { createLogger } from "../lib/logger";

const log = createLogger("quote-guard");

export type GuardStatus = "pass" | "fail" | "unknown";

export interface GuardCheck {
  check: string;
  status: GuardStatus;
  detail: string;
}

export interface QuoteGuardReport {
  checks: GuardCheck[];
  summary: { pass: number; fail: number; unknown: number };
  /**
   * (quote − captured parts cost) ÷ quote. Present ONLY when parts cost
   * was actually captured. Strike-6 rename: this is NOT a parts margin
   * and NOT job gross profit — the remainder still contains labor, fees,
   * disposal, other operations and tax. The old name
   * `quoteRemainderAfterPartsCostPct` overclaimed.
   */
  quoteRemainderAfterPartsCostPct: number | null;
  /** Every input the checklist wanted and didn't get — the data-capture
   *  to-do list, stated explicitly instead of buried in unknowns. */
  missingInputs: string[];
}

/** Same conservative pattern as the demand-signal cron — twin kept small
 *  and local on purpose (a cron job is not an import surface). */
const TIRE_SIZE_RE = /\b(\d{3})[\s\/\-]+(\d{2,3})[\s\/\-]*(R|ZR|XL)?[\s\/\-]*(\d{2})\b/i;

export function extractTireSize(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(TIRE_SIZE_RE);
  if (!m) return null;
  return `${m[1]}/${m[2]}R${m[4]}`;
}

export interface QuoteGuardInput {
  amountCents: number;
  serviceDescription: string | null;
  /** cents · 0 means NOT CAPTURED (schema default) — treated as unknown */
  estimatedPartsCostCents: number;
  /** Other open (unmatched) estimate ids for the same phone, 30d window */
  overlappingEstimateIds: number[];
  /** Live supplier data when the quote is tire-shaped and Gateway answered.
   *  null = tire-shaped but Gateway unavailable · undefined = not tire-shaped */
  tireSupplier?: { size: string; cheapestSupplierCostCents: number; brandsChecked: number } | null;
}

export function evaluateQuoteChecks(input: QuoteGuardInput): QuoteGuardReport {
  const checks: GuardCheck[] = [];

  // 1. Amount sanity — typo guard, not a pricing opinion.
  if (input.amountCents < 2_000 || input.amountCents > 2_000_000) {
    checks.push({
      check: "amount_sane",
      status: "fail",
      detail: `$${Math.round(input.amountCents / 100)} is outside the $20–$20,000 sanity band — likely a data-entry slip`,
    });
  } else {
    checks.push({ check: "amount_sane", status: "pass", detail: `$${Math.round(input.amountCents / 100)} within sanity band` });
  }

  // 2. Overlapping open estimates — the plan's "active overlapping estimate".
  if (input.overlappingEstimateIds.length > 0) {
    checks.push({
      check: "no_overlapping_estimate",
      status: "fail",
      detail: `${input.overlappingEstimateIds.length} other open estimate(s) for the same phone (ids: ${input.overlappingEstimateIds.slice(0, 5).join(", ")}) — consolidate before follow-up so the customer isn't quoted twice`,
    });
  } else {
    checks.push({ check: "no_overlapping_estimate", status: "pass", detail: "no other open estimate for this phone in 30d" });
  }

  // 3. Parts cost capture + quote remainder — NEVER assumed, never
  //    called a margin (strike-6: the remainder still contains labor,
  //    fees, disposal and tax — it is not parts gross margin).
  let quoteRemainderAfterPartsCostPct: number | null = null;
  if (input.estimatedPartsCostCents > 0) {
    const remainderCents = input.amountCents - input.estimatedPartsCostCents;
    quoteRemainderAfterPartsCostPct = Math.round((remainderCents / input.amountCents) * 1000) / 10;
    if (remainderCents < 0) {
      checks.push({
        check: "quote_remainder_after_parts_cost",
        status: "fail",
        detail: `quote $${Math.round(input.amountCents / 100)} is BELOW captured parts cost $${Math.round(input.estimatedPartsCostCents / 100)} — selling below cost`,
      });
    } else {
      checks.push({
        check: "quote_remainder_after_parts_cost",
        status: "pass",
        detail: `quote remainder after captured parts cost: ${quoteRemainderAfterPartsCostPct}% (NOT a margin — labor/fees/tax live inside the remainder)`,
      });
    }
  } else {
    checks.push({
      check: "quote_remainder_after_parts_cost",
      status: "unknown",
      detail: "parts cost NOT CAPTURED on this estimate — profit unverifiable. Capturing estimated_parts_cost is the unlock for the whole profit column.",
    });
  }

  // 4. Tire quotes vs live supplier cost.
  if (input.tireSupplier === undefined) {
    // not tire-shaped — check not applicable; stay silent rather than pad the list
  } else if (input.tireSupplier === null) {
    checks.push({
      check: "tire_supplier_backing",
      status: "unknown",
      detail: "tire-shaped quote but Gateway supplier data unavailable — cannot verify the quote clears supplier cost",
    });
  } else {
    const { size, cheapestSupplierCostCents, brandsChecked } = input.tireSupplier;
    if (input.amountCents < cheapestSupplierCostCents) {
      checks.push({
        check: "tire_supplier_backing",
        status: "fail",
        detail: `quote $${Math.round(input.amountCents / 100)} is below the CHEAPEST Gateway supplier cost $${Math.round(cheapestSupplierCostCents / 100)} for ${size} (${brandsChecked} brands checked) — below cost before labor`,
      });
    } else {
      checks.push({
        check: "tire_supplier_backing",
        status: "pass",
        detail: `quote clears the cheapest SINGLE-TIRE ${size} supplier cost ($${Math.round(cheapestSupplierCostCents / 100)}, ${brandsChecked} brands) — quantity, install, disposal and tax are NOT modeled; this is a floor check, not a quality pass`,
      });
    }
  }

  // 5. Not-yet-capturable checks — stated as unknown so the checklist
  //    doubles as the data-capture roadmap (plan Wave 5).
  checks.push({
    check: "labor_included",
    status: "unknown",
    detail: "labor hours are not captured on estimates — cannot verify labor was quoted",
  });
  checks.push({
    check: "calibration_or_programming",
    status: "unknown",
    detail: "no capability/calibration flags captured — see the job-capability gate in the roadmap",
  });

  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    fail: checks.filter((c) => c.status === "fail").length,
    unknown: checks.filter((c) => c.status === "unknown").length,
  };

  const missingInputs = checks.filter((c) => c.status === "unknown").map((c) => c.check);

  return { checks, summary, quoteRemainderAfterPartsCostPct, missingInputs };
}

/**
 * DB wrapper: evaluate one ALG estimate by id. Loads the row, finds
 * same-phone open estimates (30d), and — when the description is
 * tire-shaped — asks Gateway for live supplier cost (remembering the
 * documented field inversion: selling_price IS the cost).
 */
export async function evaluateEstimateById(estimateId: number): Promise<
  | { ok: true; estimate: { id: number; customerName: string; amountCents: number; serviceDescription: string | null }; report: QuoteGuardReport }
  | { ok: false; error: string }
> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, error: "DB unavailable" };

  const rows = (await db.execute(sql`
    SELECT id, customer_name AS customerName, customer_phone AS customerPhone,
           service_description AS serviceDescription, estimated_amount AS estimatedAmount,
           estimated_parts_cost AS estimatedPartsCost
    FROM alg_estimates WHERE id = ${estimateId} LIMIT 1
  `)) as unknown as [Array<Record<string, unknown>>];
  const data = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : (rows as unknown as Array<Record<string, unknown>>);
  const est = data[0];
  if (!est) return { ok: false, error: `estimate ${estimateId} not found` };

  const phone10 = String(est.customerPhone ?? "").replace(/\D/g, "").slice(-10);
  let overlappingEstimateIds: number[] = [];
  if (phone10.length === 10) {
    try {
      const overlapRows = (await db.execute(sql`
        SELECT id FROM alg_estimates
        WHERE RIGHT(REGEXP_REPLACE(COALESCE(customer_phone, ''), '[^0-9]', ''), 10) = ${phone10}
          AND matched_invoice_id IS NULL
          AND id != ${estimateId}
          AND estimate_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        LIMIT 10
      `)) as unknown as [Array<{ id: number }>];
      const overlapData = Array.isArray(overlapRows) && Array.isArray(overlapRows[0]) ? overlapRows[0] : (overlapRows as unknown as Array<{ id: number }>);
      overlappingEstimateIds = overlapData.map((r) => Number(r.id));
    } catch (err) {
      log.warn("[quote-guard] overlap lookup failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Tire-shaped? Ask Gateway for live supplier cost.
  const serviceDescription = est.serviceDescription == null ? null : String(est.serviceDescription);
  const size = extractTireSize(serviceDescription);
  let tireSupplier: QuoteGuardInput["tireSupplier"] = undefined;
  if (size) {
    tireSupplier = null; // tire-shaped; unknown until Gateway answers
    try {
      const { searchTiresBySize } = await import("./gatewayClient");
      const tires = await searchTiresBySize(size);
      if (Array.isArray(tires) && tires.length > 0) {
        // gatewayClient.ts documents the inversion: `selling_price` is
        // what D&K CHARGES NICK (the cost); `cost_price` is retail.
        const costs = tires
          .map((t) => (typeof t.selling_price === "number" ? t.selling_price : null))
          .filter((v): v is number => v !== null && v > 0);
        if (costs.length > 0) {
          tireSupplier = {
            size,
            cheapestSupplierCostCents: Math.round(Math.min(...costs) * 100),
            brandsChecked: costs.length,
          };
        }
      }
    } catch (err) {
      log.warn("[quote-guard] gateway check failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const report = evaluateQuoteChecks({
    amountCents: Number(est.estimatedAmount ?? 0),
    serviceDescription,
    estimatedPartsCostCents: Number(est.estimatedPartsCost ?? 0),
    overlappingEstimateIds,
    tireSupplier,
  });

  return {
    ok: true,
    estimate: {
      id: Number(est.id),
      customerName: String(est.customerName ?? ""),
      amountCents: Number(est.estimatedAmount ?? 0),
      serviceDescription,
    },
    report,
  };
}
