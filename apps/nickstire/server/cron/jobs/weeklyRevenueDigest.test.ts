/**
 * Weekly Revenue Digest — mechanism tests.
 *
 * What is asserted (not merely exercised):
 *   · cents→dollars happens exactly once (48253 cents = $482.53-class fixture)
 *   · the TiDB tuple shape [rows, fields] AND the flat-rows shape both parse
 *   · repeat/new/no-phone shares are computed from cents, not re-rounded dollars
 *   · a thrown query sends NOTHING (a zeros-digest on failure is a lie)
 *   · a schema error (ER_BAD_FIELD_ERROR) reports loudly as SCHEMA BUG
 *   · an empty week with working queries DOES send, with the import warning
 *   · the Monday gate is shop-timezone (ET), not server-UTC
 *   · HTML-unsafe service names are escaped before hitting parse_mode:HTML
 *
 * Serial-suite hygiene (AGENTS.md §3): every mock is restored in afterEach —
 * this file shares one process with the rest of the suite.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const execute = vi.fn();
const sendTelegram = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({ execute })),
}));
vi.mock("../../services/telegram", () => ({
  sendTelegram: (...args: unknown[]) => sendTelegram(...args),
}));

import {
  isShopMonday,
  computeWeeklyRevenueDigest,
  buildWeeklyRevenueDigestText,
  runWeeklyRevenueDigest,
  type WeeklyRevenueDigestData,
} from "./weeklyRevenueDigest";

// A Monday inside the current-week window. 2026-08-03 was a Monday;
// 16:00 UTC = 12:00 ET — unambiguously Monday in both zones.
const MONDAY_NOON_ET = new Date("2026-08-03T16:00:00Z");

/** rows for the 4 queries in call order: agg, repeat, top services, arrivals */
function queueHappyPath(opts?: { tuple?: boolean }) {
  const wrap = (rows: unknown[]) => (opts?.tuple === false ? rows : [rows, []]);
  execute
    .mockResolvedValueOnce(
      wrap([
        {
          curCents: 1248053, // $12,480.53
          curCount: 25,
          curPartsCents: 512000,
          curLaborCents: 689000,
          prevCents: 1155600,
          prevCount: 23,
        },
      ]),
    )
    .mockResolvedValueOnce(
      wrap([{ weekCents: 1248053, repeatCents: 387000, unknownCents: 87053 }]),
    )
    .mockResolvedValueOnce(
      wrap([
        { svc: "Brake pads <& rotors>", cents: 214000, cnt: 4 },
        { svc: "4x tires", cents: 180000, cnt: 3 },
      ]),
    )
    .mockResolvedValueOnce(wrap([{ cnt: 6, cents: 389000 }]));
}

afterEach(() => {
  execute.mockReset();
  sendTelegram.mockReset();
  vi.restoreAllMocks();
});

describe("isShopMonday — shop timezone, not server clock", () => {
  it("is true late Monday evening ET even when UTC has rolled to Tuesday", () => {
    // 2026-08-04T02:00Z = Monday 22:00 ET
    expect(isShopMonday(new Date("2026-08-04T02:00:00Z"))).toBe(true);
  });
  it("is false early Monday UTC while the shop is still on Sunday", () => {
    // 2026-08-03T03:00Z = Sunday 23:00 ET
    expect(isShopMonday(new Date("2026-08-03T03:00:00Z"))).toBe(false);
  });
});

describe("computeWeeklyRevenueDigest", () => {
  it("converts cents to dollars exactly once and computes shares from cents", async () => {
    queueHappyPath();
    const d = await computeWeeklyRevenueDigest(MONDAY_NOON_ET);

    expect(d.revenue).toBeCloseTo(12480.53, 2);
    expect(d.invoiceCount).toBe(25);
    expect(d.avgTicket).toBe(499); // round(12480.53 / 25)
    expect(d.parts).toBe(5120);
    expect(d.labor).toBe(6890);
    expect(d.marginPct).toBe(59); // (12480.53 - 5120) / 12480.53
    expect(d.prevRevenue).toBe(11556);
    expect(d.deltaPct).toBe(8); // (12480.53 - 11556) / 11556
    // shares straight from cents: 387000/1248053=31%, unknown 87053/1248053=7%
    expect(d.repeatPct).toBe(31);
    expect(d.unknownPct).toBe(7);
    expect(d.newPct).toBe(62);
    expect(d.arrivalsReconciled).toBe(6);
    expect(d.arrivalsRevenue).toBe(3890);
  });

  it("parses flat-rows results the same as TiDB tuple results", async () => {
    queueHappyPath({ tuple: false });
    const d = await computeWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(d.revenue).toBeCloseTo(12480.53, 2);
    expect(d.topServices).toHaveLength(2);
  });

  it("returns zeros (not NaN, no throw) for an empty week", async () => {
    execute
      .mockResolvedValueOnce([[{ curCents: null, curCount: null, curPartsCents: null, curLaborCents: null, prevCents: null, prevCount: null }], []])
      .mockResolvedValueOnce([[{ weekCents: 0, repeatCents: 0, unknownCents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0, cents: 0 }], []]);
    const d = await computeWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(d.revenue).toBe(0);
    expect(d.avgTicket).toBe(0);
    expect(d.marginPct).toBeNull();
    expect(d.deltaPct).toBeNull();
    expect(d.repeatPct).toBeNull();
    expect(Number.isNaN(d.avgTicket)).toBe(false);
  });
});

describe("buildWeeklyRevenueDigestText", () => {
  const base: WeeklyRevenueDigestData = {
    windowStart: new Date("2026-07-27T16:00:00Z"),
    windowEnd: MONDAY_NOON_ET,
    revenue: 12480.53,
    invoiceCount: 25,
    avgTicket: 499,
    parts: 5120,
    labor: 6890,
    marginPct: 59,
    prevRevenue: 11556,
    prevInvoiceCount: 23,
    deltaPct: 8,
    repeatPct: 31,
    newPct: 62,
    unknownPct: 7,
    topServices: [{ name: "Brake pads <& rotors>", revenue: 2140, count: 4 }],
    arrivalsReconciled: 6,
    arrivalsRevenue: 3890,
  };

  it("escapes HTML-unsafe service names (parse_mode: HTML)", () => {
    const text = buildWeeklyRevenueDigestText(base);
    expect(text).toContain("Brake pads &lt;&amp; rotors&gt;");
    expect(text).not.toContain("Brake pads <& rotors>");
  });

  it("carries the headline numbers and the arrivals receipt", () => {
    const text = buildWeeklyRevenueDigestText(base);
    expect(text).toContain("$12,481"); // rounded display of 12480.53
    expect(text).toContain("25 paid invoices");
    expect(text).toContain("▲ 8%");
    expect(text).toContain("<b>31%</b>");
    expect(text).toContain("arrivals → paid invoices: <b>6</b> ($3,890)");
  });

  it("flags a $0 week as a possible import break instead of staying silent", () => {
    const text = buildWeeklyRevenueDigestText({
      ...base,
      revenue: 0,
      invoiceCount: 0,
      avgTicket: 0,
      marginPct: null,
      deltaPct: null,
      repeatPct: null,
      newPct: null,
      unknownPct: null,
      topServices: [],
      arrivalsReconciled: 0,
      arrivalsRevenue: 0,
    });
    expect(text).toContain("check the ALG import");
  });
});

describe("runWeeklyRevenueDigest", () => {
  it("no-ops on non-Mondays without touching the database", async () => {
    const res = await runWeeklyRevenueDigest(new Date("2026-08-05T16:00:00Z")); // Wednesday
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toContain("not Monday");
    expect(execute).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("sends the digest on a Monday and reports receipts in details", async () => {
    queueHappyPath();
    sendTelegram.mockResolvedValue(true);
    const res = await runWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(res.recordsProcessed).toBe(1);
    expect(res.details).toContain("$12,481");
    expect(res.details).toContain("repeat 31%");
  });

  it("sends NOTHING when a query throws — a zeros digest would be a lie", async () => {
    execute.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    const res = await runWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toContain("digest failed");
  });

  it("reports a schema error loudly as SCHEMA BUG (#1125 distinction)", async () => {
    const err = Object.assign(new Error("Unknown column 'totalAmountz'"), {
      code: "ER_BAD_FIELD_ERROR",
    });
    execute.mockRejectedValueOnce(err);
    const res = await runWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(res.details).toContain("SCHEMA BUG");
  });

  it("reports a failed Telegram send as a failure, not success", async () => {
    queueHappyPath();
    sendTelegram.mockResolvedValue(false);
    const res = await runWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toContain("Telegram send failed");
  });
});
