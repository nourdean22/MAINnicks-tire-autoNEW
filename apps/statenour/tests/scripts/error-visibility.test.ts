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
  ageBand,
  countBy,
  traceIdentity,
  LIVE_HOURS,
  RECENT_HOURS,
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

/**
 * ageBand — a count without a recency is not actionable.
 *
 * Ranking 30d of error_logs by COUNT put a one-day outage from a month ago in
 * the top three (1091 + 924 + 291, all sharing last_at 2026-08-20T08:38) and
 * buried the only still-arriving fault — ai.judge-eval, 81 — at sixth.
 */
describe("ageBand", () => {
  const NOW_MS = Date.parse("2026-09-17T12:00:00Z");
  const hAgo = (h: number) => new Date(NOW_MS - h * 3_600_000).toISOString();

  it("bands by age", () => {
    expect(ageBand(hAgo(1), NOW_MS).band).toBe("live");
    expect(ageBand(hAgo(LIVE_HOURS + 1), NOW_MS).band).toBe("recent");
    expect(ageBand(hAgo(RECENT_HOURS + 1), NOW_MS).band).toBe("stale");
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The measured inversion. Volume alone ranks the dead outage first; the band
  // must sort it BELOW the small live cluster. If this flips, the probe is
  // handing the operator a month-old incident as today's top priority.
  it("CANARY — a live 81x cluster outranks a stale 924x one", () => {
    const stale = { n: 924, last: hAgo(24 * 28) };
    const live = { n: 81, last: hAgo(20) };
    const ranked = [stale, live].sort((a, b) => {
      const d = ageBand(a.last, NOW_MS).rank - ageBand(b.last, NOW_MS).rank;
      return d !== 0 ? d : b.n - a.n;
    });
    expect(ranked[0]).toBe(live);
    // …and the ordering this replaced would have got it backwards.
    expect([stale, live].sort((a, b) => b.n - a.n)[0]).toBe(stale);
  });

  it("still ranks by volume WITHIN a band, so recency alone cannot dominate", () => {
    const small = { n: 1, last: hAgo(1) };
    const big = { n: 80, last: hAgo(30) }; // both live
    const ranked = [small, big].sort((a, b) => {
      const d = ageBand(a.last, NOW_MS).rank - ageBand(b.last, NOW_MS).rank;
      return d !== 0 ? d : b.n - a.n;
    });
    expect(ranked[0]).toBe(big);
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The worst possible failure: an unparseable timestamp becoming age 0 and
  // jumping the queue. That is the empty-vs-missing trap in the time domain —
  // the same defect as `t.name ?? "(unnamed)"`, one type over.
  it("CANARY — an unparseable timestamp is stale, never live", () => {
    for (const bad of ["", "not-a-date", null, undefined]) {
      const r = ageBand(bad as never, NOW_MS);
      expect(r.band).toBe("stale");
      expect(r.rank).toBe(2);
      expect(r.ageHours).toBe(Infinity);
    }
  });

  it("accepts a Date as well as a string, since drivers return both", () => {
    expect(ageBand(new Date(NOW_MS - 3_600_000), NOW_MS).band).toBe("live");
  });
});

/**
 * traceIdentity — the empty-vs-missing distinction, in operator form.
 *
 * Production sends an unnamed trace as `name: ""`. The probe's first version
 * wrote `t.name ?? "(unnamed)"`, and the nullish coalesce passed the empty
 * string through: the report printed a count beside a BLANK label, which reads
 * as a name too faint to see rather than as no name at all. The section was
 * titled "so a failing surface is identifiable" and rendered the opposite.
 */
describe("traceIdentity", () => {
  // POSITIVE CONTROL — a real name must still win, or every assertion below
  // would pass on a function that returns "(unnamed)" unconditionally.
  it("a named trace reports its own name", () => {
    const r = traceIdentity({ name: "memory-consolidation", metadata: { source: "brain" } });
    expect(r).toEqual({ label: "memory-consolidation", named: true, via: "name" });
  });

  // ── CANARY ──────────────────────────────────────────────────────────
  // The exact production shape. This is the case `??` gets wrong.
  it("CANARY — an EMPTY-STRING name is not-named, and `??` would miss it", () => {
    const trace = { name: "", metadata: { source: "memory-consolidation" }, tags: ["brain"] };
    expect(traceIdentity(trace).named).toBe(false);
    // …and the naive form that shipped: it yields "" and reports a blank label.
    expect(trace.name ?? "(unnamed)").toBe("");
  });

  it("a whitespace-only name is also not-named", () => {
    expect(traceIdentity({ name: "   ", tags: ["brain"] }).named).toBe(false);
  });

  it("falls back to metadata.source, which is the identity that survives", () => {
    const r = traceIdentity({ name: "", metadata: { source: "chain-of-verification" }, tags: ["brain"] });
    expect(r.via).toBe("metadata.source");
    expect(r.label).toContain("chain-of-verification");
    expect(r.label).toContain("(unnamed)"); // never silently reads as a real name
  });

  it("falls back to tags when there is no source", () => {
    const r = traceIdentity({ name: "", tags: ["brain", "chat"] });
    expect(r.via).toBe("tags");
    expect(r.label).toBe("(unnamed) tags=brain+chat");
  });

  // Absence of EVERY channel must say so out loud rather than collapse into the
  // same bucket as "unnamed but attributable" — those are different findings.
  it("says so explicitly when no channel identifies the trace", () => {
    expect(traceIdentity({ name: "", metadata: {}, tags: [] })).toEqual({
      label: "(unnamed, no source, no tags)",
      named: false,
      via: "none",
    });
  });

  it("survives null/undefined metadata and tags without throwing", () => {
    expect(traceIdentity({ name: null, metadata: null, tags: null }).via).toBe("none");
    expect(traceIdentity({}).via).toBe("none");
  });

  // The measured production distribution: every trace unnamed, every one still
  // attributable. A future regression that reported these as NAMED would make
  // the probe claim the Langfuse UI is filterable when it is not.
  it("reproduces the measured production shape: 0 named, all attributable", () => {
    const sample = [
      { name: "", metadata: { source: "memory-consolidation" }, tags: ["brain"] },
      { name: "", metadata: { source: "chain-of-verification" }, tags: ["brain", "chat"] },
      { name: "", metadata: { source: "conversation-memory" }, tags: ["brain"] },
    ];
    expect(sample.filter((t) => traceIdentity(t).named)).toEqual([]);
    expect(sample.every((t) => traceIdentity(t).via === "metadata.source")).toBe(true);
  });
});
