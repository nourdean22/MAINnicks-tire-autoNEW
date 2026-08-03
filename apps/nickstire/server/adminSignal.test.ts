/**
 * adminSignal.test.ts · 2026-08-03
 *
 * Pins the fold that replaces `getBadgeCount()`'s hand-written switch.
 *
 * THE DEFECT BEING FIXED: that switch handled 5 of 16 sections and its fallback
 * was `return 0`. Its own docblock said a count that could not be read "must not
 * render as zero: a failed query showing 0 is a green light the system never
 * gave" — then returned 0 for all 11 sections nobody had wired. Two different
 * silences were both rendered as a confident zero:
 *
 *   1. WE COULD NOT COUNT     -> must be "?"
 *   2. NOTHING MEASURES THIS  -> must be NO badge at all
 *
 * These tests exist to keep those three states (counted / unknown / not_measured)
 * from collapsing back into a number.
 */
import { describe, expect, it } from "vitest";

import {
  type AdminSignal,
  type SignalSeverity,
  describeBadge,
  exceptionFeed,
  foldSignals,
  reading,
  signalsForSection,
} from "@shared/adminSignal";

const sig = (
  over: Partial<AdminSignal> & Pick<AdminSignal, "id" | "reading">,
): AdminSignal => ({
  section: "overview",
  label: "things",
  severity: "info" as SignalSeverity,
  source: "test.procedure",
  updatedAt: null,
  ...over,
});

const counted = (id: string, count: number, over: Partial<AdminSignal> = {}) =>
  sig({ id, reading: { state: "counted", count }, ...over });
const unknown = (id: string, reason = "boom", over: Partial<AdminSignal> = {}) =>
  sig({ id, reading: { state: "unknown", reason }, ...over });
const unmeasured = (id: string, reason = "nothing wired", over: Partial<AdminSignal> = {}) =>
  sig({ id, reading: { state: "not_measured", reason }, ...over });

// ───────────────────────────────────────────────────────────────────────
// reading() — the one place a fetch result becomes a state
// ───────────────────────────────────────────────────────────────────────
describe("reading() · every call site converts failure the same way", () => {
  it("a failed fetch reads unknown EVEN WHEN a stale value is present", () => {
    // react-query keeps the last successful `data` while isError is true on a
    // refetch. Trusting `value` here would render a frozen number as current.
    const r = reading({ failed: true, value: 7, sourceLabel: "ops" });
    expect(r.state).toBe("unknown");
  });

  it("a source-reported unknown wins over its own zeroed counts", () => {
    // operationsSignal returns {total: 0, unknown: true} when its queries throw.
    const r = reading({ unknown: true, value: 0, sourceLabel: "ops" });
    expect(r.state).toBe("unknown");
  });

  it("null means we could not count — unknown, not zero", () => {
    expect(reading({ value: null, sourceLabel: "ops" }).state).toBe("unknown");
  });

  it("undefined means nothing has reported — not_measured, not zero", () => {
    const r = reading({ value: undefined, sourceLabel: "ops", notMeasuredReason: "no source" });
    expect(r.state).toBe("not_measured");
    if (r.state === "not_measured") expect(r.reason).toBe("no source");
  });

  it("zero is a real count — we looked and there is nothing", () => {
    const r = reading({ value: 0, sourceLabel: "ops" });
    expect(r).toEqual({ state: "counted", count: 0 });
  });

  it("names the source in every failure reason, so a '?' is traceable", () => {
    for (const r of [
      reading({ failed: true, value: 1, sourceLabel: "adminDashboard.bundle" }),
      reading({ unknown: true, value: 1, sourceLabel: "adminDashboard.bundle" }),
      reading({ value: null, sourceLabel: "adminDashboard.bundle" }),
    ]) {
      expect(r.state).toBe("unknown");
      if (r.state === "unknown") expect(r.reason).toContain("adminDashboard.bundle");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// foldSignals() — the rule that stops under-reporting
// ───────────────────────────────────────────────────────────────────────
describe("foldSignals() · one unknown poisons the badge", () => {
  it("no signals at all is not_measured — the `return 0` case", () => {
    expect(foldSignals([])).toEqual({ state: "not_measured" });
  });

  it("ANY unknown contributor makes the whole badge unknown", () => {
    // Summing only the readable half under-reports outstanding work, and
    // under-reporting is the direction that gets ignored.
    const badge = foldSignals([counted("a", 3), unknown("b", "db down")]);
    expect(badge.state).toBe("unknown");
    if (badge.state === "unknown") expect(badge.reason).toBe("db down");
  });

  it("all-unmeasured is not_measured, never 0", () => {
    expect(foldSignals([unmeasured("a"), unmeasured("b")])).toEqual({ state: "not_measured" });
  });

  it("a partially wired section shows the part that is real", () => {
    const badge = foldSignals([counted("a", 2), unmeasured("b")]);
    expect(badge).toMatchObject({ state: "counted", count: 2, contributors: 1 });
  });

  it("counted zero stays counted — 'we looked, nothing outstanding'", () => {
    const badge = foldSignals([counted("a", 0)]);
    expect(badge).toMatchObject({ state: "counted", count: 0 });
  });

  it("sums across contributors", () => {
    const badge = foldSignals([counted("a", 2), counted("b", 5)]);
    expect(badge).toMatchObject({ state: "counted", count: 7, contributors: 2 });
  });

  it("severity is the max across signals that actually have work", () => {
    const badge = foldSignals([
      counted("a", 4, { severity: "info" }),
      counted("b", 1, { severity: "urgent" }),
    ]);
    expect(badge).toMatchObject({ severity: "urgent" });
  });

  it("a signal counting ZERO does not get to colour the badge urgent", () => {
    const badge = foldSignals([
      counted("a", 3, { severity: "info" }),
      counted("b", 0, { severity: "urgent" }),
    ]);
    expect(badge).toMatchObject({ state: "counted", count: 3, severity: "info" });
  });
});

// ───────────────────────────────────────────────────────────────────────
// exceptionFeed() — an unreadable queue is itself an exception
// ───────────────────────────────────────────────────────────────────────
describe("exceptionFeed() · silence is not an all-clear", () => {
  it("includes unknown signals — 'we cannot tell' is an exception", () => {
    const feed = exceptionFeed([unknown("a", "db down")]);
    expect(feed.map((s) => s.id)).toEqual(["a"]);
  });

  it("excludes zero-count and unmeasured signals", () => {
    const feed = exceptionFeed([counted("zero", 0), unmeasured("nope"), counted("real", 1)]);
    expect(feed.map((s) => s.id)).toEqual(["real"]);
  });

  it("sorts most severe first", () => {
    const feed = exceptionFeed([
      counted("low", 9, { severity: "info" }),
      counted("high", 1, { severity: "urgent" }),
      counted("mid", 5, { severity: "warning" }),
    ]);
    expect(feed.map((s) => s.id)).toEqual(["high", "mid", "low"]);
  });

  it("an unreadable queue outranks a readable one of equal severity", () => {
    // Its size could be anything, so it deserves the operator's eye first.
    const feed = exceptionFeed([
      counted("readable", 50, { severity: "warning" }),
      unknown("unreadable", "timeout", { severity: "warning" }),
    ]);
    expect(feed[0].id).toBe("unreadable");
  });
});

describe("signalsForSection() · scoping", () => {
  it("returns only the section's own signals, most severe first", () => {
    const all = [
      counted("a", 1, { section: "revenue", severity: "info" }),
      counted("b", 1, { section: "revenue", severity: "urgent" }),
      counted("c", 1, { section: "overview" }),
    ];
    expect(signalsForSection(all, "revenue").map((s) => s.id)).toEqual(["b", "a"]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// describeBadge() — every number on screen must be traceable
// ───────────────────────────────────────────────────────────────────────
describe("describeBadge() · a number nobody can trace is a rumour", () => {
  it("an unmeasured section says so and never implies zero", () => {
    const text = describeBadge({ state: "not_measured" }, []);
    expect(text).toMatch(/nothing measures/i);
    expect(text).not.toMatch(/\b0\b/);
  });

  it("an unknown badge names why", () => {
    const text = describeBadge({ state: "unknown", reason: "db down" }, []);
    expect(text).toContain("db down");
    expect(text).toMatch(/could not read/i);
  });

  it("a counted badge names each contributing source", () => {
    const signals = [
      counted("a", 3, { label: "held reels", source: "contentAdmin.operationsSignal" }),
      counted("b", 2, { label: "new leads", source: "adminDashboard.overviewMediumBundle" }),
    ];
    const text = describeBadge(foldSignals(signals), signals);
    expect(text).toContain("3 held reels");
    expect(text).toContain("contentAdmin.operationsSignal");
    expect(text).toContain("2 new leads");
  });

  it("distinguishes 'nothing outstanding' from 'nothing measured'", () => {
    const signals = [counted("a", 0, { label: "held reels" })];
    expect(describeBadge(foldSignals(signals), signals)).toMatch(/nothing outstanding/i);
    expect(describeBadge({ state: "not_measured" }, [])).not.toMatch(/nothing outstanding/i);
  });
});

// ───────────────────────────────────────────────────────────────────────
// The regression this PR exists for
// ───────────────────────────────────────────────────────────────────────
describe("the getBadgeCount regressions, replayed", () => {
  it("an unwired section renders NO badge, not a confident zero", () => {
    // `return 0` for 11 sections told the operator "Money: 0 problems" about a
    // badge that had never been connected to anything.
    expect(foldSignals([]).state).toBe("not_measured");
  });

  it("a failed overview bundle can no longer show leads as zero", () => {
    // getAdminActionableCounts does `input.bookings ?? []`, so a failed bundle
    // returned total: 0. Admin.tsx knew (overviewUnavailable) and rendered a
    // degraded banner, but never told the badge — confident zeros beside a
    // banner saying the data was degraded.
    const leads = sig({
      id: "new-leads",
      section: "leads",
      reading: reading({ failed: true, value: 0, sourceLabel: "adminDashboard.overviewMediumBundle" }),
    });
    expect(foldSignals([leads]).state).toBe("unknown");
  });

  it("ops unknown still poisons the overview badge, as it did before", () => {
    // This behaviour was already correct and must survive the refactor.
    const ops = sig({
      id: "ops",
      section: "overview",
      reading: reading({ unknown: true, value: 0, sourceLabel: "contentAdmin.operationsSignal" }),
    });
    const bookings = counted("bookings", 4, { section: "overview" });
    expect(foldSignals([ops, bookings]).state).toBe("unknown");
  });
});
