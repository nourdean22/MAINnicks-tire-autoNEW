/**
 * Metric grammar · presentation over `MetricResult<number>` · 2026-09-15
 * (UI workbench slice 1).
 *
 * The three-state substrate already exists: lib/services/metric-result.ts
 * (`ok` / `degraded` / `unavailable`, with `source`, `measuredAt`,
 * `sampleSize`). What was missing is the second half of the sentence a
 * number needs to be read at all — "relative to what?" — which lived as five
 * separate conventions (trend-counter baselines, freshness-chip tiers,
 * scattered `sampleSize` fields). This module is that sentence, as data.
 *
 *   72                 →   72 d
 *                           -8 (-10%) vs 30-day baseline
 *                           normal 75–82 · n=18 · measured 3h ago · source: whoop
 *
 * Invariants, each pinned by tests/ui/metric-datum.test.ts:
 *   · `unavailable` never yields a number — `primary` is "unknown" and
 *     `reason` carries the error code (the house "empty is not error" rule).
 *   · `degraded` shows the stale value AND says it is stale.
 *   · a delta is only computed against a baseline the caller supplied; no
 *     baseline means no delta, not a delta of zero.
 */

import type { MetricResult } from "@/lib/services/metric-result";

export interface MetricSpec {
  label: string;
  /** Short unit suffix rendered after the number: "d", "%", "lb", "min". */
  unit?: string;
  /** Measurement window: "24h", "7d", "30d". */
  window?: string;
  /** What "relative to" means for this metric. */
  baseline?: { value: number; label: string } | null;
  /** The normal band; a value outside it is worth the operator's eye. */
  range?: { lo: number; hi: number; label?: string } | null;
  /** null / undefined = a change has no valence (a count, a gap). */
  higherIsBetter?: boolean | null;
  /** Number formatter; defaults to a locale-neutral compact integer/decimal. */
  format?: (value: number) => string;
}

export type MetricTone = "good" | "bad" | "neutral";

export interface MetricDelta {
  text: string;
  tone: MetricTone;
}

export interface MetricView {
  status: "measured" | "stale" | "unavailable";
  label: string;
  /** "72", or "unknown" when unavailable. Never a fabricated zero. */
  primary: string;
  unit?: string;
  delta: MetricDelta | null;
  /** Secondary lines: range, sample size, freshness, source. */
  context: string[];
  /** Why the value is unknown or stale. */
  reason?: string;
  /** True when a measured value sits outside `spec.range`. */
  outOfRange: boolean;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "unknown";
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** "just now" · "45s ago" · "3m ago" · "3h ago" · "2d ago" · "3w ago". */
export function formatAge(fromIso: string | Date, now: Date): string {
  const from = typeof fromIso === "string" ? new Date(fromIso) : fromIso;
  const ms = now.getTime() - from.getTime();
  if (!Number.isFinite(ms)) return "unknown age";
  if (ms < 10_000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

/**
 * Delta against a baseline, with trend-counter.tsx's rules: absolute always,
 * percent when the baseline is non-zero and the percent stays readable.
 * Tone follows `higherIsBetter`; a metric without valence stays neutral.
 */
export function deltaVsBaseline(
  value: number,
  baseline: { value: number; label: string },
  higherIsBetter: boolean | null | undefined,
): MetricDelta {
  const diff = value - baseline.value;
  if (diff === 0) return { text: `flat vs ${baseline.label}`, tone: "neutral" };
  const sign = diff > 0 ? "+" : "-";
  const abs = formatNumber(Math.abs(diff));
  let pct = "";
  if (baseline.value !== 0) {
    const p = Math.round((diff / Math.abs(baseline.value)) * 100);
    if (Math.abs(p) < 1000 && p !== 0) pct = ` (${p > 0 ? "+" : ""}${p}%)`;
  }
  let tone: MetricTone = "neutral";
  if (higherIsBetter === true) tone = diff > 0 ? "good" : "bad";
  else if (higherIsBetter === false) tone = diff > 0 ? "bad" : "good";
  return { text: `${sign}${abs}${pct} vs ${baseline.label}`, tone };
}

export function describeMetric(result: MetricResult<number>, spec: MetricSpec, now: Date = new Date()): MetricView {
  const format = spec.format ?? formatNumber;
  const context: string[] = [];

  if (result.status === "unavailable") {
    context.push(`source: ${result.source}`);
    return {
      status: "unavailable",
      label: spec.label,
      primary: "unknown",
      unit: undefined,
      delta: null,
      context,
      reason: `read failed (${result.errorCode})`,
      outOfRange: false,
    };
  }

  const value = result.status === "ok" ? result.value : result.value;
  const measuredAt = result.status === "ok" ? result.measuredAt : result.measuredAt;

  if (value === undefined || !Number.isFinite(value)) {
    // `degraded` with no value carries no number: report it as unknown, not
    // as a stale zero.
    context.push(`source: ${result.source}`);
    return {
      status: "unavailable",
      label: spec.label,
      primary: "unknown",
      delta: null,
      context,
      reason: result.status === "degraded" ? `degraded (${result.errorCode})` : "no value",
      outOfRange: false,
    };
  }

  const delta = spec.baseline ? deltaVsBaseline(value, spec.baseline, spec.higherIsBetter) : null;

  let outOfRange = false;
  if (spec.range) {
    outOfRange = value < spec.range.lo || value > spec.range.hi;
    const bandLabel = spec.range.label ?? "normal";
    context.push(`${bandLabel} ${format(spec.range.lo)}–${format(spec.range.hi)}`);
  }
  if (spec.window) context.push(`window ${spec.window}`);
  const sampleSize = result.status === "ok" ? result.sampleSize : undefined;
  if (typeof sampleSize === "number") context.push(`n=${sampleSize}`);
  if (measuredAt) context.push(`measured ${formatAge(measuredAt, now)}`);
  context.push(`source: ${result.source}`);

  if (result.status === "degraded") {
    const since = result.staleSince ? ` since ${formatAge(result.staleSince, now).replace(" ago", "")}` : "";
    return {
      status: "stale",
      label: spec.label,
      primary: format(value),
      unit: spec.unit,
      delta,
      context,
      reason: `stale${since} (${result.errorCode})`,
      outOfRange,
    };
  }

  return {
    status: "measured",
    label: spec.label,
    primary: format(value),
    unit: spec.unit,
    delta,
    context,
    outOfRange,
  };
}
