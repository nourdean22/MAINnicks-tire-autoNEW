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

/**
 * Rows for the 6 queries in call order: agg, repeat, top services, arrivals,
 * lead rows, funnel counts.
 *
 * The lead fixture is deliberately 4 rows containing ONE callback-duplicate
 * (source="callback" WITH a callbackId) — that row must not be counted, so the
 * expected lead figure is 3, not 4. See the shared-definition test below.
 */
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
          curCostDetail: 25,
          curDescribed: 20,
          curCoveredCents: 1248053,
          curCoveredPartsCents: 512000,
          curCoveredLaborCents: 689000,
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
    .mockResolvedValueOnce(wrap([{ cnt: 6, cents: 389000 }]))
    .mockResolvedValueOnce(
      wrap([
        { source: "popup", callbackId: null },
        { source: "chat", callbackId: null },
        { source: "callback", callbackId: 42 }, // duplicate of a callback row — excluded
        { source: "callback", callbackId: null }, // voice rack-check — counts
      ]),
    )
    .mockResolvedValueOnce(wrap([{ bookings: 5, callbacks: 9, callbacksOpen: 2 }]));
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

  it("nulls marginPct when the window has revenue but zero cost detail", async () => {
    // Same defect as the render test, asserted one layer down: the compute
    // must not hand a fabricated margin to any consumer, not just Telegram.
    execute
      .mockResolvedValueOnce([[{ curCents: 1665695, curCount: 32, curPartsCents: 0, curLaborCents: 0, curCostDetail: 0, curDescribed: 1, curCoveredCents: 0, curCoveredPartsCents: 0, curCoveredLaborCents: 0, prevCents: 1230047, prevCount: 22 }], []])
      .mockResolvedValueOnce([[{ weekCents: 1665695, repeatCents: 366000, unknownCents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 2, cents: 81699 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ bookings: 0, callbacks: 0, callbacksOpen: 0 }], []]);
    const d = await computeWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(d.revenue).toBeCloseTo(16656.95, 2);
    expect(d.costDetailCount).toBe(0);
    expect(d.marginPct).toBeNull(); // NOT 100
  });

  it("computes margin over the COVERED subset, not against total revenue", async () => {
    // The trap the first fix walked into: with 1 of 32 invoices covered, a
    // guard of `costDetailCount > 0` still divided that invoice's parts by the
    // FULL week's revenue, yielding ~99% — a fabrication with a guard on it.
    // Correct basis: $802.35 revenue / $400 parts on the one covered invoice
    // => 50%, regardless of the other $15,854 having no cost detail.
    execute
      .mockResolvedValueOnce([[{
        curCents: 1665695, curCount: 32, curPartsCents: 40000, curLaborCents: 0,
        curCostDetail: 1, curDescribed: 1,
        curCoveredCents: 80235, curCoveredPartsCents: 40000, curCoveredLaborCents: 0,
        prevCents: 1230047, prevCount: 22,
      }], []])
      .mockResolvedValueOnce([[{ weekCents: 1665695, repeatCents: 0, unknownCents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0, cents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ bookings: 0, callbacks: 0, callbacksOpen: 0 }], []]);
    const d = await computeWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(d.costDetailCount).toBe(1);
    expect(d.coveredRevenue).toBeCloseTo(802.35, 2);
    expect(d.marginPct).toBe(50); // NOT 99 — the whole point
  });

  it("counts leads through the SHARED actionable rule, not a re-implementation", async () => {
    queueHappyPath();
    const d = await computeWeeklyRevenueDigest(MONDAY_NOON_ET);
    // 4 lead rows, one of which is a callback-linked duplicate of a
    // callback_requests row (same person). countActionableLeads drops exactly
    // that one; the voice rack-check callback (callbackId null) still counts.
    // If this ever reads 4, someone re-expressed the rule in SQL and this
    // report has silently diverged from the daily one.
    expect(d.leads).toBe(3);
    expect(d.bookings).toBe(5);
    expect(d.callbacks).toBe(9);
    expect(d.callbacksOpen).toBe(2);
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
      .mockResolvedValueOnce([[{ cnt: 0, cents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ bookings: 0, callbacks: 0, callbacksOpen: 0 }], []]);
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
    costDetailCount: 25,
    describedCount: 20,
    coveredRevenue: 12480.53,
    coveredParts: 5120,
    coveredLabor: 6890,
    prevRevenue: 11556,
    prevInvoiceCount: 23,
    deltaPct: 8,
    repeatPct: 31,
    newPct: 62,
    unknownPct: 7,
    topServices: [{ name: "Brake pads <& rotors>", revenue: 2140, count: 4 }],
    arrivalsReconciled: 6,
    arrivalsRevenue: 3890,
    leads: 3,
    bookings: 5,
    callbacks: 9,
    callbacksOpen: 2,
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

  it("NEVER renders a margin when no invoice carries cost detail", () => {
    // THE REGRESSION THIS PINS, found by running the digest against prod
    // 2026-08-08: the ALG mirror stopped receiving parts/labor on
    // 2026-04-09, so partsCost is 0 on every recent invoice. The naive
    // (revenue - parts) / revenue then renders "Margin 100%" — a confident
    // fabrication on a shop that plainly pays for parts.
    const text = buildWeeklyRevenueDigestText({
      ...base,
      parts: 0,
      labor: 0,
      marginPct: null,
      costDetailCount: 0,
    });
    expect(text).not.toContain("Margin");
    expect(text).not.toContain("Margin 100%");
    expect(text).not.toContain("Parts $0");
    expect(text).toContain("Parts/labor missing on all 25 invoices");
    expect(text).toContain("margin unavailable");
  });

  it("states the margin's real basis when coverage is partial", () => {
    const text = buildWeeklyRevenueDigestText({ ...base, costDetailCount: 9 });
    expect(text).toContain("Margin 59%");
    expect(text).toContain("on the 9/25 invoices carrying cost detail");
  });

  it("quotes COVERED parts/labor next to the margin, never the shop-wide totals", () => {
    // The margin is computed over the covered subset, so the parts figure
    // printed beside it must be that subset's. Printing the full-week parts
    // total next to a subset margin invites reading them as one basis.
    const text = buildWeeklyRevenueDigestText({
      ...base,
      parts: 9999, // full-week total — must NOT appear
      labor: 8888,
      coveredParts: 5120,
      coveredLabor: 6890,
      costDetailCount: 9,
    });
    expect(text).toContain("Parts $5,120");
    expect(text).toContain("Labor $6,890");
    expect(text).not.toContain("9,999");
    expect(text).not.toContain("8,888");
  });

  it("says top services are unavailable rather than listing an empty-description bucket", () => {
    const text = buildWeeklyRevenueDigestText({ ...base, topServices: [], describedCount: 0 });
    expect(text).toContain("no invoice this week carried a description");
    expect(text).not.toContain("(no description)");
  });

  it("shows description coverage alongside the top-services list", () => {
    const text = buildWeeklyRevenueDigestText(base);
    expect(text).toContain("Top services (described: 20/25)");
  });

  it("carries the demand line absorbed from the retired weeklyReport router", () => {
    const text = buildWeeklyRevenueDigestText(base);
    expect(text).toContain("Demand: 3 leads · 5 bookings · 9 callbacks");
    expect(text).toContain("<b>2 still open</b>");
  });

  it("omits the open-callbacks callout when nothing is unworked", () => {
    const text = buildWeeklyRevenueDigestText({ ...base, callbacksOpen: 0 });
    expect(text).toContain("Demand: 3 leads · 5 bookings · 9 callbacks");
    expect(text).not.toContain("still open");
  });

  it("drops perpetually-zero demand channels instead of printing constants", () => {
    // Measured over 8 weeks to 2026-08-08: bookings fired twice TOTAL,
    // callback_requests not once. "0 bookings · 0 callbacks" every week is a
    // constant, and a constant is not information.
    const text = buildWeeklyRevenueDigestText({
      ...base,
      bookings: 0,
      callbacks: 0,
      callbacksOpen: 0,
    });
    expect(text).toContain("Demand: 3 leads");
    expect(text).not.toContain("0 bookings");
    expect(text).not.toContain("0 callbacks");
  });

  it("surfaces a booking or callback the moment one appears", () => {
    const text = buildWeeklyRevenueDigestText({ ...base, bookings: 1, callbacks: 0 });
    expect(text).toContain("Demand: 3 leads · 1 bookings");
    expect(text).not.toContain("0 callbacks");
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

  it("sends NOTHING when a LATE query throws — the revenue half must not ship alone", async () => {
    // The demand queries (leads, funnel) run 5th and 6th, AFTER all four
    // revenue queries have already succeeded. A partial digest is the
    // dangerous shape here: revenue would render correctly while the demand
    // line silently read zero, which looks like a dead week rather than a
    // failed read. Fail-closed means the whole send is suppressed.
    execute
      .mockResolvedValueOnce([[{ curCents: 1248053, curCount: 25, curPartsCents: 512000, curLaborCents: 689000, prevCents: 1155600, prevCount: 23 }], []])
      .mockResolvedValueOnce([[{ weekCents: 1248053, repeatCents: 387000, unknownCents: 87053 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 6, cents: 389000 }], []])
      .mockRejectedValueOnce(new Error("connect ETIMEDOUT")); // lead rows — 5th
    const res = await runWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toContain("digest failed");
  });

  it("reports a LATE schema error as SCHEMA BUG, not a transient failure", async () => {
    // A bad column in the funnel query (6th) must be as loud as one in the
    // first — the taxonomy cannot degrade with query position.
    execute
      .mockResolvedValueOnce([[{ curCents: 0, curCount: 0, curPartsCents: 0, curLaborCents: 0, prevCents: 0, prevCount: 0 }], []])
      .mockResolvedValueOnce([[{ weekCents: 0, repeatCents: 0, unknownCents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ cnt: 0, cents: 0 }], []])
      .mockResolvedValueOnce([[], []])
      .mockRejectedValueOnce(
        Object.assign(new Error("Unknown column 'callbacksOpenz'"), { code: "ER_BAD_FIELD_ERROR" }),
      );
    const res = await runWeeklyRevenueDigest(MONDAY_NOON_ET);
    expect(sendTelegram).not.toHaveBeenCalled();
    expect(res.details).toContain("SCHEMA BUG");
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
