/**
 * The per-item pause check reads FRESH, not the 5 s cache (C5.5 round 2, Codex P1).
 *
 * declinedWorkRecovery.midRunPause.test.ts mocks the reader, so it cannot see
 * the cache. This file drives the REAL sendPause over a fake feature_flags row:
 * the start gate reads (and caches) "live", the row flips to paused inside
 * sendSms for estimate 1, and the clock never moves. A cached per-item check
 * would answer "live" for the next 5 s and a fast loop (up to 500 from the CLI)
 * would finish; the fresh check must hold estimate 2.
 * CONTROL: never paused -> all three texted, and the start gate is one read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paused: false,
  flipAfterFirstSend: false,
  flagReads: 0,
  sent: [] as string[],
  selects: [] as unknown[][],
}));

vi.mock("../../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      if (!JSON.stringify(q).includes("send_pause_declined_recovery")) return [[]];
      h.flagReads++;
      return [h.paused ? [{ v: 1 }] : []];
    },
    select: () => {
      const rows = h.selects.shift() ?? [];
      return { from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }) };
    },
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
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
  id, customerName: "Synthetic Lead", customerPhone: phone, serviceDescription: "brake pads", estimatedAmount: 20_000,
  estimateDate: new Date(Date.now() - 10 * 86_400_000),
  followUp3dSent: 0, followUp3dAttemptedAt: null, followUp7dSent: 0, followUp7dAttemptedAt: null,
  followUp14dSent: 0, followUp14dAttemptedAt: null, followUp30dSent: 0, followUp30dAttemptedAt: null,
  followUp45dSent: 0, followUp45dAttemptedAt: null,
  recoveryProfile: "P0", statedConcern: null, statedConcernSource: null, recoveryHoldout: 0,
});

beforeEach(async () => {
  h.paused = false;
  h.flipAfterFirstSend = false;
  h.flagReads = 0;
  h.sent = [];
  // Freeze the clock FIRST (estimate ages read it): nothing below may lean on the 5 s cache expiring.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  h.selects = [[estimate(1, "2165550141"), estimate(2, "2165550142"), estimate(3, "2165550143")], [], []];
  vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
  const { _resetSendPauseCacheForTest } = await import("../../services/sendPause");
  _resetSendPauseCacheForTest();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const run = async () => (await import("./declinedWorkRecovery")).runDeclinedWorkRecovery({ bypassBusinessHoursCheck: true, maxSends: 500 });

describe("declined recovery · the per-item check is a fresh read", () => {
  it("CONTROL: never paused -> all three texted", async () => {
    const r = await run();
    expect(h.sent).toHaveLength(3);
    expect(r.details).not.toMatch(/send_pause/);
  });

  it("the row flips to paused after text 1 with the clock frozen -> text 2 is held", async () => {
    h.flipAfterFirstSend = true;
    const r = await run();
    expect(h.sent).toEqual(["2165550141"]);
    expect(r.details).toMatch(/^Skipped · send_pause:declined_recovery/);
    expect(r.details).toContain("not_attempted=2");
  });
});
