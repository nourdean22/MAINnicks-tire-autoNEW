/**
 * Bounded retry + dead-letter (Autopilot Wave 1, 2026-07-29, migration 0104).
 *
 * Before: a definitive drain failure left the row 'sending' → 10-min
 * recovery → 'queued' → retry, forever; only the 48h time-bound terminated
 * it (~190 doomed attempts) and no row carried a failure cause.
 *
 * Pinned here:
 *   1. recordSendFailure increments send_attempts and dead-letters at
 *      MAX_SEND_ATTEMPTS with reason 'max_retries_exceeded: <cause>' —
 *      guarded to status='sending' so a webhook-resolved row is never
 *      clobbered.
 *   2. Pre-0104 (unknown column) degrades silently ONCE and stops querying.
 *   3. The stuck-queue alert predicate fires only when the pipe is healthy,
 *      in-hours, unpaused, and something is genuinely due.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.unmock("./sms");

let executedSql: string[] = [];
let executeThrows: string | null = null;

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      if (executeThrows) throw new Error(executeThrows);
      executedSql.push(JSON.stringify(q));
      return [{ affectedRows: 1 }];
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  executedSql = [];
  executeThrows = null;
});

describe("recordSendFailure", () => {
  it("one UPDATE: increments attempts, dead-letters at the cap, stamps the cause — guarded to 'sending'", async () => {
    const { recordSendFailure, MAX_SEND_ATTEMPTS } = await import("./sms");
    await recordSendFailure(42, "Gateway returned 500: relay exploded");
    expect(executedSql.length).toBe(1);
    const q = executedSql[0];
    expect(q).toContain("send_attempts");
    expect(q).toContain("COALESCE(send_attempts, 0) + 1");
    expect(q).toContain("max_retries_exceeded");
    expect(q).toContain("'failed'");
    expect(q).toContain("'sending'");
    expect(MAX_SEND_ATTEMPTS).toBe(5);
  });

  it("truncates the cause (VARCHAR(255) safety)", async () => {
    const { recordSendFailure } = await import("./sms");
    await recordSendFailure(43, "x".repeat(500));
    expect(executedSql.length).toBe(1);
    // param values ride the drizzle sql object; the 200-char slice is in code —
    // assert no 500-char run made it into the serialized statement params
    expect(executedSql[0]).not.toContain("x".repeat(201));
  });

  it("pre-0104 unknown-column degrades ONCE and stops querying (no per-send error spam)", async () => {
    executeThrows = "ER_BAD_FIELD_ERROR: Unknown column 'send_attempts' in 'field list' (1054)";
    const { recordSendFailure } = await import("./sms");
    await recordSendFailure(44, "boom");
    // flag set — second call must not hit the DB at all
    executeThrows = null;
    await recordSendFailure(45, "boom again");
    expect(executedSql.length).toBe(0);
  });
});

describe("shouldAlertStuckQueue (pure predicate)", () => {
  const base = {
    gatewayConfigured: true,
    gatewayReachable: true,
    withinSendingHours: true,
    paused: false,
    stuckCount: 3,
    nowMs: 10_000_000,
    lastAlertAtMs: 0,
  };

  it("fires when healthy + in-hours + unpaused + stuck rows exist", async () => {
    const { shouldAlertStuckQueue } = await import("./sms");
    expect(shouldAlertStuckQueue(base)).toBe(true);
  });

  it("never fires for an EXPECTED hold (offline / quiet hours / operator pause / empty)", async () => {
    const { shouldAlertStuckQueue } = await import("./sms");
    expect(shouldAlertStuckQueue({ ...base, gatewayReachable: false })).toBe(false);
    expect(shouldAlertStuckQueue({ ...base, gatewayConfigured: false })).toBe(false);
    expect(shouldAlertStuckQueue({ ...base, withinSendingHours: false })).toBe(false);
    expect(shouldAlertStuckQueue({ ...base, paused: true })).toBe(false);
    expect(shouldAlertStuckQueue({ ...base, stuckCount: 0 })).toBe(false);
  });

  it("re-alert is throttled to hourly while the stall persists", async () => {
    const { shouldAlertStuckQueue } = await import("./sms");
    const justAlerted = { ...base, lastAlertAtMs: base.nowMs - 10 * 60_000 };
    expect(shouldAlertStuckQueue(justAlerted)).toBe(false);
    const hourLater = { ...base, lastAlertAtMs: base.nowMs - 61 * 60_000 };
    expect(shouldAlertStuckQueue(hourLater)).toBe(true);
  });
});

describe("replay wiring pin", () => {
  it("smsOps.replayFailed claims failed→queued atomically (idempotent by WHERE)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(join(process.cwd(), "server", "routers", "smsOps.ts"), "utf8");
    expect(src).toContain("replayFailed");
    expect(src).toMatch(/SET status = 'queued'[\s\S]*?WHERE id = \$\{input\.messageId\} AND status = 'failed' AND direction = 'outbound'/);
    expect(src).toContain("send_attempts = 0");
    expect(src).toContain("sms.replay_failed");
  });
});
