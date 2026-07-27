/**
 * Metrics contract parity — the document and the registry cannot drift.
 *
 * Same guard as `voiceKernelParity.test.ts`, applied to measurement. Every
 * canonical metric named in a METRICS-CONTRACT.md table must exist in
 * `shared/metricsContract.ts`, and vice versa. Without this, the registry
 * becomes the eighth copy of a truth that already lives in prose — which is the
 * exact failure the Voice Kernel was built to end.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_METRICS,
  buildEnvelope,
  getCanonicalMetric,
  isRoiSafe,
  validateEnvelope,
  type MetricEnvelope,
} from "../shared/metricsContract";

const DOC = readFileSync(join(process.cwd(), "docs/METRICS-CONTRACT.md"), "utf-8");
const NOW = "2026-07-27T12:00:00.000Z";
const WINDOW = { from: "2026-07-01", to: "2026-07-27" };

/**
 * Pull the first cell of every data row from the doc's metric tables. The
 * canonical name is always the leading column.
 */
function documentedMetricNames(): string[] {
  const names: string[] = [];
  for (const line of DOC.split("\n")) {
    if (!line.startsWith("|")) continue;
    const first = line.split("|")[1]?.trim();
    if (!first) continue;
    if (/^-+:?$/.test(first) || first.startsWith("---")) continue;
    // Table headers across the doc's four tables.
    if (["Canonical metric", "Metric", "Canonical name"].includes(first)) continue;
    names.push(first.replace(/`/g, ""));
  }
  return names;
}

describe("metrics contract — document and registry parity", () => {
  it("every metric named in METRICS-CONTRACT.md is registered", () => {
    const missing = documentedMetricNames().filter((n) => !getCanonicalMetric(n));
    expect(missing).toEqual([]);
  });

  it("every registered metric is named in METRICS-CONTRACT.md", () => {
    const documented = new Set(documentedMetricNames().map((n) => n.toLowerCase()));
    const orphans = CANONICAL_METRICS.filter((m) => !documented.has(m.name.toLowerCase())).map(
      (m) => m.name,
    );
    expect(orphans).toEqual([]);
  });

  it("metric names are unique", () => {
    const names = CANONICAL_METRICS.map((m) => m.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("every rate declares its denominator", () => {
    const missing = CANONICAL_METRICS.filter((m) => m.section === "rates" && !m.denominator).map(
      (m) => m.name,
    );
    expect(missing).toEqual([]);
  });

  it("no modeled metric is ROI-safe", () => {
    const bad = CANONICAL_METRICS.filter((m) => m.evidence === "modeled" && isRoiSafe(m.name)).map(
      (m) => m.name,
    );
    expect(bad).toEqual([]);
  });

  it("Verified attributed revenue is the ROI-safe revenue concept", () => {
    // The north star. If a future change makes a second revenue concept
    // ROI-safe, that is a contract amendment and must be deliberate.
    const roiSafeRevenue = CANONICAL_METRICS.filter(
      (m) => m.section === "revenue" && isRoiSafe(m.name),
    ).map((m) => m.name);
    expect(roiSafeRevenue).toEqual(["Verified attributed revenue"]);
  });
});

describe("metrics contract — envelope construction", () => {
  it("rejects a non-canonical metric name", () => {
    expect(() =>
      buildEnvelope({
        metric: "Hard Conversions",
        value: 42,
        window: WINDOW,
        source: "vapi_call_logs",
        version: "v1",
        now: NOW,
      }),
    ).toThrow(/not a canonical metric/);
  });

  it("stamps evidence from the contract, not the caller", () => {
    const env = buildEnvelope({
      metric: "Tool engagements",
      value: 494,
      window: WINDOW,
      source: "voice state trail",
      version: "facts-v1",
      now: NOW,
    });
    expect(env.evidence).toBe("observed");
    expect(env.limitations).toContain(
      "A tool engagement is not a lead, booking, arrival or paid job (ROS-003/004)",
    );
  });

  it("a null value becomes state unavailable with no data-as-of", () => {
    const env = buildEnvelope({
      metric: "Verified attributed revenue",
      value: null,
      window: WINDOW,
      source: "invoices",
      version: "v1",
      now: NOW,
    });
    expect(env.state).toBe("unavailable");
    expect(env.dataAsOf).toBeNull();
    expect(env.lastSuccessfulAt).toBeNull();
    // lastAttemptedAt is still stamped — we tried, and that is worth knowing.
    expect(env.lastAttemptedAt).toBe(NOW);
  });
});

describe("metrics contract — the two absolute rules", () => {
  const base = {
    window: { from: WINDOW.from, to: WINDOW.to, timeZone: "America/New_York" },
    source: "test",
    version: "v1",
    lastAttemptedAt: NOW,
    lastSuccessfulAt: NOW,
    dataAsOf: NOW,
    limitations: [],
  };

  it("flags a rate published without its denominator", () => {
    const env: MetricEnvelope = {
      ...base,
      canonicalMetric: "Paid conversion rate",
      value: 0.31,
      state: "ok",
      evidence: "verified",
      numerator: 12,
      denominator: null,
    };
    expect(validateEnvelope(env).map((v) => v.rule)).toContain("denominator-required");
  });

  it("flags a rate over a zero denominator (ROS-041)", () => {
    // getNickGptStats returned 100% approval on a zero denominator, painting a
    // quiet day as flawless. A rate over nothing is unavailable, not perfect.
    const env: MetricEnvelope = {
      ...base,
      canonicalMetric: "Qualified-call to lead rate",
      value: 1,
      state: "ok",
      evidence: "verified",
      numerator: 0,
      denominator: 0,
    };
    expect(validateEnvelope(env).map((v) => v.rule)).toContain("zero-denominator");
  });

  it("flags a modeled value labelled verified (ROS-007)", () => {
    const env: MetricEnvelope = {
      ...base,
      canonicalMetric: "Modeled pipeline value",
      value: 18_500,
      state: "ok",
      evidence: "verified",
      numerator: null,
      denominator: null,
    };
    const rules = validateEnvelope(env).map((v) => v.rule);
    expect(rules).toContain("modeled-not-verified");
  });

  it("flags an unavailable metric that still carries a zero (ROS-036/037/049)", () => {
    // "$0 owed · Everything issued has been paid" over a failed read.
    const env: MetricEnvelope = {
      ...base,
      canonicalMetric: "Verified attributed revenue",
      value: 0,
      state: "unavailable",
      evidence: "verified",
      numerator: null,
      denominator: null,
      lastSuccessfulAt: null,
      dataAsOf: null,
    };
    expect(validateEnvelope(env).map((v) => v.rule)).toContain("unavailable-must-be-null");
  });

  it("passes a well-formed rate", () => {
    const env: MetricEnvelope = {
      ...base,
      canonicalMetric: "Technical-failure rate",
      value: 0.04,
      state: "ok",
      evidence: "observed",
      numerator: 8,
      denominator: 200,
    };
    expect(validateEnvelope(env)).toEqual([]);
  });

  it("passes a well-formed unavailable metric", () => {
    const env: MetricEnvelope = {
      ...base,
      canonicalMetric: "Verified attributed revenue",
      value: null,
      state: "unavailable",
      evidence: "verified",
      numerator: null,
      denominator: null,
      lastSuccessfulAt: null,
      dataAsOf: null,
    };
    expect(validateEnvelope(env)).toEqual([]);
  });
});
