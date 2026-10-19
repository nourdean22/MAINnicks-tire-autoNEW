/**
 * review-pipeline re-sent the same URGENT REVIEWS Telegram every day: prod
 * cron_log said "5 reviews synced, 1 urgent" on each day 2026-10-12..19 and no
 * review_replies row was ever posted (the screen that cleared an urgent review
 * is gone). The claim lives in cron_alerts_fired keyed (alert_key, fired_for);
 * a per-day fired_for lets a daily job repeat the same set every day, so this
 * alert claims once per urgent SET for good.
 *
 * Behaviour test: cron_alerts_fired is a Set behind a fake getDb (INSERT IGNORE
 * semantics on the rendered SQL), the Telegram transport is a spy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  claims: new Set<string>(),
  send: vi.fn(),
}));

vi.mock("../db", () => {
  const dialect = new MySqlDialect();
  return {
    getDb: async () => ({
      execute: async (q: SQL) => {
        const { sql, params } = dialect.sqlToQuery(q);
        const key = `${params[0]}|${params[1]}`;
        if (/^\s*INSERT IGNORE INTO cron_alerts_fired/i.test(sql)) {
          if (h.claims.has(key)) return [{ affectedRows: 0 }];
          h.claims.add(key);
          return [{ affectedRows: 1 }];
        }
        if (/^\s*DELETE FROM cron_alerts_fired/i.test(sql)) {
          h.claims.delete(key);
          return [{ affectedRows: 1 }];
        }
        throw new Error(`unexpected SQL in test: ${sql}`);
      },
    }),
  };
});
vi.mock("../services/telegram", () => ({ sendTelegramResult: h.send }));

import { notifyUrgentReviews, type UrgentReview } from "../pipelines/gbp-reviews";

const review = (id: number, over: Partial<UrgentReview> = {}): UrgentReview => ({
  id, authorName: `Reviewer ${id}`, rating: 1, reviewText: `Review ${id}: waited two hours and nobody called back`,
  sentiment: "negative", createdAt: new Date("2026-10-01T12:00:00Z"), ageDays: 18, ...over,
});

const DAY1 = new Date("2026-10-18T14:00:00Z");
const DAY2 = new Date("2026-10-19T14:00:00Z");

beforeEach(() => {
  h.claims.clear();
  h.send.mockReset();
  h.send.mockResolvedValue({ status: "sent" });
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("URGENT REVIEWS alert: once per urgent set, not once per day", () => {
  it("the same urgent set on day 1 and day 2 sends once", async () => {
    vi.setSystemTime(DAY1);
    await notifyUrgentReviews([review(7)]);
    vi.setSystemTime(DAY2);
    await notifyUrgentReviews([review(7)]);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("a new urgent review sends again", async () => {
    vi.setSystemTime(DAY1);
    await notifyUrgentReviews([review(7)]);
    vi.setSystemTime(DAY2);
    await notifyUrgentReviews([review(7), review(9)]);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("a failed send gives the claim back, so the next run retries", async () => {
    vi.setSystemTime(DAY1);
    h.send.mockResolvedValueOnce({ status: "failed" });
    await notifyUrgentReviews([review(7)]);
    vi.setSystemTime(DAY2);
    await notifyUrgentReviews([review(7)]);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("no urgent reviews sends nothing", async () => {
    await notifyUrgentReviews([]);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("the preview carries the review text and points at Google", async () => {
    await notifyUrgentReviews([review(7)]);
    const text = String(h.send.mock.calls[0][0]);
    expect(text).toContain('Reviewer 7: "Review 7: waited two hours');
    expect(text).not.toContain('""');
    expect(text).toContain("Reply on Google");
    expect(text).not.toMatch(/Review Replies/);
  });
});
