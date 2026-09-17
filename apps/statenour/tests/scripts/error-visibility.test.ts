/**
 * Canaries for the error-visibility probes' CONTROLS.
 *
 * WHY THIS FILE EXISTS. Both probes shipped without behavioural tests, which
 * the repo explicitly requires for every probe. The queries are not the part
 * that lies — the CONTROLS are. Each probe's empty state has several causes
 * with opposite meanings, and the whole value of both is refusing to collapse
 * them:
 *
 *   · error_logs quiet + writer fresh -> a real quiet period
 *   · error_logs quiet + writer stale -> a DEAD WRITER reported as health
 *   · Langfuse 0 errors + traces > 0  -> a real result
 *   · Langfuse 0 errors + traces == 0 -> nothing was TRACED
 *
 * A probe that prints "0 errors" without saying which of those it is has told
 * the operator the system is fine when the instrument may simply be off. Every
 * test below injects a known-broken case and requires the refusing verdict,
 * alongside an intact case that passes.
 */
import { describe, it, expect } from "vitest";
import {
  assessWriterControl,
  assessTraceControl,
  assessSampleCoverage,
  countBy,
  WRITER_STALE_HOURS,
} from "../../scripts/lib/error-visibility.mjs";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("assessWriterControl", () => {
  it("a fresh writer lets a quiet window be read as quiet", () => {
    const r = assessWriterControl({ total: 3230, newest: hoursAgo(2), nowMs: NOW });
    expect(r.verdict).toBe("fresh");
    expect(r.trustQuiet).toBe(true);
    expect(r.ageHours).toBeCloseTo(2, 1);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The failure that reads as success: nothing logged for weeks, so the
  // window looks calm. This must refuse.
  it("CANARY — a stale writer must NOT let a quiet window read as health", () => {
    const r = assessWriterControl({ total: 3230, newest: hoursAgo(WRITER_STALE_HOURS + 1), nowMs: NOW });
    expect(r.verdict).toBe("stale");
    expect(r.trustQuiet).toBe(false);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // An all-time-empty error log is far more likely to be a broken writer
  // than a flawless system.
  it("CANARY — an empty table is never 'fresh' and never trusted", () => {
    for (const bad of [
      { total: 0, newest: null },
      { total: 0, newest: hoursAgo(1) },
      { total: 12, newest: null },
    ]) {
      const r = assessWriterControl({ ...bad, nowMs: NOW });
      expect(r.verdict).toBe("empty");
      expect(r.trustQuiet).toBe(false);
    }
  });

  it("holds the staleness boundary exactly", () => {
    expect(assessWriterControl({ total: 1, newest: hoursAgo(WRITER_STALE_HOURS - 0.1), nowMs: NOW }).verdict).toBe("fresh");
    expect(assessWriterControl({ total: 1, newest: hoursAgo(WRITER_STALE_HOURS + 0.1), nowMs: NOW }).verdict).toBe("stale");
  });
});

describe("assessTraceControl", () => {
  it("traces present makes a zero-error result meaningful", () => {
    const r = assessTraceControl({ totalTraces: 341 });
    expect(r.verdict).toBe("usable");
    expect(r.trustZeroErrors).toBe(true);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // Zero errors against zero traces is an absence of measurement, not a
  // clean bill of health. This is the exact shape a dead exporter, wrong
  // keys, or a wrong environment filter produces.
  it("CANARY — zero traces must refuse to validate a zero-error count", () => {
    for (const n of [0, undefined as unknown as number, null as unknown as number]) {
      const r = assessTraceControl({ totalTraces: n });
      expect(r.verdict).toBe("no-traces");
      expect(r.trustZeroErrors).toBe(false);
    }
  });
});

describe("assessSampleCoverage", () => {
  it("a full sample is complete", () => {
    const c = assessSampleCoverage({ total: 338, sampled: 338 });
    expect(c.complete).toBe(true);
    expect(c.pct).toBe(100);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // One page of 50 out of 2,963 is a sample of whatever sorted FIRST.
  // "all errors are X" drawn from it is a conclusion about pagination.
  it("CANARY — a thin page is flagged unrepresentative", () => {
    const c = assessSampleCoverage({ total: 2963, sampled: 50 });
    expect(c.complete).toBe(false);
    expect(c.representative).toBe(false);
    expect(c.pct).toBeLessThan(2);
  });

  it("an empty population is never complete", () => {
    const c = assessSampleCoverage({ total: 0, sampled: 0 });
    expect(c.complete).toBe(false);
    expect(c.representative).toBe(false);
  });

  it("a substantial sample is partial but representative", () => {
    expect(assessSampleCoverage({ total: 600, sampled: 600 }).complete).toBe(true);
    expect(assessSampleCoverage({ total: 1000, sampled: 300 }).representative).toBe(true);
  });
});

describe("countBy", () => {
  it("counts and sorts descending", () => {
    const rows = [{ m: "a" }, { m: "b" }, { m: "a" }, { m: "c" }, { m: "a" }];
    expect(countBy(rows, (r) => r.m)).toEqual([
      ["a", 3],
      ["b", 1],
      ["c", 1],
    ]);
  });

  it("does not drop rows whose key is empty", () => {
    expect(countBy([{ m: "" }, { m: "" }], (r) => r.m || "(blank)")).toEqual([["(blank)", 2]]);
  });
});
