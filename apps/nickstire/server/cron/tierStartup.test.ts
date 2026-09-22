/**
 * Tier startup fire · a tier whose last run is a full interval old fires at boot (2026-09-22)
 *
 * WHAT WAS WRONG. Only heartbeat, pulse and daily fired at boot; hourly and
 * briefings waited for a `setInterval` that starts counting at process boot.
 * With deploys under two hours apart — thirteen on 2026-09-22 — the hourly
 * tier never reached its first tick: last run 12:29Z, still silent at 20:00Z,
 * ten jobs (voice-recovery, enrich-customer-data, feedback-cycle, safety-check,
 * the statenour syncs). Same shape on 09-18 (gaps of 4.2 h and 11.6 h) and
 * 09-21 (3.6 h).
 *
 * WHAT THIS PINS. The pure decision, then that the scheduler calls it for
 * every tier (comment-stripped) and no longer hard-codes which tiers boot.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DAILY_STARTUP_ALLOWANCE_MS, shouldFireOnStartup } from "./tierStartup";

const H = 3600_000;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("shouldFireOnStartup", () => {
  it("the 2026-09-22 case: hourly tier, last run 7.5 h ago → fires", () => {
    expect(shouldFireOnStartup({ tierName: "hourly", intervalMs: 2 * H, lastRunAgeMs: 7.5 * H }).fire).toBe(true);
  });

  it("hourly tier, last run 30 min ago → does not fire (the interval timer owns it)", () => {
    expect(shouldFireOnStartup({ tierName: "hourly", intervalMs: 2 * H, lastRunAgeMs: 0.5 * H }).fire).toBe(false);
  });

  it("exactly one interval old → fires (boundary is inclusive: due is due)", () => {
    expect(shouldFireOnStartup({ tierName: "hourly", intervalMs: 2 * H, lastRunAgeMs: 2 * H }).fire).toBe(true);
    expect(shouldFireOnStartup({ tierName: "briefings", intervalMs: 6 * H, lastRunAgeMs: 6 * H - 1 }).fire).toBe(false);
  });

  it("never ran, or state unreadable → fires (a tier that cannot prove it ran recently must run)", () => {
    expect(shouldFireOnStartup({ tierName: "hourly", intervalMs: 2 * H, lastRunAgeMs: null }).fire).toBe(true);
    expect(shouldFireOnStartup({ tierName: "daily", intervalMs: 24 * H, lastRunAgeMs: null }).fire).toBe(true);
  });

  it("daily keeps its 20 h allowance: 18 h → skip, 21 h → fire (restart drift cannot slide it a day)", () => {
    expect(DAILY_STARTUP_ALLOWANCE_MS).toBe(20 * H);
    expect(shouldFireOnStartup({ tierName: "daily", intervalMs: 24 * H, lastRunAgeMs: 18 * H }).fire).toBe(false);
    expect(shouldFireOnStartup({ tierName: "daily", intervalMs: 24 * H, lastRunAgeMs: 21 * H }).fire).toBe(true);
  });

  it("POSITIVE CONTROL: heartbeat and pulse behave like any tier — a fresh run skips, a stale one fires", () => {
    expect(shouldFireOnStartup({ tierName: "heartbeat", intervalMs: 5 * 60_000, lastRunAgeMs: 60_000 }).fire).toBe(false);
    expect(shouldFireOnStartup({ tierName: "pulse", intervalMs: 15 * 60_000, lastRunAgeMs: 16 * 60_000 }).fire).toBe(true);
  });

  it("the scheduler asks it for EVERY tier and no longer hard-codes which tiers boot", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "./scheduler.ts"), "utf8"));
    expect(src).toContain("shouldFireOnStartup(");
    expect(src).not.toContain('idx <= 1 || tier.name === "daily"');
    // the age is computed in SQL, never from a driver-parsed TIMESTAMP
    expect(src).toMatch(/TIMESTAMPDIFF\(SECOND, last_run_at, NOW\(\)\)/);
  });
});
