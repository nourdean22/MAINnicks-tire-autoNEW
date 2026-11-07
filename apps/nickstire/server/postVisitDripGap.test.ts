/**
 * The 7-day post-visit text (postInvoiceFollowUp, visit 6-8 days ago) and retention D7 (visit 5-9 days ago)
 * used to land on the same customer the same week. One shared rule now keeps them 10 days apart: each lane's
 * eligibility query excludes a customer the OTHER lane texted in the last 10 days (post-visit lane reads
 * customers.lastRetentionDate; retention reads sms_messages rows tagged post_visit_d7, the key the post-visit
 * send now carries, pinned in postInvoiceFollowUp.test.ts). D7 -> D14 spacing is unchanged.
 *
 * Both eligibility WHEREs are rendered by drizzle's real MySqlDialect and asserted as the database sees them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const dialect = new MySqlDialect();
const wheres: unknown[] = [];

const DOMOCKED = ["./db", "./sms", "./services/featureFlags", "./services/smsInstrumentation", "./services/serviceReminders"];

beforeEach(() => {
  vi.resetModules();
  wheres.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T16:00:00.000Z")); // Tue noon ET, inside retention hours
  const db = {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          wheres.push(w);
          return Object.assign(Promise.resolve([]), { limit: async () => [] });
        },
      }),
    }),
  };
  vi.doMock("./db", () => ({ getDb: async () => db, hasOutboundTextWithinDays: async () => false }));
  vi.doMock("./sms", () => ({ sendSms: vi.fn(), withOptOut: (s: string) => s }));
  vi.doMock("./services/featureFlags", () => ({ isEnabled: async () => true }));
  vi.doMock("./services/smsInstrumentation", () => ({ logOutboundSms: async () => undefined, selectVariant: () => null }));
  vi.doMock("./services/serviceReminders", () => ({ phonesWithReminderThisFortnight: async () => new Set() }));
});

afterEach(() => {
  for (const m of DOMOCKED) vi.doUnmock(m);
  vi.useRealTimers();
  vi.resetModules();
});

/** The rendered `(<col> IS NULL OR <col> < NOW() - INTERVAL ? DAY)` clause on `column`, with its day count. */
function gapOn(column: string): { found: number; days: unknown } {
  const q = dialect.sqlToQuery(wheres[0] as never);
  const re = new RegExp(`\\(\`customers\`\\.\`${column}\` is null or \`customers\`\\.\`${column}\` < NOW\\(\\) - INTERVAL \\? DAY\\)`, "gi");
  const hits = [...q.sql.matchAll(re)];
  if (hits.length === 0) return { found: 0, days: undefined };
  const idx = (q.sql.slice(0, hits[0].index).match(/\?/g) ?? []).length;
  return { found: hits.length, days: q.params[idx] };
}

describe("post-visit drip gap · 10 days between the post-visit text and retention", () => {
  it("post-visit text: skips a customer retention texted in the last 10 days", async () => {
    const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
    await processPostInvoiceFollowUps();
    expect(wheres, "the eligibility query ran").toHaveLength(1);
    expect(gapOn("lastRetentionDate")).toEqual({ found: 1, days: 10 });
    expect(gapOn("smsCampaignDate").found, "its own column is not in its own gap rule").toBe(0);
  });

  it("retention D7: skips a phone the post-visit text (post_visit_d7) reached in the last 10 days", async () => {
    const { processRetention7Day } = await import("./cron/jobs/retentionSequences");
    await processRetention7Day();
    expect(wheres, "the eligibility query ran").toHaveLength(1);
    const q = dialect.sqlToQuery(wheres[0] as never);
    const m = /NOT EXISTS \(SELECT 1 FROM sms_messages m JOIN sms_conversations c ON m\.conversationId = c\.id WHERE c\.phone = `customers`\.`phone` AND m\.direction = 'outbound' AND m\.status <> 'failed' AND m\.variantKey = \? AND m\.createdAt >= NOW\(\) - INTERVAL \? DAY\)/.exec(q.sql);
    expect(m, q.sql).not.toBeNull();
    const idx = (q.sql.slice(0, m!.index).match(/\?/g) ?? []).length;
    expect(q.params.slice(idx, idx + 2)).toEqual(["post_visit_d7", 10]);
    expect(gapOn("lastRetentionDate").found, "D7 -> D14 spacing is untouched").toBe(0);
    expect(gapOn("smsCampaignDate").found, "the review request's stamp does not block D7").toBe(0);
  });
});
