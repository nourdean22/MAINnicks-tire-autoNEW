/**
 * Q-26 · Business-table freshness + volume contracts.
 *
 * Pattern adoption only: dbt source-freshness semantics + Elementary-style
 * weekday-seasonal volume checks, implemented as a small pure kernel over the
 * existing Nick's metrics/cron rails. No dbt/Elementary runtime is added.
 *
 * Important distinction:
 * - a MIRROR/SYNC source can be stale even when business volume is legitimately 0;
 * - an EVENT table can be quiet without being stale, so it gets a volume verdict
 *   only unless a real upstream sync receipt exists.
 */
export type DataFreshnessState = "fresh" | "warn" | "error" | "unmeasured";
export type DataVolumeState = "normal" | "warn" | "error" | "unmeasured";

export interface BusinessDataContract {
  key: string;
  table: string;
  /** The field whose daily counts are measured. */
  timeColumn: string;
  /** A real upstream sync receipt exists and is expected to advance. */
  freshness: null | {
    source: string;
    warnAfterShopDays: number;
    errorAfterShopDays: number;
  };
  volume: {
    /** Same-weekday history required before a z-score is allowed to speak. */
    minHistoryPoints: number;
    warnAbsZ: number;
    errorAbsZ: number;
  };
}

/**
 * Keep this list small and tied to real business decisions. Adding a table is a
 * measurement-policy change: name the source clock and explain why zero volume
 * is or is not meaningful.
 */
export const BUSINESS_DATA_CONTRACTS: readonly BusinessDataContract[] = Object.freeze([
  {
    key: "shopdriver_invoices",
    table: "invoices",
    timeColumn: "invoiceDate",
    freshness: {
      source: "shopdriver-invoice-mirror",
      // The mirror is probe-driven; one missed shop day is a warning, two is
      // operationally stale. The clock is the SYNC receipt, not max(invoiceDate).
      warnAfterShopDays: 1,
      errorAfterShopDays: 2,
    },
    volume: { minHistoryPoints: 4, warnAbsZ: 2.5, errorAbsZ: 4 },
  },
  {
    key: "leads",
    table: "leads",
    timeColumn: "createdAt",
    // A day with no leads can be a real day. Do not turn demand into freshness.
    freshness: null,
    volume: { minHistoryPoints: 4, warnAbsZ: 2.5, errorAbsZ: 4 },
  },
  {
    key: "callbacks",
    table: "callback_requests",
    timeColumn: "createdAt",
    // Same logic: customer demand may be zero; volume is the instrument.
    freshness: null,
    volume: { minHistoryPoints: 4, warnAbsZ: 2.5, errorAbsZ: 4 },
  },
] as const);

export interface FreshnessVerdict {
  state: DataFreshnessState;
  source: string;
  dataAsOf: string | null;
  shopDaysOld: number | null;
  warnAfterShopDays: number | null;
  errorAfterShopDays: number | null;
  reason: string;
}

export interface VolumeVerdict {
  state: DataVolumeState;
  current: number | null;
  expectedMean: number | null;
  standardDeviation: number | null;
  zScore: number | null;
  historyPoints: number;
  reason: string;
}

const DAY_MS = 86_400_000;

function isoShopDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-CA", { timeZone });
}

function weekdayInZone(d: Date, timeZone: string): number {
  const token = d.toLocaleString("en-US", { timeZone, weekday: "short" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(token);
}

/**
 * Count completed/entered shop calendar days after dataAsOf through now.
 * The caller provides the open weekdays so holidays or a future schedule change
 * do not get hard-coded into the kernel.
 */
export function shopDaysElapsed(input: {
  dataAsOf: Date;
  now: Date;
  timeZone: string;
  openWeekdays: readonly number[];
}): number {
  if (input.now.getTime() <= input.dataAsOf.getTime()) return 0;
  const open = new Set(input.openWeekdays);
  const startDate = isoShopDate(input.dataAsOf, input.timeZone);
  const endDate = isoShopDate(input.now, input.timeZone);
  if (startDate === endDate) return 0;

  let count = 0;
  // Noon UTC avoids DST midnight edge cases while Intl decides the shop date.
  for (
    let cursor = new Date(input.dataAsOf.getTime() + DAY_MS);
    isoShopDate(cursor, input.timeZone) <= endDate;
    cursor = new Date(cursor.getTime() + DAY_MS)
  ) {
    if (open.has(weekdayInZone(cursor, input.timeZone))) count++;
    if (count > 3700) break; // corrupt clocks must not spin forever
  }
  return count;
}

export function assessFreshness(input: {
  contract: BusinessDataContract;
  dataAsOf: Date | null;
  now: Date;
  timeZone: string;
  openWeekdays: readonly number[];
}): FreshnessVerdict {
  const policy = input.contract.freshness;
  if (!policy) {
    return {
      state: "unmeasured",
      source: "event-volume",
      dataAsOf: input.dataAsOf?.toISOString() ?? null,
      shopDaysOld: null,
      warnAfterShopDays: null,
      errorAfterShopDays: null,
      reason: "event table: zero new rows can be legitimate; freshness requires a real upstream sync receipt",
    };
  }
  if (!input.dataAsOf || !Number.isFinite(input.dataAsOf.getTime())) {
    return {
      state: "unmeasured",
      source: policy.source,
      dataAsOf: null,
      shopDaysOld: null,
      warnAfterShopDays: policy.warnAfterShopDays,
      errorAfterShopDays: policy.errorAfterShopDays,
      reason: "no successful source-sync timestamp is available",
    };
  }

  const shopDaysOld = shopDaysElapsed({
    dataAsOf: input.dataAsOf,
    now: input.now,
    timeZone: input.timeZone,
    openWeekdays: input.openWeekdays,
  });
  const state: DataFreshnessState =
    shopDaysOld >= policy.errorAfterShopDays
      ? "error"
      : shopDaysOld >= policy.warnAfterShopDays
        ? "warn"
        : "fresh";
  return {
    state,
    source: policy.source,
    dataAsOf: input.dataAsOf.toISOString(),
    shopDaysOld,
    warnAfterShopDays: policy.warnAfterShopDays,
    errorAfterShopDays: policy.errorAfterShopDays,
    reason:
      state === "fresh"
        ? `source sync is ${shopDaysOld} shop day(s) old`
        : `source sync is ${shopDaysOld} shop day(s) old (warn >= ${policy.warnAfterShopDays}, error >= ${policy.errorAfterShopDays})`,
  };
}

function sampleStdDev(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compare today's count only with historical counts from the SAME shop weekday.
 * This avoids declaring an ordinary Sunday quiet because Friday is busy.
 */
export function assessWeekdayVolume(input: {
  contract: BusinessDataContract;
  current: number | null;
  sameWeekdayHistory: readonly number[];
}): VolumeVerdict {
  const values = input.sameWeekdayHistory.filter(
    (value) => Number.isFinite(value) && value >= 0,
  );
  if (input.current === null || !Number.isFinite(input.current) || input.current < 0) {
    return {
      state: "unmeasured",
      current: null,
      expectedMean: null,
      standardDeviation: null,
      zScore: null,
      historyPoints: values.length,
      reason: "current volume was not measured",
    };
  }
  if (values.length < input.contract.volume.minHistoryPoints) {
    return {
      state: "unmeasured",
      current: input.current,
      expectedMean: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      standardDeviation: null,
      zScore: null,
      historyPoints: values.length,
      reason: `need ${input.contract.volume.minHistoryPoints} same-weekday history points; have ${values.length}`,
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = sampleStdDev(values, mean);
  // A perfectly flat history has sigma=0. Equal is normal; any departure is
  // maximally surprising. Cap at +/-99 so the verdict remains JSON-safe.
  const zScore =
    sd === 0
      ? input.current === mean
        ? 0
        : input.current > mean
          ? 99
          : -99
      : (input.current - mean) / sd;
  const absZ = Math.abs(zScore);
  const state: DataVolumeState =
    absZ >= input.contract.volume.errorAbsZ
      ? "error"
      : absZ >= input.contract.volume.warnAbsZ
        ? "warn"
        : "normal";
  return {
    state,
    current: input.current,
    expectedMean: mean,
    standardDeviation: sd,
    zScore,
    historyPoints: values.length,
    reason: `same-weekday z=${zScore.toFixed(2)} from ${values.length} historical point(s)`,
  };
}

export function contractByKey(key: string): BusinessDataContract {
  const found = BUSINESS_DATA_CONTRACTS.find((contract) => contract.key === key);
  if (!found) throw new Error(`unknown business data contract: ${key}`);
  return found;
}
