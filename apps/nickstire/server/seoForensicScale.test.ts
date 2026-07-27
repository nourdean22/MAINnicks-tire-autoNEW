/**
 * Thresholds written in real positions, compared against raw ones.
 *
 * `search_performance.position` is an INT holding position × 100 — GSC reports
 * fractional average positions and an INT column cannot hold them. Verified
 * against production:
 *
 *   rows                 29,059
 *   min                     100   (= real position 1.0)
 *   avg                   2,197   (= 21.97)
 *   max                  14,600   (= 146.0)
 *   rows position <= 10         0   <- what the `warning` gate required
 *   rows at real position 1-10  11,326
 *
 * Every threshold in the job was authored in real positions, so the classifier
 * broke in BOTH directions at once:
 *
 *   · `priorPos <= 10`, the top-10 gate on `warning`, needed a RAW 10 — real
 *     position 0.1. Nothing in the table can satisfy it, so `warning` was
 *     unreachable while 11,326 rows genuinely sat in the top 10.
 *   · `shift >= 10` for `alert` is a real drop of 0.1 positions, so `alert`
 *     fired on ordinary daily noise — and, being checked first, swallowed
 *     everything the warning branch was meant to catch.
 *   · the Telegram digest printed raw units: "position 3500" for a page
 *     actually ranking 35th.
 *
 * The header comment was correct the whole time ("drop >= 5 positions on a
 * top-10-ranking page = warning"). Only the code disagreed with it.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/** Raw (×100) rows the position query returns, keyed by query text. */
let positionsByQuery: Record<string, { recent_pos: number; prior_pos: number }> = {};
let topQueries: Array<{ query: string; page: string; impressions: number }> = [];
const telegram = vi.fn(async () => {});

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("ORDER BY impressions DESC")) return [topQueries, []];
      // The per-query position pull — find which query drizzle bound.
      const hit = Object.keys(positionsByQuery).find((k) => text.includes(k));
      return [[positionsByQuery[hit ?? ""] ?? { recent_pos: null, prior_pos: null }], []];
    },
  }),
}));
vi.mock("./services/telegram", () => ({ sendTelegram: (...a: unknown[]) => telegram(...(a as [])) }));

import { processSeoForensic } from "./cron/jobs/seoForensic";

const P = (real: number) => real * 100; // author tests in REAL positions

beforeEach(() => {
  topQueries = [{ query: "brakes near me", page: "/brakes", impressions: 500 }];
  positionsByQuery = {};
  telegram.mockClear();
});
afterEach(() => vi.restoreAllMocks());

const digest = () => String(telegram.mock.calls[0]?.[0] ?? "");

describe("the top-10 warning gate is reachable again", () => {
  it("a 6-position drop from rank 4 is a WARNING — the case that could never fire", async () => {
    // prior 4.0 -> recent 10.0. Old code compared prior_pos=400 <= 10 (false),
    // so this fell through to `alert` or vanished entirely.
    positionsByQuery["brakes near me"] = { recent_pos: P(10), prior_pos: P(4) };
    await processSeoForensic();
    expect(digest()).toMatch(/⚠/);
    expect(digest()).not.toMatch(/🚨/);
  });

  it("reports REAL positions in the digest, not raw x100 units", async () => {
    positionsByQuery["brakes near me"] = { recent_pos: P(10), prior_pos: P(4) };
    await processSeoForensic();
    // The operator used to be shown 1000 and 400 for this exact shift.
    expect(digest()).toMatch(/\b10\b/);
    expect(digest()).not.toMatch(/\b1000\b/);
    expect(digest()).not.toMatch(/\b400\b/);
  });
});

describe("alert no longer fires on noise", () => {
  it("a 0.1-position drift is IGNORED — it used to be an alert", async () => {
    // shift = 10 raw. Old code: `shift >= ALERT_SHIFT (10)` -> alert.
    positionsByQuery["brakes near me"] = { recent_pos: P(4.1), prior_pos: P(4.0) };
    await processSeoForensic();
    expect(telegram).not.toHaveBeenCalled();
  });

  it("a genuine 12-position collapse IS an alert", async () => {
    positionsByQuery["brakes near me"] = { recent_pos: P(20), prior_pos: P(8) };
    await processSeoForensic();
    expect(digest()).toMatch(/🚨/);
  });

  it("a real 5-position gain is INFO, not silence", async () => {
    positionsByQuery["brakes near me"] = { recent_pos: P(9), prior_pos: P(15) };
    await processSeoForensic();
    expect(digest()).toMatch(/✅/);
  });
});

describe("severity still discriminates", () => {
  it("a 6-position drop from rank 40 is NOT a warning — the top-10 gate still means something", async () => {
    // Below the fold: real movement, but not the operator's money pages.
    positionsByQuery["brakes near me"] = { recent_pos: P(46), prior_pos: P(40) };
    await processSeoForensic();
    expect(telegram).not.toHaveBeenCalled();
  });

  it("stays silent when nothing moved", async () => {
    positionsByQuery["brakes near me"] = { recent_pos: P(4), prior_pos: P(4) };
    await processSeoForensic();
    expect(telegram).not.toHaveBeenCalled();
  });
});
