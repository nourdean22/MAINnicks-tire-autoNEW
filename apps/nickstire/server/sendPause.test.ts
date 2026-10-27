/**
 * sendPause: the DB-backed runtime pause for env-armed customer-facing send lanes.
 *
 * Pinned here:
 *   1. shouldHold is the whole decision: paused holds, live sends, and an
 *      unreadable switch holds an UNATTENDED lane and sends a 1:1 reply lane.
 *   2. The reader never swallows a failed read: a throw or a missing db is
 *      readable:false (never a confident "not paused").
 *   3. envArmed compares each env flag exactly as the lane's code does.
 *   4. The status read reports an unreadable switch as paused:null, never false.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type DbMode = "throw" | "nodb" | "rows";
let dbMode: DbMode = "rows";
let flagRows: Record<string, unknown> = {};
const queries: string[] = [];
const warns: Array<{ msg: string; meta: unknown }> = [];

vi.mock("./lib/logger", () => ({
  createLogger: () => ({
    info: () => {}, debug: () => {}, error: () => {},
    warn: (msg: string, meta?: unknown) => { warns.push({ msg, meta }); },
  }),
}));

vi.mock("./db", () => ({
  getDb: async () => {
    if (dbMode === "throw") throw new Error("connection refused");
    if (dbMode === "nodb") return null;
    return {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        queries.push(text);
        const key = Object.keys(flagRows).find((k) => text.includes(k));
        return [key ? [{ v: flagRows[key] }] : []];
      },
    };
  },
}));

beforeEach(async () => {
  dbMode = "rows";
  flagRows = {};
  queries.length = 0;
  warns.length = 0;
  const { _resetSendPauseCacheForTest } = await import("./services/sendPause");
  _resetSendPauseCacheForTest();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("shouldHold · the pure decision", () => {
  it("unattended lane + unreadable switch -> HOLD (fail closed)", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("voice_outbound", { paused: false, readable: false })).toBe(true);
  });

  it("1:1 reply lane + unreadable switch -> SEND (fail open)", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("customer_confirmations", { paused: false, readable: false })).toBe(false);
  });

  it("paused -> HOLD for both classes", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("voice_outbound", { paused: true, readable: true })).toBe(true);
    expect(shouldHold("customer_confirmations", { paused: true, readable: true })).toBe(true);
  });

  it("live -> SEND for both classes", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("voice_outbound", { paused: false, readable: true })).toBe(false);
    expect(shouldHold("customer_confirmations", { paused: false, readable: true })).toBe(false);
  });

  it("fail classes are exactly the declared ones (voice is CLOSED)", async () => {
    const { SEND_PAUSE_LANES } = await import("./services/sendPause");
    const classes = Object.fromEntries(Object.entries(SEND_PAUSE_LANES).map(([l, d]) => [l, d.failClass]));
    expect(classes).toEqual({
      voice_outbound: "closed",
      customer_confirmations: "open",
      declined_recovery: "closed",
      weather_sms: "closed",
      missed_call_recovery: "closed",
    });
  });

  it("each lane reads its own send_pause_<lane> key", async () => {
    const { SEND_PAUSE_LANES } = await import("./services/sendPause");
    for (const [lane, def] of Object.entries(SEND_PAUSE_LANES)) expect(def.key).toBe(`send_pause_${lane}`);
  });
});

describe("sendPause · the reader", () => {
  it("missing row = not paused, readable", async () => {
    const { sendPause } = await import("./services/sendPause");
    expect(await sendPause("weather_sms")).toEqual({ paused: false, readable: true });
  });

  it("value=1 row = paused, and the query names that lane's key", async () => {
    flagRows = { send_pause_weather_sms: 1 };
    const { sendPause } = await import("./services/sendPause");
    expect(await sendPause("weather_sms")).toEqual({ paused: true, readable: true });
    expect(queries.some((q) => q.includes("send_pause_weather_sms"))).toBe(true);
  });

  it("a paused lane does not pause its neighbour", async () => {
    flagRows = { send_pause_weather_sms: 1 };
    const { sendPause } = await import("./services/sendPause");
    expect(await sendPause("declined_recovery")).toEqual({ paused: false, readable: true });
  });

  it("a failed read is readable:false, never swallowed into a confident answer", async () => {
    dbMode = "throw";
    const { sendPause } = await import("./services/sendPause");
    expect(await sendPause("voice_outbound")).toEqual({ paused: false, readable: false });
  });

  it("no db is readable:false", async () => {
    dbMode = "nodb";
    const { sendPause } = await import("./services/sendPause");
    expect(await sendPause("voice_outbound")).toEqual({ paused: false, readable: false });
  });

  it("caches for a short window, then sees the flip", async () => {
    const { sendPause, _resetSendPauseCacheForTest } = await import("./services/sendPause");
    expect((await sendPause("weather_sms")).paused).toBe(false);
    flagRows = { send_pause_weather_sms: 1 };
    expect((await sendPause("weather_sms")).paused).toBe(false);
    _resetSendPauseCacheForTest();
    expect((await sendPause("weather_sms")).paused).toBe(true);
  });

  it("round 2: a fresh read bypasses the cache, with no clock advance, and refreshes it", async () => {
    const { sendPause } = await import("./services/sendPause");
    expect((await sendPause("weather_sms")).paused).toBe(false);
    flagRows = { send_pause_weather_sms: 1 };
    expect((await sendPause("weather_sms", { fresh: true })).paused).toBe(true);
    // the fresh answer is now the cached one, so a start gate right after sees it too
    const before = queries.length;
    expect((await sendPause("weather_sms")).paused).toBe(true);
    expect(queries.length).toBe(before);
  });

  it("CONTROL: two start-gate (cached) reads within 5 s are ONE db call", async () => {
    const { sendPauseHoldReason } = await import("./services/sendPause");
    await sendPauseHoldReason("declined_recovery");
    await sendPauseHoldReason("declined_recovery");
    expect(queries.filter((q) => q.includes("send_pause_declined_recovery"))).toHaveLength(1);
  });

  it("round 2: sendPauseHoldReason(lane, actor, { fresh: true }) sees a pause set inside the cache window", async () => {
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("declined_recovery")).toBeNull();
    flagRows = { send_pause_declined_recovery: 1 };
    expect(await sendPauseHoldReason("declined_recovery")).toBeNull(); // cached: the start-gate shape
    expect(await sendPauseHoldReason("declined_recovery", "automated", { fresh: true })).toBe("send_pause:declined_recovery");
  });
});

describe("sendPauseHoldReason · what a chokepoint records", () => {
  it("live -> null (send)", async () => {
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("declined_recovery")).toBeNull();
  });

  it("paused -> send_pause:<lane>", async () => {
    flagRows = { send_pause_declined_recovery: 1 };
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("declined_recovery")).toBe("send_pause:declined_recovery");
  });

  it("unreadable, unattended -> send_pause_unreadable:<lane>", async () => {
    dbMode = "throw";
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("missed_call_recovery")).toBe("send_pause_unreadable:missed_call_recovery");
  });

  it("unreadable, 1:1 -> null (send)", async () => {
    dbMode = "throw";
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("customer_confirmations")).toBeNull();
  });
});

describe("envArmed · exactly the comparison the lane's code makes", () => {
  it("ENABLE_CUSTOMER_CONFIRMATIONS needs exactly 'true'", async () => {
    const { envArmed } = await import("./services/sendPause");
    expect(envArmed("customer_confirmations", { ENABLE_CUSTOMER_CONFIRMATIONS: "true" })).toBe(true);
    expect(envArmed("customer_confirmations", { ENABLE_CUSTOMER_CONFIRMATIONS: "1" })).toBe(false);
    expect(envArmed("customer_confirmations", {})).toBe(false);
  });

  it("the '1' lanes need exactly '1'", async () => {
    const { envArmed } = await import("./services/sendPause");
    for (const [lane, flag] of [
      ["declined_recovery", "FEATURE_DECLINED_RECOVERY"],
      ["weather_sms", "WEATHER_SMS_SEND"],
      ["missed_call_recovery", "MISSED_CALL_RECOVERY_SEND"],
    ] as const) {
      expect(envArmed(lane, { [flag]: "1" })).toBe(true);
      expect(envArmed(lane, { [flag]: "true" })).toBe(false);
    }
  });

  it("voice_outbound is armed when any of its three call lanes is '1'", async () => {
    const { envArmed } = await import("./services/sendPause");
    expect(envArmed("voice_outbound", {})).toBe(false);
    expect(envArmed("voice_outbound", { FEATURE_VOICE_RECOVERY: "true" })).toBe(false);
    for (const flag of ["FEATURE_VOICE_RECOVERY", "FEATURE_CONFIRMATION_CALLS", "FEATURE_FOLLOWUP_CADENCE"]) {
      expect(envArmed("voice_outbound", { [flag]: "1" })).toBe(true);
    }
  });
});

describe("readSendSwitchesStatus · contract sendSwitchesStatus v1", () => {
  it("unreadable switch -> paused null, readable false (UNKNOWN, never false)", async () => {
    dbMode = "throw";
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({});
    expect(s.lanes).toHaveLength(5);
    for (const l of s.lanes) {
      expect(l.paused).toBeNull();
      expect(l.readable).toBe(false);
    }
  });

  it("readable rows -> real booleans, fail class and envArmed per lane", async () => {
    flagRows = { send_pause_voice_outbound: 1 };
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({ FEATURE_VOICE_RECOVERY: "1", ENABLE_CUSTOMER_CONFIRMATIONS: "1" }, async () => new Map());
    const by = Object.fromEntries(s.lanes.map((l) => [l.lane, l]));
    expect(by.voice_outbound).toEqual({ lane: "voice_outbound", paused: true, readable: true, failClass: "closed", envArmed: true, heldQueued: 0 });
    expect(by.customer_confirmations).toEqual({
      lane: "customer_confirmations", paused: false, readable: true, failClass: "open", envArmed: false, heldQueued: 0,
    });
    expect(by.weather_sms.paused).toBe(false);
  });
});

describe("readSendSwitchesStatus · v1.1 heldQueued", () => {
  it("counts queued texts per lane (they go out on resume); a lane with none reads 0", async () => {
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, async () => new Map([["customer_confirmations", 2], ["weather_sms", 1]]));
    const by = Object.fromEntries(s.lanes.map((l) => [l.lane, l.heldQueued]));
    expect(by).toEqual({ voice_outbound: 0, customer_confirmations: 2, declined_recovery: 0, weather_sms: 1, missed_call_recovery: 0 });
  });

  it("an unreadable queue -> heldQueued null on every lane (UNKNOWN, never 0)", async () => {
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, async () => null);
    for (const l of s.lanes) expect(l.heldQueued).toBeNull();
  });
});

describe("readSendSwitchesStatus · v1.2 effectivePaused (the shop-wide SMS pause, sms_global_pause)", () => {
  const noQueue = async () => new Map();
  const SMS_LANES = ["declined_recovery", "weather_sms", "missed_call_recovery"] as const;
  const globalOn = async () => ({ paused: true, readable: true });
  const globalOff = async () => ({ paused: false, readable: true });
  const globalUnreadable = async () => ({ paused: false, readable: false });

  it("global pause ON, every lane switch OFF -> the three text lanes are held, and their own paused stays false", async () => {
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue, globalOn);
    const by = Object.fromEntries(s.lanes.map((l) => [l.lane, l]));
    for (const lane of SMS_LANES) {
      expect(by[lane].effectivePaused, lane).toBe(true);
      expect(by[lane].paused, `${lane}: the toggle still follows its own switch`).toBe(false);
    }
  });

  it("CONTROL: calls and order confirmations are not held by the text pause (sendSms exempts confirmations), so they carry no effectivePaused", async () => {
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue, globalOn);
    const by = Object.fromEntries(s.lanes.map((l) => [l.lane, l]));
    expect(by.voice_outbound).not.toHaveProperty("effectivePaused");
    expect(by.customer_confirmations).not.toHaveProperty("effectivePaused");
  });

  it("CONTROL: global pause OFF -> effectivePaused false (a measured not-held), own pause ON still true", async () => {
    flagRows = { send_pause_weather_sms: 1 };
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue, globalOff);
    const by = Object.fromEntries(s.lanes.map((l) => [l.lane, l.effectivePaused]));
    expect(by.declined_recovery).toBe(false);
    expect(by.missed_call_recovery).toBe(false);
    expect(by.weather_sms).toBe(true);
  });

  it("global switch unreadable and nothing else holds -> null (UNKNOWN, never false); the other switch ON still wins", async () => {
    flagRows = { send_pause_weather_sms: 1 };
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue, globalUnreadable);
    const by = Object.fromEntries(s.lanes.map((l) => [l.lane, l.effectivePaused]));
    expect(by.declined_recovery).toBeNull();
    expect(by.weather_sms).toBe(true);
  });

  it("the lane's own switch unreadable + global ON -> held (true), not unknown", async () => {
    dbMode = "throw";
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue, globalOn);
    for (const l of s.lanes.filter((x) => (SMS_LANES as readonly string[]).includes(x.lane))) {
      expect(l.paused).toBeNull();
      expect(l.effectivePaused, l.lane).toBe(true);
    }
  });

  it("a global read that throws is UNKNOWN, not a crash of the whole card", async () => {
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue, async () => { throw new Error("boom"); });
    expect(s.lanes.find((l) => l.lane === "declined_recovery")?.effectivePaused).toBeNull();
  });

  it("default reader: the real getSmsPauseState over the fake table (sms_global_pause row) reaches the lanes", async () => {
    flagRows = { sms_global_pause: 1 };
    const { _resetPauseCacheForTest } = await import("./services/smsControl");
    _resetPauseCacheForTest();
    const { readSendSwitchesStatus } = await import("./services/sendPause");
    const s = await readSendSwitchesStatus({}, noQueue);
    expect(s.lanes.find((l) => l.lane === "weather_sms")?.effectivePaused).toBe(true);
    _resetPauseCacheForTest();
  });
});

describe("actor · an operator at the manual door (C5.5 follow-up)", () => {
  it("operator + unreadable switch -> SEND (fail open: a person is present)", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("voice_outbound", { paused: false, readable: false }, "operator")).toBe(false);
  });

  it("CONTROL: operator + explicit pause -> still HOLD", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("voice_outbound", { paused: true, readable: true }, "operator")).toBe(true);
  });

  it("CONTROL: default actor is automated -> unreadable still HOLDS", async () => {
    const { shouldHold } = await import("./services/sendPause");
    expect(shouldHold("voice_outbound", { paused: false, readable: false })).toBe(true);
    expect(shouldHold("voice_outbound", { paused: false, readable: false }, "automated")).toBe(true);
  });

  it("sendPauseHoldReason(lane, operator) on an unreadable switch -> null and one warn naming the lane", async () => {
    dbMode = "throw";
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("voice_outbound", "operator")).toBeNull();
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain("voice_outbound");
    expect(warns[0].msg).toContain("operator");
  });

  it("CONTROL: sendPauseHoldReason(lane, operator) on a paused row -> send_pause:<lane>", async () => {
    flagRows = { send_pause_voice_outbound: 1 };
    const { sendPauseHoldReason } = await import("./services/sendPause");
    expect(await sendPauseHoldReason("voice_outbound", "operator")).toBe("send_pause:voice_outbound");
  });
});