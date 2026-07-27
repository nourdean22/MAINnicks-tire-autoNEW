/**
 * A forecast that has never once produced a forecast.
 *
 * Every query in this job named a column that does not exist —
 * `bookings.created_at`, `invoices.created_at`, `invoices.total`. The real
 * columns are `createdAt` and `totalAmount`. This database mixes snake_case
 * and camelCase PER TABLE (cron_log is snake_case; bookings and invoices are
 * camelCase), and these three guessed wrong.
 *
 * The first query threw, the catch returned a normal result object, and the
 * scheduler recorded `completed`. Verified in production cron_log — the one
 * Monday in the window:
 *
 *   Mon Jul 27 2026 | completed | rec=0 | bookings stats failed
 *   Sun Jul 26 2026 | completed | rec=0 | skip · not Monday (dow=0)
 *
 * Six days of correct skipping, and on the day it actually works, a silent
 * failure wearing a success label.
 *
 * WHY THE MODEL CHANGED TOO
 * Fixing the column names alone would have shipped a confidently WRONG number.
 * The old model was bookings × close_rate × ticket. Measured over the same 13
 * weeks: 4 bookings, 337 invoices — web bookings are ~1% of revenue events at
 * a phone/walk-in shop. Fed real data, close_rate clamps to 1.0 and the
 * forecast lands near $3.4K/week against ~$12.5K actual: ~3.7x low, delivered
 * weekly with percentile bands that make it look measured.
 *
 * A dead job is better than a confident wrong one, so the model now samples
 * what the shop actually does: invoices per week × ticket size.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "cron", "jobs", "monteCarloForecast.ts"),
  "utf8",
);

/** Rows the two stats queries return, or an Error to throw. */
let volumeAnswer: unknown = [{ m: 26, s: 6, weeks: 13 }];
let ticketAnswer: unknown = [{ m: 48253, s: 30000 }];
const telegram = vi.fn(async () => {});

vi.mock("./db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = JSON.stringify(q);
      const answer = text.includes("invoices_in_week") ? volumeAnswer : ticketAnswer;
      if (answer instanceof Error) throw answer;
      return [answer, []];
    },
  }),
}));
vi.mock("./services/telegram", () => ({ sendTelegram: (...a: unknown[]) => telegram(...(a as [])) }));

import { processMonteCarloForecast } from "./cron/jobs/monteCarloForecast";

/** 2026-07-27 was a Monday — the job no-ops on any other day. */
const A_MONDAY = new Date("2026-07-27T15:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(A_MONDAY);
  volumeAnswer = [{ m: 26, s: 6, weeks: 13 }];
  ticketAnswer = [{ m: 48253, s: 30000 }];
  telegram.mockClear();
});
// singleFork shares one process across files — restore or the fake clock leaks.
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/**
 * Comments are stripped before these assertions. The file DOCUMENTS the dead
 * column names on purpose — an earlier version of this test used a negative
 * lookahead to exclude the prose and failed against its own docblock. Removing
 * comments is the honest way to ask "does the CODE still name them?".
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the queries name columns that actually exist", () => {
  it("the comment-stripper left real code behind (guards a vacuous pass)", () => {
    expect(CODE).toMatch(/export async function processMonteCarloForecast/);
    expect(CODE.length).toBeGreaterThan(2000);
  });

  it("reads createdAt, never created_at", () => {
    expect(CODE).not.toMatch(/\bcreated_at\b/);
    expect(CODE).toMatch(/createdAt >= DATE_SUB/);
  });

  it("reads totalAmount, never invoices.total", () => {
    // `total > 0` and `AVG(total)` were the two dead reads.
    expect(CODE).not.toMatch(/AVG\(total\)/);
    expect(CODE).not.toMatch(/AND total > 0/);
    expect(CODE).toMatch(/AVG\(totalAmount\)/);
  });

  it("no longer samples bookings — 4 in 13 weeks cannot forecast 337 invoices", () => {
    expect(CODE).not.toMatch(/FROM bookings/);
  });
});

describe("it forecasts the right order of magnitude", () => {
  it("26 jobs/week at $482 lands near $12.5K, not $3.4K", async () => {
    const r = await processMonteCarloForecast();
    const p50 = Number(/p50=(\d+)/.exec(r.details ?? "")?.[1]);
    expect(p50).toBeGreaterThan(9_000);
    expect(p50).toBeLessThan(16_000);
  });

  it("treats totalAmount as CENTS (verified: avg 48253 = $482.53)", async () => {
    // If the /100 were dropped, p50 would be ~100x larger.
    const r = await processMonteCarloForecast();
    const p50 = Number(/p50=(\d+)/.exec(r.details ?? "")?.[1]);
    expect(p50).toBeLessThan(100_000);
  });

  it("reports a band, not a point — p10 < p50 < p90", async () => {
    const r = await processMonteCarloForecast();
    const [p10, p50, p90] = ["p10", "p50", "p90"].map((k) => Number(new RegExp(`${k}=(\\d+)`).exec(r.details ?? "")?.[1]));
    expect(p10).toBeLessThan(p50);
    expect(p50).toBeLessThan(p90);
  });

  it("sends the operator digest", async () => {
    await processMonteCarloForecast();
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(String(telegram.mock.calls[0][0])).toMatch(/MONTE-CARLO/);
  });
});

describe("a schema bug is LOUD, not 'completed'", () => {
  it("reports BROKEN when a column does not exist", async () => {
    // This is the exact production failure: the details said
    // "bookings stats failed" and the status said completed.
    const err = Object.assign(new Error("Unknown column 'created_at' in 'group statement'"), { code: "ER_BAD_FIELD_ERROR" });
    volumeAnswer = err;
    const r = await processMonteCarloForecast();
    expect(r.details).toMatch(/^BROKEN:/);
    expect(telegram).not.toHaveBeenCalled();
  });

  it("a non-schema failure stays a quiet skip", async () => {
    volumeAnswer = new Error("connection reset");
    const r = await processMonteCarloForecast();
    expect(r.details).not.toMatch(/^BROKEN:/);
    expect(r.recordsProcessed).toBe(0);
  });
});

describe("it refuses a sample too thin to draw a band from", () => {
  it("skips when fewer than MIN_WEEKS have invoices", async () => {
    volumeAnswer = [{ m: 26, s: 6, weeks: 3 }];
    const r = await processMonteCarloForecast();
    expect(r.details).toMatch(/insufficient history \(3\/6 weeks/);
    expect(telegram).not.toHaveBeenCalled();
  });

  it("the OLD guard would have passed this — mean > 0 is not enough", async () => {
    // Four bookings across thirteen weeks has a positive mean. The old
    // condition was `mean <= 0`, so it published bands off four points.
    volumeAnswer = [{ m: 0.3, s: 0.1, weeks: 4 }];
    const r = await processMonteCarloForecast();
    expect(r.details).toMatch(/insufficient history/);
  });

  it("still refuses when the ticket average is zero", async () => {
    ticketAnswer = [{ m: 0, s: 0 }];
    const r = await processMonteCarloForecast();
    expect(r.details).toMatch(/insufficient history/);
  });
});

describe("it only runs on Mondays", () => {
  it("skips on a Sunday", async () => {
    vi.setSystemTime(new Date("2026-07-26T15:00:00Z"));
    const r = await processMonteCarloForecast();
    expect(r.details).toMatch(/not Monday/);
    expect(telegram).not.toHaveBeenCalled();
  });
});
