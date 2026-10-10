/**
 * A job the gate reads as 'unavailable' for hours must not be re-selected on
 * every pulse (2026-10-10). Job 2070001 — an external master with no audio QA —
 * was selected by the drain on every 15-minute pulse for a full day, held on
 * "no audio QA verdict", and the handler returned before production ever ran:
 * nothing new was made that day. Two fixes: the gate now PRODUCES missing
 * audio evidence (qualityGate.test.ts), and a job still 'unavailable' long
 * after it was ready is parked by the drain instead of selected.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_UNAVAILABLE_MS, staleUnavailable } from "./cron/jobs/dailyReelPost";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);

describe("staleUnavailable — the pure rule", () => {
  it("parks a job ready longer than the threshold, keeps a fresh one selectable", () => {
    expect(staleUnavailable({ productionReadyAt: hoursAgo(4) }, NOW)).toBe(true);
    expect(staleUnavailable({ productionReadyAt: hoursAgo(1) }, NOW)).toBe(false);
    expect(STALE_UNAVAILABLE_MS).toBe(3 * 60 * 60 * 1000);
  });
  it("prefers productionReadyAt, then updatedAt, then createdAt; accepts ISO strings", () => {
    expect(staleUnavailable({ productionReadyAt: hoursAgo(1), updatedAt: hoursAgo(9) }, NOW)).toBe(false);
    expect(staleUnavailable({ productionReadyAt: null, updatedAt: hoursAgo(9) }, NOW)).toBe(true);
    expect(staleUnavailable({ createdAt: hoursAgo(9).toISOString() }, NOW)).toBe(true);
  });
  it("never parks on a guess: no timestamp means not stale", () => {
    expect(staleUnavailable({}, NOW)).toBe(false);
    expect(staleUnavailable({ productionReadyAt: "not a date" }, NOW)).toBe(false);
  });
});

describe("the drain and today's-job branch both apply it", () => {
  const SRC = readFileSync(path.join(__dirname, "cron", "jobs", "dailyReelPost.ts"), "utf8");
  const loopStart = SRC.indexOf("const skipped: Array<{ jobId: number; code: string }> = [];");
  const loopEnd = SRC.indexOf("if (skipped.length) {", loopStart);
  const LOOP = SRC.slice(loopStart, loopEnd);
  it("the selection loop skips a stale 'unavailable' candidate with a typed code and continues", () => {
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);
    const i = LOOP.indexOf('code: "qa_parked:unavailable_stale"');
    expect(i).toBeGreaterThan(-1);
    expect(LOOP.slice(i, i + 80)).toContain("continue;");
    expect(LOOP).toContain('cGate.gate === "unavailable" && staleUnavailable(candidate)');
  });
  it("today's job gets the same rule, so a stale fallback cannot stall the lane either", () => {
    expect(SRC).toContain('g.gate === "unavailable" && staleUnavailable(todaysJob)) parked = "unavailable_stale"');
  });
});
