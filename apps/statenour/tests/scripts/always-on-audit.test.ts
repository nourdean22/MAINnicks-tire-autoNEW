/**
 * The always-on audit's recency split.
 *
 * WHAT IT DECIDES. Tiers 1 and 2 are attached to every standard/deep turn on
 * purpose, so each costs a tool slot ~100% of the time. The only honest claim
 * the audit makes is "surfaced N times inside the window and chosen ZERO times
 * inside it" — which turns entirely on comparing the tool's last call against
 * the SURFACING window, not against some fixed idea of recent.
 *
 * Measured 2026-09-18 over 259 turns / 30d: 5 of 9 always-on tools had not been
 * called since before the window opened — 1,295 impressions that earned
 * nothing. `createTask` is the instructive row: 76 LIFETIME calls but last
 * called 37 days ago, so a ratio of calls-to-impressions would have made it
 * look like the healthiest tool in the list while it was in fact cold. That is
 * why the audit prints `lastCallAt` beside the surfaced count and never divides
 * them — see docs/agent-audit/DEFECT-SHAPE-STALE-DENOMINATOR.md.
 */
import { describe, it, expect } from "vitest";
import { splitByRecency, type AlwaysOnRow } from "../../scripts/always-on-audit";

const row = (tool: string, lastCallDays: number, lifetimeCalls = 1): AlwaysOnRow => ({
  tool,
  tier: 1,
  surfaced: 259,
  lifetimeCalls,
  lastCallDays,
});

describe("splitByRecency", () => {
  it("puts a tool last called BEFORE the window into coldInWindow", () => {
    const { earning, coldInWindow } = splitByRecency([row("classifyThought", 66)], 30);
    expect(coldInWindow.map((r) => r.tool)).toEqual(["classifyThought"]);
    expect(earning).toEqual([]);
  });

  it("keeps a tool called INSIDE the window as earning", () => {
    const { earning, coldInWindow } = splitByRecency([row("searchMemories", 6, 70)], 30);
    expect(earning.map((r) => r.tool)).toEqual(["searchMemories"]);
    expect(coldInWindow).toEqual([]);
  });

  it("HIGH LIFETIME CALLS DO NOT RESCUE A COLD TOOL — the createTask case", () => {
    // 76 lifetime calls, last one 37 days ago, 30-day window. A
    // calls-per-impression ratio would rank this the healthiest row in the
    // audit; the window says it earned nothing in the period measured.
    const { coldInWindow } = splitByRecency([row("createTask", 37, 76)], 30);
    expect(coldInWindow.map((r) => r.tool)).toEqual(["createTask"]);
  });

  it("treats a NEVER-called tool as cold, not as missing data", () => {
    const { coldInWindow } = splitByRecency([row("neverCalled", Number.POSITIVE_INFINITY, 0)], 30);
    expect(coldInWindow.map((r) => r.tool)).toEqual(["neverCalled"]);
  });

  it("the boundary is the WINDOW, not a constant — same row flips with --days", () => {
    // The one case that proves the split is relative. `getRecentReflections`
    // at 15d is cold under --days=14 and earning under the 30d default; a
    // hardcoded threshold would answer the same either way and be wrong once.
    const r = [row("getRecentReflections", 15, 6)];
    expect(splitByRecency(r, 30).earning).toHaveLength(1);
    expect(splitByRecency(r, 14).coldInWindow).toHaveLength(1);
  });

  it("partitions without dropping or duplicating a row", () => {
    const rows = [row("a", 1), row("b", 40), row("c", 15), row("d", Number.POSITIVE_INFINITY)];
    const { earning, coldInWindow } = splitByRecency(rows, 30);
    expect(earning.length + coldInWindow.length).toBe(rows.length);
    expect([...earning, ...coldInWindow].map((r) => r.tool).sort()).toEqual(["a", "b", "c", "d"]);
  });
});
