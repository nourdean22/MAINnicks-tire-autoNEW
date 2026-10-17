/**
 * A send_pause_declined_recovery set WHILE the declined loop runs stops the next
 * text (C5.5 round 2). Round 1 read the pause once before the loop, which sends
 * up to 20 (cron) or 500 (CLI) texts. Now the loop re-checks before each claim;
 * the 5 s cache makes that one read per 5 s, not one per estimate.
 *
 * The pause flips inside sendSms for estimate 1. Asserted: estimate 1 texted,
 * estimates 2-3 neither claimed nor texted, the run resolves with
 * `Skipped · send_pause:declined_recovery` and the count not attempted.
 * CONTROL: never paused -> all three texted. Synthetic 555 numbers, stub db.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paused: false,
  flipAfterFirstSend: false,
  sent: [] as string[],
  claims: 0,
  selects: [] as unknown[][],
}));

vi.mock("../../services/sendPause", () => ({
  sendPauseHoldReason: async (lane: string) => (h.paused ? `send_pause:${lane}` : null),
}));

vi.mock("../../db", () => ({
  getDb: async () => ({
    select: () => {
      const rows = h.selects.shift() ?? [];
      return { from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) };
    },
    update: () => ({
      set: (v: Record<string, unknown>) => {
        if (Object.keys(v).some((k) => /AttemptedAt$/.test(k))) h.claims++;
        return { where: async () => [{ affectedRows: 1 }] };
      },
    }),
  }),
}));

vi.mock("../../sms", () => ({
  sendSms: async (to: string) => {
    h.sent.push(to);
    if (h.flipAfterFirstSend) h.paused = true;
    return { success: true, sid: `SM${h.sent.length}` };
  },
}));
vi.mock("../../services/smsInstrumentation", () => ({ logOutboundSms: async () => undefined }));
vi.mock("../../services/telegram", () => ({ sendTelegram: async () => undefined, sendTelegramMessage: async () => undefined }));

const estimate = (id: number, phone: string) => ({
  id,
  customerName: "Synthetic Lead",
  customerPhone: phone,
  serviceDescription: "brake pads",
  estimatedAmount: 20_000,
  estimateDate: new Date(Date.now() - 10 * 86_400_000), // 7d touch due
  followUp3dSent: 0, followUp3dAttemptedAt: null,
  followUp7dSent: 0, followUp7dAttemptedAt: null,
  followUp14dSent: 0, followUp14dAttemptedAt: null,
  followUp30dSent: 0, followUp30dAttemptedAt: null,
  followUp45dSent: 0, followUp45dAttemptedAt: null,
  recoveryProfile: "P0",
  statedConcern: null,
  statedConcernSource: null,
  recoveryHoldout: 0,
});

beforeEach(() => {
  h.paused = false;
  h.flipAfterFirstSend = false;
  h.sent = [];
  h.claims = 0;
  // 1: eligible estimates · 2: opt-out preload · 3: customer-context preload
  h.selects = [[estimate(1, "2165550141"), estimate(2, "2165550142"), estimate(3, "2165550143")], [], []];
  vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const run = async () => (await import("./declinedWorkRecovery")).runDeclinedWorkRecovery({ bypassBusinessHoursCheck: true, maxSends: 50 });

describe("declined recovery · pause set mid-run", () => {
  it("CONTROL: never paused -> all three estimates are claimed and texted", async () => {
    const r = await run();
    expect(h.sent).toHaveLength(3);
    expect(h.claims).toBe(3);
    expect(r.recordsProcessed).toBe(3);
    expect(r.details).not.toMatch(/send_pause/);
  });

  it("pause flips after text 1 -> estimates 2-3 are neither claimed nor texted; Skipped with the count", async () => {
    h.flipAfterFirstSend = true;
    const r = await run();
    expect(h.sent).toEqual(["2165550141"]);
    expect(h.claims, "a held estimate keeps its touch: no AttemptedAt claim").toBe(1);
    expect(r.recordsProcessed).toBe(1);
    expect(r.details).toMatch(/^Skipped · send_pause:declined_recovery/);
    expect(r.details).toContain("not_attempted=2");
  });
});
