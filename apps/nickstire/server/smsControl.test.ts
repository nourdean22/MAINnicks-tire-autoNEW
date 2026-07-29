/**
 * smsControl — pause state, global cap, phone-level takeover lookup.
 *
 * The load-bearing claims pinned here:
 *   1. Pause polarity: missing row / value 0 = NOT paused (readable). An
 *      unreadable switch reports readable:false — it never guesses.
 *   2. Global cap fails OPEN but visibly (readable:false).
 *   3. isPhoneHumanHeld fails OPEN (documented humanTakeover policy).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type DbMode = "throw" | "nodb" | "rows";
let dbMode: DbMode = "rows";
/** per-query rows keyed by a substring of the SQL text */
let flagRows: Array<Record<string, unknown>> = [];
let countRows: Array<Record<string, unknown>> = [{ n: 0 }];
let heldRows: Array<Record<string, unknown>> = [];

vi.mock("./db", () => ({
  getDb: async () => {
    if (dbMode === "throw") throw new Error("connection refused");
    if (dbMode === "nodb") return null;
    return {
      execute: async (q: unknown) => {
        const text = JSON.stringify(q);
        if (text.includes("feature_flags")) return [flagRows];
        if (text.includes("sms_messages")) return [countRows];
        if (text.includes("sms_conversations")) return [heldRows];
        return [[]];
      },
    };
  },
}));

beforeEach(() => {
  dbMode = "rows";
  flagRows = [];
  countRows = [{ n: 0 }];
  heldRows = [];
});

afterEach(async () => {
  const { _resetPauseCacheForTest } = await import("./services/smsControl");
  _resetPauseCacheForTest();
  delete process.env.SMS_GLOBAL_DAILY_CAP;
});

describe("getSmsPauseState", () => {
  it("missing flag row = not paused, readable", async () => {
    const { getSmsPauseState, _resetPauseCacheForTest } = await import("./services/smsControl");
    _resetPauseCacheForTest();
    const s = await getSmsPauseState();
    expect(s).toEqual({ paused: false, readable: true });
  });

  it("value=1 row = paused", async () => {
    flagRows = [{ v: 1 }];
    const { getSmsPauseState, _resetPauseCacheForTest } = await import("./services/smsControl");
    _resetPauseCacheForTest();
    const s = await getSmsPauseState();
    expect(s.paused).toBe(true);
    expect(s.readable).toBe(true);
  });

  it("unreadable DB = readable:false, never a guess of paused:true", async () => {
    dbMode = "throw";
    const { getSmsPauseState, _resetPauseCacheForTest } = await import("./services/smsControl");
    _resetPauseCacheForTest();
    const s = await getSmsPauseState();
    expect(s.readable).toBe(false);
    expect(s.paused).toBe(false);
  });

  it("caches for a short window (flip is visible after reset)", async () => {
    const { getSmsPauseState, _resetPauseCacheForTest } = await import("./services/smsControl");
    _resetPauseCacheForTest();
    expect((await getSmsPauseState()).paused).toBe(false);
    flagRows = [{ v: 1 }];
    // cached read — still false
    expect((await getSmsPauseState()).paused).toBe(false);
    _resetPauseCacheForTest();
    expect((await getSmsPauseState()).paused).toBe(true);
  });
});

describe("checkGlobalDailyCap", () => {
  it("under cap → allowed with real count", async () => {
    countRows = [{ n: 42 }];
    const { checkGlobalDailyCap } = await import("./services/smsControl");
    const r = await checkGlobalDailyCap();
    expect(r).toMatchObject({ allowed: true, count: 42, readable: true });
  });

  it("at/over cap → refused", async () => {
    process.env.SMS_GLOBAL_DAILY_CAP = "50";
    try {
      countRows = [{ n: 50 }];
      const { checkGlobalDailyCap } = await import("./services/smsControl");
      const r = await checkGlobalDailyCap();
      expect(r.allowed).toBe(false);
      expect(r.cap).toBe(50);
    } finally {
      delete process.env.SMS_GLOBAL_DAILY_CAP;
    }
  });

  it("unreadable DB → fail-open but visibly (readable:false)", async () => {
    dbMode = "throw";
    const { checkGlobalDailyCap } = await import("./services/smsControl");
    const r = await checkGlobalDailyCap();
    expect(r.allowed).toBe(true);
    expect(r.readable).toBe(false);
  });
});

describe("isPhoneHumanHeld", () => {
  it("no held row → false", async () => {
    const { isPhoneHumanHeld } = await import("./services/smsControl");
    expect(await isPhoneHumanHeld("+12165550101")).toBe(false);
  });

  it("held row present → true", async () => {
    heldRows = [{ held: 1 }];
    const { isPhoneHumanHeld } = await import("./services/smsControl");
    expect(await isPhoneHumanHeld("+12165550101")).toBe(true);
  });

  it("DB error → fail-open false (documented takeover policy)", async () => {
    dbMode = "throw";
    const { isPhoneHumanHeld } = await import("./services/smsControl");
    expect(await isPhoneHumanHeld("+12165550101")).toBe(false);
  });
});
