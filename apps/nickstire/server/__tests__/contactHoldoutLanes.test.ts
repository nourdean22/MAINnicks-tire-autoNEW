/**
 * Q-21 · every remaining holdout lane RECORDS a withheld control as 'heldout'.
 *
 * sendSms returning `{ success: true, heldOut: true }` is the contract. Each
 * lane must then (a) write its own terminal 'heldout' state or count, (b) never
 * call it sent, and (c) never write an outbound sms_messages row for it — a
 * phantom "sent" row would put a control customer into the treatment readout.
 *
 * Lanes: winback, campaigns, review requests, retention. Weather is pinned in
 * services/weatherIntelligence.nws.test.ts next to its armed-path tests. Drip
 * is deliberately not a lane (see contactExperiment.ts).
 *
 * vi.doMock per test + vi.doUnmock in afterEach: doMocks are NOT file-scoped
 * under singleFork (apps/nickstire/AGENTS.md §3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableColumns, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { smsCampaignSends } from "../../drizzle/schema";

const HELD_OUT = {
  success: true,
  heldOut: true,
  experimentId: "contact:lane:v1",
  experimentLane: "lane",
};

const sendSms = vi.fn(async () => HELD_OUT as Record<string, unknown>);
const logOutboundSms = vi.fn(async () => undefined);
const dialect = new MySqlDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

const DOMOCKED = [
  "../db", "../lib/db-helper", "../sms", "../services/featureFlags",
  "../services/telegram", "../services/smsInstrumentation", "../services/eventBus",
];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T16:00:00.000Z")); // Tue noon ET
  sendSms.mockClear();
  sendSms.mockImplementation(async () => HELD_OUT);
  logOutboundSms.mockClear();
  // Rate-limit sleeps resolve immediately; the delays are recorded.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  vi.doMock("../services/featureFlags", () => ({ isEnabled: vi.fn(async () => true) }));
  vi.doMock("../services/telegram", () => ({ sendTelegram: vi.fn(async () => true), alertSystem: vi.fn(async () => true) }));
  vi.doMock("../services/smsInstrumentation", () => ({
    logOutboundSms,
    selectVariant: (_id: number, v: Array<{ key: string; payload: unknown }>) => v[0],
  }));
  vi.doMock("../services/eventBus", () => ({ dispatch: vi.fn(async () => undefined) }));
});

afterEach(() => {
  for (const m of DOMOCKED) vi.doUnmock(m);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe("winback", () => {
  it("rewrites the claimed row to 'heldout', clears sentAt, never bumps sentCount", async () => {
    const executed: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      execute: vi.fn(async (q: SQL) => {
        const r = render(q);
        executed.push(r);
        if (/FROM winback_sends ws/.test(r.sql)) {
          return [[{ id: 11, phone: "2165550142", personalizedBody: "We miss you", campaignId: 3, customerId: 9 }]];
        }
        if (/SELECT smsOptOut/.test(r.sql)) return [[{ smsOptOut: 0 }]];
        if (/SET status = 'sent'/.test(r.sql)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    vi.doMock("../db", () => ({ getDb: async () => db }));
    vi.doMock("../sms", () => ({ sendSms, isShopGatewayReachable: async () => true }));

    const { processWinbackPending } = await import("../services/winbackProcessor");
    const res = await processWinbackPending();

    expect(sendSms).toHaveBeenCalledWith("2165550142", expect.any(String), expect.objectContaining({ variantKey: "winback" }));
    const heldoutWrite = executed.find((e) => /SET status = 'heldout'/.test(e.sql));
    expect(heldoutWrite, "winback must record the control as heldout").toBeDefined();
    expect(heldoutWrite!.sql).toMatch(/sentAt = NULL/);
    expect(heldoutWrite!.params).toContain("experiment_control:contact:lane:v1");
    expect(executed.some((e) => /sentCount = sentCount \+ 1/.test(e.sql))).toBe(false);
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toMatch(/0 sent, 0 queued, 1 holdout controls/);
  });
});

describe("campaigns", () => {
  function campaignDb(sends: number) {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    let pendingReads = 0;
    const sendRow = (id: number) =>
      Object.keys(getTableColumns(smsCampaignSends)).map((k) =>
        k === "id" ? id : k === "campaignId" ? 5 : k === "phone" ? "2165550142" : k === "messageBody" ? "Fall tire check" : k === "status" ? "pending" : null,
      );
    const client = {
      query: vi.fn(async (q: { sql: string } | string, params: unknown[] = []) => {
        const text = typeof q === "string" ? q : q.sql;
        queries.push({ sql: text, params });
        if (/^update /i.test(text)) return [{ affectedRows: 1 }, []];
        if (/from `sms_campaign_sends`/.test(text)) {
          pendingReads++;
          return [pendingReads === 1 ? Array.from({ length: sends }, (_, i) => sendRow(100 + i)) : [], []];
        }
        if (/select `status` from `sms_campaigns`/.test(text)) return [[["active"]], []];
        return [[], []];
      }),
    };
    return { d: drizzle(client as never), queries };
  }

  it("records the control as 'heldout' with sentAt cleared, and it is not a sent", async () => {
    const { d, queries } = campaignDb(1);
    vi.doMock("../lib/db-helper", () => ({ db: async () => d, dbTyped: async () => d, requireDb: async () => d }));
    vi.doMock("../sms", () => ({ sendSms, isShopGatewayReachable: async () => true, isShopGatewayConfigured: () => false }));

    const { processCampaignSends } = await import("../routers/campaigns");
    await processCampaignSends(5);

    expect(sendSms).toHaveBeenCalledWith("2165550142", "Fall tire check", expect.objectContaining({ variantKey: "campaign:5" }));
    const heldoutWrite = queries.find((q) => /^update `sms_campaign_sends`/.test(q.sql) && q.params.includes("heldout"));
    expect(heldoutWrite, "campaigns must record the control as heldout").toBeDefined();
    expect(heldoutWrite!.sql).toMatch(/`sentAt` = \?/);
    expect(heldoutWrite!.params).toContain("experiment_control:contact:lane:v1");
    expect(heldoutWrite!.params.filter((p) => p === null)).toHaveLength(2); // sentAt + twilioSid cleared
    expect(queries.some((q) => /^update `sms_campaigns` set `sentCount`/.test(q.sql))).toBe(false);
  });

  it("paces the next send after an ERRORED send (1s after the try/catch), and skips the pause only for a holdout", async () => {
    const { d } = campaignDb(3);
    vi.doMock("../lib/db-helper", () => ({ db: async () => d, dbTyped: async () => d, requireDb: async () => d }));
    vi.doMock("../sms", () => ({ sendSms, isShopGatewayReachable: async () => true, isShopGatewayConfigured: () => false }));
    sendSms
      .mockImplementationOnce(async () => { throw new Error("gateway exploded"); })
      .mockImplementationOnce(async () => HELD_OUT)
      .mockImplementationOnce(async () => ({ success: true, sid: "SM1" }));

    const { processCampaignSends } = await import("../routers/campaigns");
    await processCampaignSends(5);

    const pauses = (setTimeout as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((c) => c[1] === 1000).length;
    // errored send -> pause; holdout -> none; real send -> pause.
    expect(pauses).toBe(2);
  });
});

describe("review requests", () => {
  it("marks the request heldout (not sent, not failed) and counts it separately", async () => {
    const markReviewRequestSent = vi.fn();
    const markReviewRequestHeldOut = vi.fn();
    const markReviewRequestFailed = vi.fn();
    vi.doMock("../db", () => ({
      getReviewSettings: async () => ({ enabled: true, maxPerDay: 50, messageTemplate: null }),
      getReviewRequestsSentToday: async () => 0,
      getPendingReviewRequests: async () => [
        { id: 21, phone: "2165550142", customerName: "Pat Example", service: "Brakes", trackingToken: "tok" },
      ],
      claimReviewRequest: async () => true,
      markReviewRequestSent,
      markReviewRequestHeldOut,
      markReviewRequestFailed,
    }));
    vi.doMock("../sms", () => ({ sendSms, withOptOut: (s: string) => s, isShopGatewayReachable: async () => true }));

    const { processReviewRequestQueue } = await import("../routers/reviewRequests");
    const res = await processReviewRequestQueue();

    expect(sendSms).toHaveBeenCalledWith("+12165550142", expect.any(String), expect.objectContaining({ variantKey: "review_request" }));
    expect(markReviewRequestHeldOut).toHaveBeenCalledWith(21, "contact:lane:v1");
    expect(markReviewRequestSent).not.toHaveBeenCalled();
    expect(markReviewRequestFailed).not.toHaveBeenCalled();
    expect(res).toMatchObject({ sent: 0, queued: 0, heldOut: 1, failed: 0 });
  });
});

describe("retention", () => {
  it("counts the control as held out, not contacted, and writes no outbound row", async () => {
    const chain = (rows: unknown[]) => ({
      from: () => ({ where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) }),
    });
    let selects = 0;
    const db = {
      select: vi.fn(() => {
        selects++;
        return selects === 1
          ? chain([{ id: 9, firstName: "Pat", phone: "2165550142", vehicleYear: null, vehicleMake: null, vehicleModel: null, lastRetentionTier: null }])
          : chain([]); // no pending bookings
      }),
      update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
    };
    vi.doMock("../db", () => ({ getDb: async () => db }));
    vi.doMock("../sms", () => ({ sendSms, withOptOut: (s: string) => s }));

    const { processRetention90Day } = await import("../cron/jobs/retentionSequences");
    const res = await processRetention90Day();

    expect(sendSms).toHaveBeenCalledWith("2165550142", expect.any(String), expect.objectContaining({ variantKey: expect.stringMatching(/^retention_d90/) }));
    expect(res.recordsProcessed).toBe(0);
    expect(res.details).toMatch(/0 customers contacted, 1 holdout controls/);
    expect(logOutboundSms).not.toHaveBeenCalled();
  });
});
