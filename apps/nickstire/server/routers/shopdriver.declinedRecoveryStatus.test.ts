/**
 * shopdriver.declinedRecoveryStatus v2 (2026-10-25): one derived `state` plus the last real run.
 *
 * ShopDriver HQ showed three answers about declined-work recovery on one page: "Live: SMS follow-ups firing daily"
 * (the env var alone), "DRY-RUN until env set" (a static catalog line) and "dormant" (the cron observer). The server
 * now answers once: state live | shadow | paused | off | unknown, derived from the env switch, the send-pause
 * switch and what the sender actually did last, and the client renders it without deriving anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real drizzle and schema: another file's mock must not leak in (AGENTS.md section 3).
vi.unmock("drizzle-orm");
vi.unmock("drizzle-orm/mysql2");
vi.unmock("../../drizzle/schema");
vi.unmock("../lib/declinedRecoveryState");
vi.unmock("../cron/jobs/declinedWorkRecovery");

import { deriveDeclinedRecoveryState } from "../lib/declinedRecoveryState";

const h = vi.hoisted(() => ({
  pause: { paused: false, readable: true } as { paused: boolean; readable: boolean },
  globalPause: { paused: false, readable: true } as { paused: boolean; readable: boolean },
  sendsEnabled: true,
  estimates: [] as Array<{ id: number; estimatedAmount: number | null; followUp7dSent: number; followUp30dSent: number; estimateDate: Date }>,
  lastRun: null as null | { jobName: string; startedAt: Date; status: string; details: string | null; recordsProcessed: number | null },
  dbNull: false,
  failEstimates: false,
  failLastRun: false,
  lastRunJobFilter: [] as string[],
}));

vi.mock("../services/sendPause", () => ({
  sendPause: async () => h.pause,
  SEND_PAUSE_LANES: {},
  envArmed: () => true,
}));
vi.mock("../cron/jobs/declinedWorkRecovery", () => ({
  recoverySendsEnabled: () => h.sendsEnabled,
}));
// The shop-wide SMS pause (Settings > Safety, "Automated customer texts") holds these texts too (sms.ts sendSms).
vi.mock("../services/smsControl", () => ({
  getSmsPauseState: async () => h.globalPause,
}));

// The router reads two tables through db(): alg_estimates (eligible rows) then cron_log (latest sender run).
vi.mock("../lib/db-helper", () => ({
  db: async () => {
    if (h.dbNull) return null;
    const { cronLog } = await import("../../drizzle/schema");
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    return {
      select: () => ({
        from: (table: unknown) =>
          table === cronLog
            ? {
                where: (cond: never) => ({
                  orderBy: () => ({
                    limit: async () => {
                      if (h.failLastRun) throw new Error("cron_log unreadable");
                      h.lastRunJobFilter.push(...(new MySqlDialect().sqlToQuery(cond).params as unknown[]).map(String));
                      return h.lastRun ? [h.lastRun] : [];
                    },
                  }),
                }),
              }
            : {
                where: () => ({
                  limit: async () => {
                    if (h.failEstimates) throw new Error("estimates unreadable");
                    return h.estimates;
                  },
                }),
              },
      }),
    };
  },
}));
vi.mock("../db", () => ({ getDb: async () => null, getDbTyped: async () => ({}) }));

import { shopdriverRouter } from "./shopdriver";

const ctx = (role: "admin" | "user" = "admin") =>
  ({
    user: { id: 1, openId: `${role}-u`, email: "o@example.com", name: "O", loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  }) as never;
const status = () => shopdriverRouter.createCaller(ctx()).declinedRecoveryStatus();

const savedEnv = process.env.FEATURE_DECLINED_RECOVERY;
beforeEach(() => {
  process.env.FEATURE_DECLINED_RECOVERY = "1";
  h.pause = { paused: false, readable: true };
  h.globalPause = { paused: false, readable: true };
  h.sendsEnabled = true;
  h.estimates = [
    { id: 1, estimatedAmount: 30_000, followUp7dSent: 0, followUp30dSent: 0, estimateDate: new Date() },
    { id: 2, estimatedAmount: 20_000, followUp7dSent: 1, followUp30dSent: 0, estimateDate: new Date() },
  ];
  h.lastRun = null;
  h.dbNull = false;
  h.failEstimates = false;
  h.failLastRun = false;
  h.lastRunJobFilter.length = 0;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.FEATURE_DECLINED_RECOVERY;
  else process.env.FEATURE_DECLINED_RECOVERY = savedEnv;
});

describe("deriveDeclinedRecoveryState", () => {
  it.each([
    [{ featureEnabled: false, sendsEnabled: false, paused: false }, "off"],
    [{ featureEnabled: false, sendsEnabled: true, paused: true }, "off"],
    [{ featureEnabled: true, sendsEnabled: true, paused: true }, "paused"],
    [{ featureEnabled: true, sendsEnabled: false, paused: false }, "shadow"],
    [{ featureEnabled: true, sendsEnabled: false, paused: null }, "shadow"],
    [{ featureEnabled: true, sendsEnabled: true, paused: false }, "live"],
    [{ featureEnabled: true, sendsEnabled: true, paused: null }, "unknown"],
  ] as const)("%j -> %s", (input, expected) => {
    expect(deriveDeclinedRecoveryState(input)).toBe(expected);
  });

  it("never says live while sends are not enabled", () => {
    for (const paused of [true, false, null]) {
      expect(deriveDeclinedRecoveryState({ featureEnabled: true, sendsEnabled: false, paused })).not.toBe("live");
    }
  });
});

describe("shopdriver.declinedRecoveryStatus v2", () => {
  it("live: env on, sends enabled, switch readable and not paused; every old field is still there", async () => {
    const out = await status();
    expect(out).toMatchObject({
      featureEnabled: true,
      sendsEnabled: true,
      paused: false,
      state: "live",
      dryRun: false,
      eligible: 2,
      recoverableDollars: 500,
      next7dSends: 1,
      next30dSends: 2,
    });
    expect(out).toHaveProperty("message");
  });

  it("shadow: env on but the send predicate says no sends", async () => {
    h.sendsEnabled = false;
    expect(await status()).toMatchObject({ featureEnabled: true, sendsEnabled: false, state: "shadow" });
  });

  it("paused: the pause switch is on", async () => {
    h.pause = { paused: true, readable: true };
    expect(await status()).toMatchObject({ paused: true, state: "paused" });
  });

  // Bug hunt 2026-10-27: sendSms queues every automated customer text while sms_global_pause is on, so HQ saying
  // "live" with the lane's own switch off was the wrong word. Positive control: the lane's own switch still pauses (above).
  it("paused: the shop-wide SMS pause is on, even though the lane's own switch is off", async () => {
    h.globalPause = { paused: true, readable: true };
    expect(await status()).toMatchObject({ paused: true, state: "paused" });
  });

  it("unknown: the shop-wide SMS pause could not be read (marketing texts hold when it cannot be)", async () => {
    h.globalPause = { paused: false, readable: false };
    expect(await status()).toMatchObject({ paused: null, state: "unknown" });
  });

  it("an explicit pause outranks an unreadable switch", async () => {
    h.pause = { paused: true, readable: true };
    h.globalPause = { paused: false, readable: false };
    expect(await status()).toMatchObject({ paused: true, state: "paused" });
  });

  it("off: the env switch is not 1", async () => {
    delete process.env.FEATURE_DECLINED_RECOVERY;
    h.sendsEnabled = false;
    expect(await status()).toMatchObject({ featureEnabled: false, state: "off", dryRun: true });
  });

  it("unknown: the pause switch could not be read (paused is null, never false)", async () => {
    h.pause = { paused: false, readable: false };
    expect(await status()).toMatchObject({ paused: null, state: "unknown" });
  });

  it("lastRun is the sender's latest cron_log row (alg-declined-work-recovery), with its status and words", async () => {
    h.lastRun = {
      jobName: "alg-declined-work-recovery",
      startedAt: new Date("2026-10-25T13:00:00.000Z"),
      status: "skipped",
      details: "skipped: estimate-invoice-match did not succeed",
      recordsProcessed: 0,
    };
    const out = await status();
    expect(out.lastRun).toEqual({
      jobName: "alg-declined-work-recovery",
      at: "2026-10-25T13:00:00.000Z",
      status: "skipped",
      details: "skipped: estimate-invoice-match did not succeed",
      recordsProcessed: 0,
    });
    expect(h.lastRunJobFilter).toContain("alg-declined-work-recovery");
  });

  it("no run on record is lastRun null", async () => {
    expect((await status()).lastRun).toBeNull();
  });

  it("a database that is not available keeps the old null counts and an error; the state is derived from what could be read", async () => {
    h.dbNull = true;
    h.pause = { paused: false, readable: false };
    expect(await status()).toMatchObject({ eligible: null, recoverableDollars: null, error: "Database not available", lastRun: null, sendsEnabled: true, paused: null, state: "unknown" });
    delete process.env.FEATURE_DECLINED_RECOVERY;
    expect(await status()).toMatchObject({ error: "Database not available", state: "off" });
  });

  it("a failed read keeps null counts and an error; it does not invent a lastRun", async () => {
    h.failLastRun = true;
    expect(await status()).toMatchObject({ eligible: null, recoverableDollars: null, error: "DB query failed", lastRun: null });
  });
});
