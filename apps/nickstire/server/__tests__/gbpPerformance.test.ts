import { describe, it, expect, vi } from "vitest";
import {
  fetchGbpPerformance,
  normalizeLocationId,
  GBP_DAILY_METRICS,
} from "../services/gbpPerformance";

/**
 * WP-22 GBP-leg pins (2026-07-29). Google is mocked — these test OUR
 * mapping, the threshold-honesty rule (Google's "<N" stays a string,
 * never fabricated into a number), and failure typing.
 */
function mockFetch(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body };
  });
}

describe("normalizeLocationId", () => {
  it("strips the locations/ prefix and passes bare ids through", () => {
    expect(normalizeLocationId("locations/12345")).toBe("12345");
    expect(normalizeLocationId("12345")).toBe("12345");
  });
});

describe("fetchGbpPerformance", () => {
  const seriesBody = {
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: "CALL_CLICKS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 7, day: 28 }, value: "3" },
                { date: { year: 2026, month: 7, day: 29 }, value: "5" },
              ],
            },
          },
        ],
      },
    ],
  };
  const kwBody = {
    searchKeywordsCounts: [
      { searchKeyword: "tire shop euclid", insightsValue: { value: "120" } },
      { searchKeyword: "used tires near me", insightsValue: { threshold: "15" } },
    ],
  };

  it("maps series + totals and keeps Google's '<N' threshold as a STRING", async () => {
    const f = mockFetch([
      { ok: true, body: seriesBody },
      { ok: true, body: kwBody },
    ]);
    const r = await fetchGbpPerformance({
      locationId: "locations/99",
      accessToken: "t",
      days: 30,
      fetchImpl: f as never,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.series[0].metric).toBe("CALL_CLICKS");
      expect(r.series[0].total).toBe(8);
      expect(r.topSearchKeywords[0]).toEqual({ keyword: "tire shop euclid", impressions: 120 });
      expect(r.topSearchKeywords[1].impressions).toBe("<15"); // honesty: never fabricate a number
      expect(r.source).toContain("Google Business Profile");
    }
  });

  it("daily-metrics API failure returns a typed error, not a fake-empty", async () => {
    const f = mockFetch([{ ok: false, status: 403, body: {} }]);
    const r = await fetchGbpPerformance({ locationId: "99", accessToken: "t", fetchImpl: f as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("403");
  });

  it("requests every declared daily metric", async () => {
    const f = mockFetch([
      { ok: true, body: { multiDailyMetricTimeSeries: [] } },
      { ok: true, body: {} },
    ]);
    await fetchGbpPerformance({ locationId: "99", accessToken: "t", fetchImpl: f as never });
    const firstUrl = (f.mock.calls[0]?.[0] ?? "") as string;
    for (const m of GBP_DAILY_METRICS) expect(firstUrl).toContain(m);
  });
});
