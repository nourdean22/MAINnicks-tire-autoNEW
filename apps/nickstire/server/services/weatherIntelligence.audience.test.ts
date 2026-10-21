/**
 * Who a weather text can reach (2026-10-20). Three defects in sendWeatherSms, pinned here:
 *
 *   1. The 30-day cooldown was per TRIGGER (variantKey = weather_<id>), so one customer could get
 *      first_freeze, pothole_season and heavy_rain texts in the same month.
 *   2. The cooldown ran per row AFTER `.limit(10)`, and the query had no ORDER BY, so the same ~10 rows came
 *      back on every run; once they were cooled down nobody else was ever texted.
 *   3. Targets were not ordered. Most recently lapsed first is the likeliest to come back.
 *
 * A stub of the drizzle chain hands back whatever the test chose and can never see any of this, so the test drives
 * the REAL drizzle MySQL builder and schema over a fake mysql2 client that records the SQL and params it is sent
 * (customerIntelligenceGroupBy.test.ts precedent). Nothing sends: sendSms is a mock and WEATHER_SMS_SEND is set
 * and deleted around each test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This file needs the REAL drizzle builder and schema; another file's mock must not leak in (AGENTS.md section 3).
vi.unmock("drizzle-orm/mysql2");
vi.unmock("drizzle-orm");
vi.unmock("../../drizzle/schema");

import { drizzle } from "drizzle-orm/mysql2";

type Sent = { sql: string; params: unknown[] };

const h = vi.hoisted(() => ({
  sent: [] as Array<{ sql: string; params: unknown[] }>,
  /** Rows the audience query returns, positional (id, firstName, phone) like mysql2 rowsAsArray. */
  targets: [] as unknown[][],
  /** Phone suffixes (last 10 digits) the per-row cooldown guard reports as already texted. */
  guardHits: new Set<string>(),
}));

const { sendSms, logOutboundSms, sendPauseHoldReason, isEnabled, alertSystem } = vi.hoisted(() => ({
  sendSms: vi.fn(),
  logOutboundSms: vi.fn(async () => undefined),
  sendPauseHoldReason: vi.fn(async (..._a: unknown[]): Promise<string | null> => null),
  isEnabled: vi.fn(async (_key: string) => true),
  alertSystem: vi.fn((_t: string, _d: string) => Promise.resolve(true)),
}));

const fakeClient = {
  query: async (q: { sql: string }, params: unknown[]) => {
    h.sent.push({ sql: q.sql, params });
    if (/from `customers`/i.test(q.sql)) return [h.targets, []]; // the audience query
    if (/from `sms_messages`/i.test(q.sql)) {
      // the per-row guard: first param is `%<last 10 digits>`
      const suffix = String(params[0] ?? "").replace(/\D/g, "");
      return [h.guardHits.has(suffix) ? [[7]] : [], []];
    }
    return [[], []];
  },
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("../db", () => ({ getDb: async () => realDrizzle }));
vi.mock("./sendPause", () => ({ sendPauseHoldReason }));
vi.mock("./telegram", () => ({ alertSystem }));
vi.mock("./featureFlags", () => ({ isEnabled }));
vi.mock("../sms", () => ({ sendSms, withOptOut: (s: string) => s }));
vi.mock("./smsInstrumentation", () => ({ logOutboundSms }));

import { editForecast, nwsFixtures, stubNwsFetch } from "../__tests__/nwsWeatherFixtures";
import { __resetNwsCacheForTests } from "../lib/nwsWeather";
import { __resetWeatherAlertMemoryForTests, checkWeatherTriggers } from "./weatherIntelligence";

const OCT_NOW = new Date("2026-10-21T15:30:00Z"); // the recorded forecast shifted +28 days
const TONIGHT = 1;
const DAY = 86_400_000;
/** What drizzle sends mysql2 for `createdAt >= <30 days ago>` at OCT_NOW. */
const COOLDOWN_START = "2026-09-21 15:30:00.000";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Text between the parentheses opened by `opener` (a regex ending in "("), parentheses balanced. */
function insideParens(text: string, opener: RegExp): string | null {
  const m = opener.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
  }
  return depth === 0 ? text.slice(start, i - 1) : null;
}

/**
 * Everything the audience query must be, as a list of problems; [] = correct. Pure, so the controls below can feed
 * it a broken copy and watch it fail. The query: lapsed, texted by NO weather trigger in 30 days (decided IN the
 * query, before the limit), most recently lapsed first, capped at 10.
 */
function audienceProblems({ sql, params }: Sent): string[] {
  const out: string[] = [];
  const text = norm(sql);
  const sub = insideParens(text, /not exists \(/i);
  if (sub === null) {
    out.push("no NOT EXISTS cooldown in the audience query (the cooldown runs after the limit)");
  } else {
    if (!/`sms_messages`\.`variantKey` like \?/i.test(sub)) out.push("cooldown does not LIKE-match the variantKey (it is per trigger)");
    if (/`variantKey` = \?/i.test(sub)) out.push("cooldown compares variantKey for equality (it is per trigger)");
    if (!/`sms_messages`\.`direction` = \?/i.test(sub)) out.push("cooldown ignores direction");
    if (!/`sms_messages`\.`createdAt` >= \?/i.test(sub)) out.push("cooldown has no 30-day window");
    if (!/like CONCAT\('%', RIGHT\(REGEXP_REPLACE\(`customers`\.`phone`, '\[\^0-9\]', ''\), 10\)\)/i.test(sub)) {
      out.push("cooldown is not correlated to the customer's last 10 phone digits");
    }
  }
  const notExistsAt = text.search(/not exists \(/i);
  const orderAt = text.search(/order by `customers`\.`lastVisitDate` desc/i);
  const limitAt = text.search(/ limit \?/i);
  if (orderAt < 0) out.push("no ORDER BY lastVisitDate DESC (same rows every run)");
  if (limitAt < 0) out.push("no LIMIT");
  if (notExistsAt >= 0 && orderAt >= 0 && notExistsAt > orderAt) out.push("NOT EXISTS is not in the WHERE (it comes after ORDER BY)");
  if (orderAt >= 0 && limitAt >= 0 && orderAt > limitAt) out.push("ORDER BY comes after LIMIT");
  // A wider candidate pool than the 10-send cap: held-out controls leave no cooldown row and would otherwise fill the 10.
  if (params.at(-1) !== 50) out.push(`LIMIT is ${String(params.at(-1))}, not 50`);
  if (!params.includes("weather\\_%")) out.push("params carry no weather\\_% pattern");
  if (!params.includes(COOLDOWN_START)) out.push(`params carry no 30-day cut-off (${COOLDOWN_START})`);
  if (!params.includes("outbound")) out.push("params carry no outbound direction");
  if (/weather_(first_freeze|heavy_rain|pothole_season|extreme_heat|salt_season_end)/.test(JSON.stringify(params))) {
    out.push("params carry a trigger-specific weather_<id> key");
  }
  for (const needle of ["`smsOptOut` = ?", "`phone` is not null", "`lastVisitDate` is not null", "DATEDIFF(CURDATE(),"]) {
    if (!text.includes(needle)) out.push(`lost the base filter ${needle}`);
  }
  return out;
}

/** Hand-written shapes: the checker must pass the right one and name each defect of the wrong ones. */
const GOOD_SQL =
  "select `id`, `firstName`, `phone` from `customers` where (`customers`.`lastVisitDate` is not null and `customers`.`smsOptOut` = ? " +
  "and `customers`.`phone` is not null and DATEDIFF(CURDATE(), `customers`.`lastVisitDate`) >= 60 " +
  "and not exists (select 1 from `sms_messages` inner join `sms_conversations` on `sms_messages`.`conversationId` = `sms_conversations`.`id` " +
  "where (`sms_conversations`.`phone` like CONCAT('%', RIGHT(REGEXP_REPLACE(`customers`.`phone`, '[^0-9]', ''), 10)) " +
  "and `sms_messages`.`direction` = ? and `sms_messages`.`createdAt` >= ? and `sms_messages`.`variantKey` like ?))) " +
  "order by `customers`.`lastVisitDate` desc limit ?";
const GOOD_PARAMS = [0, "outbound", COOLDOWN_START, "weather\\_%", 50];

describe("the checker itself: it passes the right query and names every planted defect", () => {
  it("CONTROL: the right shape has no problems", () => {
    expect(audienceProblems({ sql: GOOD_SQL, params: GOOD_PARAMS })).toEqual([]);
  });

  it("no NOT EXISTS (the cooldown after the limit) and no ORDER BY are both named", () => {
    const sql = GOOD_SQL.replace(/ and not exists \(.*?\)\)\) order by `customers`\.`lastVisitDate` desc/, ")");
    expect(sql).not.toBe(GOOD_SQL); // the plant took
    const p = audienceProblems({ sql, params: GOOD_PARAMS });
    expect(p).toContain("no NOT EXISTS cooldown in the audience query (the cooldown runs after the limit)");
    expect(p).toContain("no ORDER BY lastVisitDate DESC (same rows every run)");
  });

  it("a per-trigger variantKey equality is named", () => {
    const sql = GOOD_SQL.replace("`sms_messages`.`variantKey` like ?", "`sms_messages`.`variantKey` = ?");
    const p = audienceProblems({ sql, params: [0, "outbound", COOLDOWN_START, "weather_heavy_rain", 10] });
    expect(p).toContain("cooldown does not LIKE-match the variantKey (it is per trigger)");
    expect(p).toContain("cooldown compares variantKey for equality (it is per trigger)");
    expect(p).toContain("params carry a trigger-specific weather_<id> key");
  });

  it("a moved window, a moved limit and ORDER BY after LIMIT are named", () => {
    const p = audienceProblems({ sql: GOOD_SQL, params: [0, "outbound", "2026-09-22 15:30:00.000", "weather\\_%", 11] });
    expect(audienceProblems({ sql: GOOD_SQL, params: [0, "outbound", COOLDOWN_START, "weather\\_%", 10] })).toContain("LIMIT is 10, not 50");
    expect(p).toContain(`params carry no 30-day cut-off (${COOLDOWN_START})`);
    expect(p).toContain("LIMIT is 11, not 50");
    const swapped = GOOD_SQL.replace("order by `customers`.`lastVisitDate` desc limit ?", "limit ? order by `customers`.`lastVisitDate` desc");
    expect(audienceProblems({ sql: swapped, params: GOOD_PARAMS })).toContain("ORDER BY comes after LIMIT");
  });
});

const rainAndFreezeTonight = () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(OCT_NOW);
  const forecast = editForecast(nwsFixtures.forecast(), 28, { [TONIGHT]: 30 });
  forecast.properties.periods[TONIGHT] = {
    ...forecast.properties.periods[TONIGHT],
    shortForecast: "Showers And Thunderstorms",
    probabilityOfPrecipitation: { value: 90 },
  };
  return stubNwsFetch({ forecast });
};

const audienceQueries = () => h.sent.filter((s) => /from `customers`/i.test(s.sql));
const guardQueries = () => h.sent.filter((s) => !/from `customers`/i.test(s.sql) && /from `sms_messages`/i.test(s.sql));

beforeEach(() => {
  __resetNwsCacheForTests();
  __resetWeatherAlertMemoryForTests();
  h.sent.length = 0;
  h.targets = [];
  h.guardHits.clear();
  sendSms.mockReset();
  sendSms.mockResolvedValue({ success: true, sid: "SM1" });
  logOutboundSms.mockClear();
  sendPauseHoldReason.mockReset();
  sendPauseHoldReason.mockResolvedValue(null);
  isEnabled.mockClear();
  alertSystem.mockClear();
});
afterEach(() => {
  delete process.env.WEATHER_SMS_SEND;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sendWeatherSms · who the audience query reaches (real drizzle SQL)", () => {
  it("freezing rain tonight runs BOTH triggers, and each audience query is the same correct one", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [[1, "Pat", "2165550141"]];

    const r = await checkWeatherTriggers();

    expect(r.triggered).toEqual(expect.arrayContaining(["first_freeze", "heavy_rain"]));
    const q = audienceQueries();
    expect(q).toHaveLength(2); // one audience query per imminent trigger
    for (const one of q) expect(audienceProblems(one), norm(one.sql)).toEqual([]);
    // The cooldown does not know which trigger is running: the two queries are interchangeable.
    expect(q[1].sql).toBe(q[0].sql);
    expect(q[1].params).toEqual(q[0].params);
  });

  it("the audience query is bound by exactly the same 30-day cut-off the per-row guard uses", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [[1, "Pat", "2165550141"]];
    await checkWeatherTriggers();
    for (const g of guardQueries()) expect(g.params, norm(g.sql)).toContain(COOLDOWN_START);
    expect(guardQueries().length).toBeGreaterThan(0);
  });

  it("the per-row guard (a second line of defence) also spans every weather_ trigger", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [[1, "Pat", "2165550141"]];
    await checkWeatherTriggers();
    const guards = guardQueries();
    expect(guards.length).toBeGreaterThan(0);
    for (const g of guards) {
      expect(norm(g.sql)).toMatch(/`sms_messages`\.`variantKey` like \?/i);
      expect(g.params).toContain("weather\\_%");
      expect(JSON.stringify(g.params)).not.toMatch(/weather_(first_freeze|heavy_rain)/);
    }
  });

  it("texts keep their per-trigger variantKey (analytics and the holdout lane key off it), in database order", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [
      [1, "Pat", "2165550141"],
      [2, "Sam", "2165550142"],
    ];
    await checkWeatherTriggers();
    const keys = sendSms.mock.calls.map((c) => [c[0], (c[2] as { variantKey: string }).variantKey]);
    expect(keys).toEqual([
      ["2165550141", "weather_first_freeze"],
      ["2165550142", "weather_first_freeze"],
      ["2165550141", "weather_heavy_rain"],
      ["2165550142", "weather_heavy_rain"],
    ]);
  });

  it("CONTROL: with no guard hit every returned target is texted; a guard hit skips only that customer", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [
      [1, "Pat", "2165550141"],
      [2, "Sam", "2165550142"],
      [3, "Lee", "2165550143"],
    ];
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(6); // 3 customers x 2 triggers

    sendSms.mockClear();
    h.guardHits.add("2165550142");
    await checkWeatherTriggers();
    const to = sendSms.mock.calls.map((c) => c[0]);
    expect(to).not.toContain("2165550142");
    expect(to.filter((p) => p === "2165550141")).toHaveLength(2);
  });

  it("stays shadow: with WEATHER_SMS_SEND unset the audience query is never built and nothing is sent", async () => {
    rainAndFreezeTonight();
    h.targets = [[1, "Pat", "2165550141"]];
    await checkWeatherTriggers();
    expect(h.sent).toHaveLength(0);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

/**
 * The 10-text cap counts REAL attempts, not candidates (2026-10-21). A held-out control (contact_holdout_weather,
 * 15% per trigger) leaves no sms_messages row, so it never cools down and stays at the head of the order; counted
 * toward a LIMIT 10 it would crowd real customers out of every run. The query now reads a pool of 50 and the loop
 * stops after 10 sendSms calls whose result is not heldOut.
 */
describe("sendWeatherSms · the cap counts real send attempts, held-out controls do not", () => {
  /** One trigger only (a freeze tonight), so every count below is per trigger. */
  const freezeOnly = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_NOW);
    stubNwsFetch({ forecast: editForecast(nwsFixtures.forecast(), 28, { [TONIGHT]: 30 }) });
    process.env.WEATHER_SMS_SEND = "1";
  };
  /** n candidates, numbered 1..n; the phone ends in the zero-padded number. */
  const candidates = (n: number) => Array.from({ length: n }, (_, i) => [i + 1, `C${i + 1}`, `21655501${String(i + 1).padStart(2, "0")}`]);
  const number = (phone: unknown) => Number(String(phone).slice(-2));
  const heldOutUpTo = (k: number) =>
    sendSms.mockImplementation(async (phone: string) => (number(phone) <= k ? { success: true, heldOut: true } : { success: true, sid: "SM1" }));
  const attemptedNumbers = () => sendSms.mock.calls.map((c) => number(c[0]));

  it("15 candidates, the first 5 held out: all 15 are tried and exactly 10 are real attempts", async () => {
    freezeOnly();
    h.targets = candidates(15);
    heldOutUpTo(5);
    await checkWeatherTriggers();
    expect(attemptedNumbers()).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(logOutboundSms).toHaveBeenCalledTimes(10); // logged only for a real, non-held-out send
  });

  it("20 candidates, the first 5 held out: the loop stops after the 10th real attempt (candidates 16-20 are never tried)", async () => {
    freezeOnly();
    h.targets = candidates(20);
    heldOutUpTo(5);
    await checkWeatherTriggers();
    expect(attemptedNumbers()).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(logOutboundSms).toHaveBeenCalledTimes(10);
  });

  it("held-out controls AFTER the 10th real attempt are never reached", async () => {
    freezeOnly();
    h.targets = candidates(15);
    sendSms.mockImplementation(async (phone: string) => (number(phone) > 10 ? { success: true, heldOut: true } : { success: true, sid: "SM1" }));
    await checkWeatherTriggers();
    expect(attemptedNumbers()).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it.each([
    [9, 9],
    [10, 10],
    [11, 10],
  ])("cap boundary: %i real candidates -> %i attempts", async (n, expected) => {
    freezeOnly();
    h.targets = candidates(n);
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(expected);
  });

  it("a send that throws still counts as an attempt (the cap holds when the gateway is failing)", async () => {
    freezeOnly();
    h.targets = candidates(12);
    sendSms.mockRejectedValue(new Error("gateway down"));
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(10);
  });

  it("a customer skipped by the per-row cooldown guard is not an attempt", async () => {
    freezeOnly();
    h.targets = candidates(14);
    for (const n of [1, 2, 3]) h.guardHits.add(`21655501${String(n).padStart(2, "0")}`);
    await checkWeatherTriggers();
    expect(attemptedNumbers()).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // 3 skipped, then 10 attempts, 14 never tried
  });
});
