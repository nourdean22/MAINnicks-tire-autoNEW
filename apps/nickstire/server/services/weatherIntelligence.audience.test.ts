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
  /** One entry per audience query, in order, when a test needs the two triggers to see different candidates. */
  targetsQueue: [] as unknown[][][],
  /** Weather rows already in sms_messages; the per-row guard evaluates its own rendered params against them. */
  messages: [] as Array<{ phone: string; status: string; variantKey: string; direction: string; createdAt: string }>,
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
    if (/from `customers`/i.test(q.sql)) return [h.targetsQueue.length ? h.targetsQueue.shift()! : h.targets, []]; // the audience query
    if (/from `sms_messages`/i.test(q.sql)) {
      // the per-row guard, params in render order: `%<last 10 digits>`, direction, cut-off, variantKey pattern, [status to ignore], limit
      const suffix = String(params[0] ?? "").replace(/\D/g, "");
      const [, direction, cutoff, pattern, ...rest] = params;
      const ignoredStatus = /`sms_messages`\.`status` <> \?/i.test(q.sql) ? rest[0] : null;
      const prefix = String(pattern).replace("\\_%", "_");
      const seen = h.messages.some(
        (m) =>
          m.phone.endsWith(suffix) &&
          m.direction === direction &&
          m.createdAt >= String(cutoff) &&
          m.variantKey.startsWith(prefix) &&
          m.status !== ignoredStatus,
      );
      return [h.guardHits.has(suffix) || seen ? [[7]] : [], []];
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
    if (!/`sms_messages`\.`status` <> \?/i.test(sub)) out.push("cooldown counts failed rows (a definitive refusal would block every trigger for 30 days)");
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
  if (!params.includes("failed")) out.push("params carry no failed status to ignore");
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
  "and `sms_messages`.`direction` = ? and `sms_messages`.`createdAt` >= ? and `sms_messages`.`variantKey` like ? and `sms_messages`.`status` <> ?))) " +
  "order by `customers`.`lastVisitDate` desc limit ?";
const GOOD_PARAMS = [0, "outbound", COOLDOWN_START, "weather\\_%", "failed", 50];

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
    const p = audienceProblems({ sql, params: [0, "outbound", COOLDOWN_START, "weather_heavy_rain", "failed", 50] });
    expect(p).toContain("cooldown does not LIKE-match the variantKey (it is per trigger)");
    expect(p).toContain("cooldown compares variantKey for equality (it is per trigger)");
    expect(p).toContain("params carry a trigger-specific weather_<id> key");
  });

  it("a cooldown that counts failed rows is named", () => {
    const sql = GOOD_SQL.replace(" and `sms_messages`.`status` <> ?", "");
    expect(sql).not.toBe(GOOD_SQL);
    const p = audienceProblems({ sql, params: [0, "outbound", COOLDOWN_START, "weather\\_%", 50] });
    expect(p).toContain("cooldown counts failed rows (a definitive refusal would block every trigger for 30 days)");
    expect(p).toContain("params carry no failed status to ignore");
  });

  it("a moved window, a moved limit and ORDER BY after LIMIT are named", () => {
    const p = audienceProblems({ sql: GOOD_SQL, params: [0, "outbound", "2026-09-22 15:30:00.000", "weather\\_%", "failed", 11] });
    expect(audienceProblems({ sql: GOOD_SQL, params: [0, "outbound", COOLDOWN_START, "weather\\_%", "failed", 10] })).toContain("LIMIT is 10, not 50");
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
  h.targetsQueue.length = 0;
  h.messages.length = 0;
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
    // The second trigger's query sees 02 again (a queued text is not yet a row the query can see) plus a new customer.
    h.targetsQueue = [
      [
        [1, "Pat", "2165550141"],
        [2, "Sam", "2165550142"],
      ],
      [
        [2, "Sam", "2165550142"],
        [3, "Lee", "2165550143"],
      ],
    ];
    await checkWeatherTriggers();
    const keys = sendSms.mock.calls.map((c) => [c[0], (c[2] as { variantKey: string }).variantKey]);
    expect(keys).toEqual([
      ["2165550141", "weather_first_freeze"],
      ["2165550142", "weather_first_freeze"],
      ["2165550143", "weather_heavy_rain"],
    ]);
  });

  it("CONTROL: with no guard hit every returned target is texted once; a guard hit skips that customer for every trigger", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [
      [1, "Pat", "2165550141"],
      [2, "Sam", "2165550142"],
      [3, "Lee", "2165550143"],
    ];
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(3); // 3 customers, once each across both triggers

    sendSms.mockClear();
    h.guardHits.add("2165550142");
    await checkWeatherTriggers();
    const to = sendSms.mock.calls.map((c) => c[0]);
    expect(to).toEqual(["2165550141", "2165550143"]);
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

const phoneOf = (n: number) => `21655501${String(n).padStart(2, "0")}`;
const row = (n: number, phone = phoneOf(n)) => [n, `C${n}`, phone];
const lastTwo = (phone: unknown) => Number(String(phone).replace(/\D/g, "").slice(-2));

/**
 * One customer is texted at most once per RUN, whatever the trigger (2026-10-21, Codex P2). A queued send persists its
 * sms_messages row in an unawaited step and the caller skips logOutboundSms for it, so the second trigger's audience
 * query can still return a customer the first trigger already texted. checkWeatherTriggers keeps one set of normalized
 * phones for the whole run.
 */
describe("checkWeatherTriggers · no customer is attempted twice in one run", () => {
  const phonesAttempted = () => sendSms.mock.calls.map((c) => String(c[0]).replace(/\D/g, "").slice(-10));

  it("two imminent triggers with overlapping candidates: no phone is attempted twice", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targetsQueue = [[row(1), row(2), row(3)], [row(2), row(3), row(4)]];
    await checkWeatherTriggers();
    const phones = phonesAttempted();
    expect(phones).toEqual([phoneOf(1), phoneOf(2), phoneOf(3), phoneOf(4)]);
    expect(new Set(phones).size).toBe(phones.length);
  });

  it("the same customer in a different phone format is still the same customer", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targetsQueue = [[row(1)], [row(1, "(216) 555-0101"), row(2, "+1 216-555-0102")]];
    await checkWeatherTriggers();
    expect(phonesAttempted()).toEqual([phoneOf(1), phoneOf(2)]);
  });

  it("a skipped duplicate is not a real attempt: it does not eat the second trigger's cap of 10", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    const first = Array.from({ length: 10 }, (_, i) => row(i + 1));
    h.targetsQueue = [first, [...first, row(11), row(12), row(13)]];
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(13); // 10 by the first trigger, then only the 3 new ones
  });

  it("a held-out control was never contacted, so a later trigger may text that customer", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targetsQueue = [[row(1), row(2)], [row(1), row(2)]];
    sendSms.mockImplementation(async (phone: string, _m: string, o: { variantKey: string }) =>
      o.variantKey === "weather_first_freeze" && lastTwo(phone) === 1 ? { success: true, heldOut: true } : { success: true, sid: "SM1" },
    );
    await checkWeatherTriggers();
    expect(sendSms.mock.calls.map((c) => [lastTwo(c[0]), (c[2] as { variantKey: string }).variantKey])).toEqual([
      [1, "weather_first_freeze"], // held out
      [2, "weather_first_freeze"],
      [1, "weather_heavy_rain"], // not contacted by the first trigger, so the second may
    ]);
  });

  it("a send that threw was still an attempt: the next trigger does not retry that customer", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targetsQueue = [[row(1)], [row(1), row(2)]];
    sendSms.mockImplementation(async (phone: string) => {
      if (lastTwo(phone) === 1) throw new Error("gateway down");
      return { success: true, sid: "SM1" };
    });
    await checkWeatherTriggers();
    expect(sendSms.mock.calls.map((c) => lastTwo(c[0]))).toEqual([1, 2]);
  });

  it("the set belongs to ONE run: the next run starts empty", async () => {
    rainAndFreezeTonight();
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [row(1)];
    await checkWeatherTriggers();
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(2); // once per run (the cooldown rows, not this set, carry it across runs)
  });
});

/**
 * A definitive refusal is logged as a `failed` row (cap reached, consent unverifiable, takeover). It means no text was
 * delivered, so it must not start a 30-day weather cooldown. sms_messages.status holds queued | sent | delivered |
 * failed | received | sending; "uncertain" is stored as `sending`. Every status except failed still cools the customer
 * down, so a status this code has never heard of fails toward NOT texting.
 */
describe("sendWeatherSms · a failed row does not cool a customer down (per-row guard evaluated on its rendered params)", () => {
  const freezeOnlyTonight = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_NOW);
    stubNwsFetch({ forecast: editForecast(nwsFixtures.forecast(), 28, { [TONIGHT]: 30 }) });
    process.env.WEATHER_SMS_SEND = "1";
    h.targets = [row(1)];
  };
  const weatherRow = (status: string, over: Partial<(typeof h.messages)[number]> = {}) => ({
    phone: phoneOf(1),
    status,
    variantKey: "weather_first_freeze",
    direction: "outbound",
    createdAt: "2026-10-01 00:00:00.000",
    ...over,
  });

  it("CONTROL: with no weather row in the window the customer is texted", async () => {
    freezeOnlyTonight();
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("a failed weather row in the window does not cool the customer down", async () => {
    freezeOnlyTonight();
    h.messages.push(weatherRow("failed"));
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it.each(["sent", "delivered", "queued", "sending", "received", "some_future_status"])(
    "a %s weather row in the window cools the customer down",
    async (status) => {
      freezeOnlyTonight();
      h.messages.push(weatherRow(status));
      await checkWeatherTriggers();
      expect(sendSms).not.toHaveBeenCalled();
    },
  );

  it("a failed row does not hide a real one: failed + sent in the window still cools down", async () => {
    freezeOnlyTonight();
    h.messages.push(weatherRow("failed"), weatherRow("sent", { variantKey: "weather_pothole_season" }));
    await checkWeatherTriggers();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("CONTROL: the evaluator is live, a sent row OUTSIDE the window or of another lane does not cool down", async () => {
    freezeOnlyTonight();
    h.messages.push(weatherRow("sent", { createdAt: "2026-09-01 00:00:00.000" }), weatherRow("sent", { variantKey: "winback" }));
    await checkWeatherTriggers();
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});
