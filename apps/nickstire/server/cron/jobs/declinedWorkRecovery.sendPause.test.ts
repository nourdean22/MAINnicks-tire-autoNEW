/**
 * runDeclinedWorkRecovery · send_pause_declined_recovery holds the live send path (C5.5).
 * Covers the cron, the admin run-now button and the CLI: all three enter here.
 * Real sendPause reader over a fake db; sendSms is a fake that counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pause: "off" as "off" | "paused" | "throw",
  smsCalls: 0,
  selects: 0,
}));

vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      if (!JSON.stringify(q).includes("send_pause_declined_recovery")) return [[]];
      if (h.pause === "throw") throw new Error("connection refused");
      return [h.pause === "paused" ? [{ v: 1 }] : []];
    },
    select: () => (h.selects++, {
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 1, customerName: "Pat", customerPhone: "2165550142", estimatedAmount: 50000 }],
        }),
      }),
    }),
  }),
}));

vi.mock("../../sms", () => ({
  sendSms: async () => {
    h.smsCalls++;
    throw new Error("live send path reached (test stops here)");
  },
}));

beforeEach(async () => {
  h.pause = "off";
  h.smsCalls = 0;
  h.selects = 0;
  vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
  const { _resetSendPauseCacheForTest } = await import("../../services/sendPause");
  _resetSendPauseCacheForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const run = async () => {
  const { runDeclinedWorkRecovery } = await import("./declinedWorkRecovery");
  return runDeclinedWorkRecovery({ bypassBusinessHoursCheck: true, maxSends: 1 });
};

describe("declined recovery · send pause", () => {
  it("paused -> skip outcome with send_pause:declined_recovery, sendSms never reached", async () => {
    h.pause = "paused";
    const r = await run();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toMatch(/^Skipped · send_pause:declined_recovery/);
    expect(h.smsCalls).toBe(0);
    expect(h.selects, "only the eligibility read ran; no opt-out preload, no claim").toBe(1);
  });

  it("unreadable switch -> fail CLOSED with send_pause_unreadable:declined_recovery", async () => {
    h.pause = "throw";
    const r = await run();
    expect(r.details).toMatch(/^Skipped · send_pause_unreadable:declined_recovery/);
    expect(h.smsCalls).toBe(0);
  });

  it("CONTROL: not paused -> the run goes past the gate into the live send path", async () => {
    // Past the gate the live path preloads opt-outs with a second select; reaching it is the proof.
    const r = await run().catch((e: unknown) => ({ details: String(e) }));
    expect(r.details).not.toMatch(/send_pause/);
    expect(h.selects).toBeGreaterThan(1);
  });
});
