/**
 * The send switches card must not show a reversed chip after a toggle (C5.5 round 2, Codex P1 on #3135).
 *
 * The card refetches sendSwitchesStatus right after featureFlags.toggle. Before
 * this fix both reads went through sendPause's 5 s process cache, so the refetch
 * returned the pre-toggle state. Now setFlag drops the lane's cache entry for a
 * send_pause_* key (in-process), and the status read is always fresh (any
 * process). Real sendPause + real setFlag over a fake feature_flags table; the
 * clock is frozen so nothing leans on the 5 s expiry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const h = vi.hoisted(() => ({ rows: new Map<string, boolean>(), flagReads: 0 }));

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const key = /send_pause_[a-z_]+|sms_global_pause/.exec(JSON.stringify(q))?.[0];
      if (!key) return [[]];
      h.flagReads++;
      return [h.rows.get(key) ? [{ v: 1 }] : []];
    },
    update: () => ({
      set: (v: { value: boolean }) => ({
        where: async (cond: SQL) => {
          // render the WHERE the way MySQL would; its one bound param is the flag key
          const key = new MySqlDialect().sqlToQuery(cond).params.find((p): p is string => typeof p === "string");
          if (key) h.rows.set(key, v.value);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  }),
}));

beforeEach(async () => {
  h.rows = new Map();
  h.flagReads = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T15:00:00Z"));
  const { _resetSendPauseCacheForTest } = await import("./services/sendPause");
  _resetSendPauseCacheForTest();
  (await import("./services/smsControl"))._resetPauseCacheForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("send pause cache vs the toggle", () => {
  it("toggle then a cached read within 5 s returns the NEW value (setFlag invalidates the lane)", async () => {
    const { sendPauseHoldReason } = await import("./services/sendPause");
    const { setFlag } = await import("./services/featureFlags");
    expect(await sendPauseHoldReason("weather_sms")).toBeNull(); // primes the cache: live
    await setFlag("send_pause_weather_sms" as never, true);
    expect(h.rows.get("send_pause_weather_sms"), "the fake table took the write").toBe(true);
    expect(await sendPauseHoldReason("weather_sms")).toBe("send_pause:weather_sms");
  });

  it("the status read is fresh: a flip made elsewhere (another process) shows within 5 s", async () => {
    const { sendPauseHoldReason, readSendSwitchesStatus } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("declined_recovery")).toBeNull(); // cached live
    h.rows.set("send_pause_declined_recovery", true); // no setFlag in this process
    const s = await readSendSwitchesStatus({}, async () => new Map());
    expect(s.lanes.find((l) => l.lane === "declined_recovery")?.paused).toBe(true);
  });

  // The card's shop-wide chip (effectivePaused) also reads sms_global_pause, which smsControl caches 5 s per process.
  it("the status read sees a flip of the shop-wide SMS pause made behind smsControl's cache", async () => {
    const { getSmsPauseState } = await import("./services/smsControl");
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    expect((await getSmsPauseState()).paused).toBe(false); // primes smsControl's cache: not paused
    h.rows.set("sms_global_pause", true);
    const s = await readSendSwitchesStatus({}, async () => new Map()); // default readGlobalPause, the production path
    expect(s.lanes.find((l) => l.lane === "declined_recovery")?.effectivePaused).toBe(true);
  });

  it("CONTROL: a non-send_pause toggle leaves the send pause cache alone", async () => {
    const { sendPauseHoldReason } = await import("./services/sendPause");
    const { setFlag } = await import("./services/featureFlags");
    expect(await sendPauseHoldReason("weather_sms")).toBeNull(); // cached live
    h.rows.set("send_pause_weather_sms", true); // changed behind the cache
    const reads = h.flagReads;
    await setFlag("weather_triggered_sms", true);
    expect(await sendPauseHoldReason("weather_sms"), "still the cached answer").toBeNull();
    expect(h.flagReads).toBe(reads);
  });
});
