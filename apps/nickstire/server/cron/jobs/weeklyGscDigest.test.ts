/**
 * Weekly GSC Digest — mechanism tests, driven through the one export the
 * scheduler calls (runWeeklyGscDigest). The windows are asserted on what
 * Google is ASKED for, the message on what Telegram is HANDED — the same
 * surfaces production touches, so a helper cannot be green while the job
 * sends something else.
 *
 * What is asserted (not merely exercised):
 *   · the two windows are back-to-back 28-day ranges ending GSC_LAG_DAYS (3)
 *     before the SHOP's today (ET), not the server's UTC today
 *   · the headline is the OFFICIAL total; no official total → NOTHING is sent
 *     and the run REJECTS (cron_log records `failed`, not `completed`)
 *   · a missing prior total renders as "no baseline", never as ▲/▼ or zeros
 *   · the search_performance mirror's reach is read first: EMPTY and BEHIND
 *     are named, and an empty insight list is never dressed as "none found"
 *   · a schema error on the mirror query rejects loudly as SCHEMA BUG
 *   · a failed Telegram send is a failure, not success
 *   · the Monday gate is shop-timezone and touches nothing on other days
 *   · HTML-unsafe query text is escaped before hitting parse_mode:HTML
 *
 * Serial-suite hygiene (AGENTS.md §3): every mock is reset in afterEach —
 * this file shares one process with the rest of the suite.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

const getGscReport = vi.fn();
const findCtrOpportunities = vi.fn();
const detectRankingChanges = vi.fn();
const execute = vi.fn();
const sendTelegram = vi.fn();

vi.mock("../../pipelines/gsc-data", () => ({
  getGscReport: (...args: unknown[]) => getGscReport(...args),
  findCtrOpportunities: (...args: unknown[]) => findCtrOpportunities(...args),
  detectRankingChanges: (...args: unknown[]) => detectRankingChanges(...args),
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({ execute })),
}));
vi.mock("../../services/telegram", () => ({
  sendTelegram: (...args: unknown[]) => sendTelegram(...args),
}));

import { runWeeklyGscDigest } from "./weeklyGscDigest";

// 2026-10-12 is a Monday; 16:00 UTC = 12:00 ET — unambiguously Monday in both zones.
const MONDAY_NOON_ET = new Date("2026-10-12T16:00:00Z");
const CURRENT = { startDate: "2026-09-12", endDate: "2026-10-09" };
const PRIOR = { startDate: "2026-08-15", endDate: "2026-09-11" };

const officialCurrent = {
  summary: { clicks: 1234, impressions: 45678, ctr: 0.027, position: 12.3 },
  summaryHasData: true,
  topQueries: [
    { key: "used tires cleveland <& more>", clicks: 120, impressions: 2300, ctr: 0.052, position: 3.1 },
    { key: "tire shop near me", clicks: 80, impressions: 4100, ctr: 0.0195, position: 6.4 },
  ],
  topPages: [
    { key: "https://nickstire.org/used-tires", clicks: 400, impressions: 9000, ctr: 0.044, position: 4.2 },
  ],
};
const officialPrior = {
  summary: { clicks: 1140, impressions: 47100, ctr: 0.0242, position: 12.9 },
  summaryHasData: true,
  topQueries: [],
  topPages: [],
};
const opportunity = {
  query: "tire shop near me",
  page: "https://nickstire.org/",
  impressions: 850,
  currentCtr: 1.1,
  avgPosition: 4.2,
  suggestedAction: "rewrite title",
};
const moves = [
  { query: "wheel alignment", page: "https://nickstire.org/alignment", previousPosition: 4, currentPosition: 11.5, delta: -7.5, direction: "dropped" },
  { query: "brake repair cleveland", page: "https://nickstire.org/brakes", previousPosition: 14, currentPosition: 8, delta: 6, direction: "improved" },
];

type Official = typeof officialCurrent;

/**
 * Queue a run: official current + prior reports, a mirror reach row (null =
 * empty mirror), one CTR opportunity and two ranking moves, Telegram OK.
 */
function queue(opts?: {
  current?: Partial<Official>;
  prior?: Partial<Official>;
  mirrorThrough?: string | null;
  mirrorRows?: unknown; // override the raw execute() result shape
  opportunities?: unknown[];
  moves?: unknown[];
  telegram?: boolean;
}) {
  const cur = { ...officialCurrent, ...opts?.current };
  const prev = { ...officialPrior, ...opts?.prior };
  getGscReport.mockImplementation(async (_range: unknown, o?: { totalsOnly?: boolean }) =>
    o?.totalsOnly ? prev : cur,
  );
  const through = opts?.mirrorThrough === undefined ? "2026-10-09" : opts.mirrorThrough;
  execute.mockResolvedValueOnce(opts?.mirrorRows ?? [[{ throughDate: through }], []]);
  findCtrOpportunities.mockResolvedValue(opts?.opportunities ?? [opportunity]);
  detectRankingChanges.mockResolvedValue(opts?.moves ?? moves);
  sendTelegram.mockResolvedValue(opts?.telegram ?? true);
}

const sentText = (): string => String(sendTelegram.mock.calls[0]?.[0] ?? "");

afterEach(() => {
  getGscReport.mockReset();
  findCtrOpportunities.mockReset();
  detectRankingChanges.mockReset();
  execute.mockReset();
  sendTelegram.mockReset();
  vi.restoreAllMocks();
});

describe("windows — two closed 28-day ranges, shop-TZ today, GSC lag respected", () => {
  it("asks Google for a window ending 3 days before the shop's today, plus the 28 days before it (totals only)", async () => {
    queue();
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    expect(getGscReport).toHaveBeenCalledTimes(2);
    expect(getGscReport).toHaveBeenCalledWith(CURRENT);
    expect(getGscReport).toHaveBeenCalledWith(PRIOR, { totalsOnly: true });
    // The CTR scan is bounded to the SAME window the headline reports.
    expect(findCtrOpportunities).toHaveBeenCalledWith(expect.objectContaining({ startDate: CURRENT.startDate }));
  });

  it("takes 'today' from the shop timezone, not server UTC", async () => {
    // 2026-10-13T02:00Z is Tuesday in UTC but still Monday 22:00 ET — same windows as noon.
    queue();
    await runWeeklyGscDigest(new Date("2026-10-13T02:00:00Z"));
    expect(getGscReport).toHaveBeenCalledWith(CURRENT);
    expect(getGscReport).toHaveBeenCalledWith(PRIOR, { totalsOnly: true });
  });

  it("crosses a year boundary on the date keys themselves", async () => {
    // 2026-01-05 is a Monday: the windows reach back into 2025.
    queue();
    await runWeeklyGscDigest(new Date("2026-01-05T16:00:00Z"));
    expect(getGscReport).toHaveBeenCalledWith({ startDate: "2025-12-06", endDate: "2026-01-02" });
    expect(getGscReport).toHaveBeenCalledWith(
      { startDate: "2025-11-08", endDate: "2025-12-05" },
      { totalsOnly: true },
    );
  });
});

describe("the message", () => {
  it("leads with the official headline and the delta vs the prior window", async () => {
    queue();
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    const text = sentText();
    expect(text).toContain("<b>WEEKLY SEARCH — 1,234 clicks</b>");
    expect(text).toContain("Sep 12–Oct 9 · 28 days, official GSC · 45,678 impressions · CTR 2.7% · avg position 12.3");
    expect(text).toContain("▲ 8% clicks vs prior 28d (1,140)"); // (1234-1140)/1140 = 8.2%
    expect(text).toContain("impressions ▼ 3%"); // (45678-47100)/47100 = -3.0%
    expect(text).toContain("position 12.9 → 12.3");
  });

  it("escapes HTML-unsafe query text (parse_mode: HTML)", async () => {
    queue();
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    expect(sentText()).toContain("used tires cleveland &lt;&amp; more&gt;");
    expect(sentText()).not.toContain("used tires cleveland <& more>");
  });

  it("renders pages as paths and names the anonymisation caveat on the query list", async () => {
    queue();
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    expect(sentText()).toContain("1. /used-tires — 400c / 9,000i · #4.2");
    expect(sentText()).toContain("most impressions are anonymised");
  });

  it("says 'no baseline' when the prior window has no official total — never ▲/▼ against zeros", async () => {
    queue({ prior: { summaryHasData: false, summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 } } });
    const res = await runWeeklyGscDigest(MONDAY_NOON_ET);
    const text = sentText();
    expect(text).toContain("no prior-period baseline");
    expect(text).not.toContain("▲");
    expect(text).not.toContain("▼");
    expect(res.details).toContain("(no baseline)");
  });

  it("carries the mirror insights with the opportunity's position, CTR and page", async () => {
    queue();
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    const text = sentText();
    expect(text).toContain("mirror synced through Oct 9");
    expect(text).toContain("• tire shop near me — #4.2, 1.1% CTR on 850i → /");
    expect(text).toContain("📉 wheel alignment #4.0 → #11.5");
    expect(text).toContain("📈 brake repair cleveland #14.0 → #8.0");
  });

  it("names an EMPTY mirror instead of rendering empty insight lists as 'none', and never consults it", async () => {
    // THE SHAPE THIS PINS (empty-vs-error): findCtrOpportunities returns [] both
    // when nothing qualifies and when the table has never been written to. The
    // digest must not let the second read as the first.
    queue({ mirrorThrough: null });
    const res = await runWeeklyGscDigest(MONDAY_NOON_ET);
    const text = sentText();
    expect(text).toContain("search_performance mirror is EMPTY");
    expect(text).toContain("check gsc-pipeline");
    expect(text).not.toContain("CTR opportunities: none");
    expect(text).not.toContain("Ranking moves: none");
    expect(findCtrOpportunities).not.toHaveBeenCalled();
    expect(detectRankingChanges).not.toHaveBeenCalled();
    expect(res.details).toContain("mirror EMPTY");
  });

  it("flags a mirror that is BEHIND the reported window, and still lists what it holds", async () => {
    queue({ mirrorThrough: "2026-10-04" });
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    expect(sentText()).toContain("⚠️ mirror behind the window — synced through Oct 4 only");
    expect(sentText()).toContain("• tire shop near me");
  });

  it("says 'none' only when the mirror is fresh and genuinely found nothing", async () => {
    queue({ opportunities: [], moves: [] });
    await runWeeklyGscDigest(MONDAY_NOON_ET);
    const text = sentText();
    expect(text).toContain("mirror synced through Oct 9");
    expect(text).toContain("CTR opportunities: none above 50 impressions");
    expect(text).toContain("Ranking moves: none of 3+ positions");
  });

  it("parses the mirror reach from flat rows as well as the TiDB tuple shape", async () => {
    queue({ mirrorRows: [{ throughDate: "2026-10-08" }] });
    const res = await runWeeklyGscDigest(MONDAY_NOON_ET);
    expect(res.details).toContain("mirror 2026-10-08");
  });
});

describe("runWeeklyGscDigest — gate and failure posture", () => {
  it("no-ops on non-Mondays without touching Google, the database or Telegram", async () => {
    const res = await runWeeklyGscDigest(new Date("2026-10-14T16:00:00Z")); // Wednesday
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toContain("not Monday");
    expect(getGscReport).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: sends the digest on a Monday and reports receipts in details", async () => {
    queue();
    const res = await runWeeklyGscDigest(MONDAY_NOON_ET);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(res.recordsProcessed).toBe(1);
    expect(res.details).toBe(
      "clicks 1,234 (+8%) · 2026-09-12..2026-10-09 · 1 ctr opps · 1 drops · mirror 2026-10-09",
    );
  });

  it("sends NOTHING and REJECTS when the Google call throws", async () => {
    getGscReport.mockRejectedValue(new Error("GSC API 503: backend error"));
    // REJECTS, not resolves: a returned failure is recorded `completed` in
    // cron_log and the failure observer never sees it.
    await expect(runWeeklyGscDigest(MONDAY_NOON_ET)).rejects.toThrow(/digest failed: GSC API 503/);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("sends NOTHING and REJECTS when Google has no official total — a zero-click headline is a lie", async () => {
    queue({ current: { summaryHasData: false, summary: { clicks: 0, impressions: 0, ctr: 0, position: 0 } } });
    await expect(runWeeklyGscDigest(MONDAY_NOON_ET)).rejects.toThrow(/digest failed: GSC returned no official total/);
    expect(sendTelegram).not.toHaveBeenCalled();
    // Nothing downstream ran — the mirror was never consulted.
    expect(execute).not.toHaveBeenCalled();
    expect(findCtrOpportunities).not.toHaveBeenCalled();
  });

  it("reports a schema error on the mirror query loudly as SCHEMA BUG (#1125 distinction)", async () => {
    queue();
    execute.mockReset();
    execute.mockRejectedValueOnce(
      Object.assign(new Error("Unknown column 'searchTypez'"), { code: "ER_BAD_FIELD_ERROR" }),
    );
    await expect(runWeeklyGscDigest(MONDAY_NOON_ET)).rejects.toThrow(/SCHEMA BUG — Unknown column 'searchTypez'/);
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("reports a failed Telegram send as a failure, not success", async () => {
    queue({ telegram: false });
    await expect(runWeeklyGscDigest(MONDAY_NOON_ET)).rejects.toThrow(/Telegram send failed/);
  });
});
