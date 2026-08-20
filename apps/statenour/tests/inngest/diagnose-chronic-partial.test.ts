/**
 * diagnose-cron-failure · chronically-partial fan-outs must be diagnosable.
 *
 * Measured in prod 2026-08-20 (cron_job_logs): mega-evening held 1,248
 * `partial` rows and ZERO `success` in 14 days — consolidate aborted in every
 * one of them — yet this workflow filed nothing, because it only ever read
 * `status: "failed"`. The child names were sitting in the error JSON the
 * whole time (`summarizeSettled` format).
 */
import { describe, it, expect } from "vitest";
import {
  isChronicPartial,
  summarizeFailingChildren,
  CHRONIC_MIN_PARTIALS,
} from "@/lib/inngest/functions/diagnose-cron-failure";

describe("isChronicPartial", () => {
  it("flags a job with only partial runs (the mega-evening shape)", () => {
    expect(isChronicPartial({ success: 0, partial: 7 })).toBe(true);
  });

  it("does not flag a job that also finishes clean — it recovers on its own", () => {
    expect(isChronicPartial({ success: 5, partial: 9 })).toBe(false);
  });

  it("does not flag a single degraded night", () => {
    expect(isChronicPartial({ success: 0, partial: CHRONIC_MIN_PARTIALS - 1 })).toBe(false);
  });

  it("does not flag a job with no runs at all", () => {
    expect(isChronicPartial({ success: 0, partial: 0 })).toBe(false);
  });
});

describe("summarizeFailingChildren", () => {
  const night = (paths: string[]) =>
    JSON.stringify(paths.map((p) => ({ path: p, status: 502, ms: 90000 })));

  it("names the repeat offender first", () => {
    const out = summarizeFailingChildren([
      night(["/api/cron/consolidate", "/api/cron/predict"]),
      night(["/api/cron/consolidate"]),
      night(["/api/cron/consolidate", "/api/cron/intelligence"]),
    ]);
    expect(out[0]).toEqual({ path: "/api/cron/consolidate", count: 3 });
    expect(out).toHaveLength(3);
  });

  it("survives poison rows — prod holds errors that are not JSON at all", () => {
    // Live find, 2026-08-20: a jsonb cast over cron_job_logs.error threw
    // `invalid input syntax for type json`. Legacy rows hold prose.
    const out = summarizeFailingChildren([
      "handler returned ok:false",
      null,
      "{truncated…",
      '{"not":"an array"}',
      night(["/api/cron/consolidate"]),
    ]);
    expect(out).toEqual([{ path: "/api/cron/consolidate", count: 1 }]);
  });

  it("ignores array entries without a string path", () => {
    const out = summarizeFailingChildren([
      JSON.stringify([{ status: 502 }, null, "str", { path: "/api/cron/predict" }]),
    ]);
    expect(out).toEqual([{ path: "/api/cron/predict", count: 1 }]);
  });

  it("parses the PROSE format the live Inngest v2 path writes — found empty-handed 2026-08-20", () => {
    // Real rows, verbatim from prod cron_job_logs. The first parser version
    // was JSON-only; a probe of 14 pre-storm partial nights returned ZERO
    // children because mega-fanout.ts writes `failures.join(" ; ")` prose.
    const out = summarizeFailingChildren([
      "/api/cron/consolidate: The operation was aborted due to timeout ; /api/cron/mastery-xp: The operation was aborted due to timeout",
      "/api/cron/consolidate: The operation was aborted due to timeout",
    ]);
    expect(out[0]).toEqual({ path: "/api/cron/consolidate", count: 2 });
    expect(out).toContainEqual({ path: "/api/cron/mastery-xp", count: 1 });
  });

  it("does not double-count a path mentioned inside a failure message", () => {
    // Real row: the path appears TWICE — once as the segment head, once
    // inside the message. Only the anchored head counts.
    const out = summarizeFailingChildren([
      "/api/cron/ingest-reviews: child cron /api/cron/ingest-reviews returned 500 after 388ms",
    ]);
    expect(out).toEqual([{ path: "/api/cron/ingest-reviews", count: 1 }]);
  });

  it("aggregates query-string children under the base path", () => {
    const out = summarizeFailingChildren([
      "/api/cron/journal-checkin?slot=evening: timeout ; /api/cron/journal-checkin?slot=morning: timeout",
    ]);
    expect(out).toEqual([{ path: "/api/cron/journal-checkin", count: 2 }]);
  });

  it("mixes both formats across rows — history is JSON, the future is prose", () => {
    const out = summarizeFailingChildren([
      JSON.stringify([{ path: "/api/cron/consolidate", status: 502 }]),
      "/api/cron/consolidate: The operation was aborted due to timeout",
    ]);
    expect(out).toEqual([{ path: "/api/cron/consolidate", count: 2 }]);
  });

  it("returns empty for no errors", () => {
    expect(summarizeFailingChildren([])).toEqual([]);
  });
});
