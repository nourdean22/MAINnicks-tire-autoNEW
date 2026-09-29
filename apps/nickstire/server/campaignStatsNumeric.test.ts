/**
 * Campaign progress stats must come back as NUMBERS (Q-21 review P1-1).
 *
 * `sum(case ...)` is a DECIMAL aggregate. The mysql2 pool does not set
 * `decimalNumbers`, so the driver hands it back as a STRING — the same trap
 * intelligenceEngines.ts documents. CampaignsSection adds
 * `stats.sent + stats.heldOut + stats.failed`, so 6 sent / 0 held out /
 * 3 failed of 10 rendered "603/10 · 6030%".
 *
 * The fix is at the source (`.mapWith(Number)`), so this test drives the REAL
 * drizzle mapper over a fake mysql2 client that returns what the driver
 * returns: strings. A stub of the drizzle chain would hand back whatever the
 * test chose and could never see the bug.
 */
import { describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableColumns } from "drizzle-orm";
import { smsCampaigns } from "../drizzle/schema";

const CAMPAIGN_ID = 7;

/** One smsCampaigns row, positional, as mysql2 returns it with rowsAsArray. */
function campaignRowArray(): unknown[] {
  return Object.keys(getTableColumns(smsCampaigns)).map((k) => {
    if (k === "id") return CAMPAIGN_ID;
    if (k === "name") return "Fall tire check";
    if (k === "status") return "active";
    if (k === "createdAt" || k === "updatedAt") return "2026-09-29 12:00:00";
    return null;
  });
}

const fakeClient = {
  query: vi.fn(async (q: { sql: string } | string) => {
    const text = typeof q === "string" ? q : q.sql;
    if (/from `sms_campaign_sends`/i.test(text)) {
      // DECIMAL aggregates arrive as strings from mysql2.
      if (/group by/i.test(text)) return [[[CAMPAIGN_ID, "6", "0", "3", "1"]], []];
      return [[["6", "0", "3", "1"]], []];
    }
    return [[campaignRowArray()], []];
  }),
};
const realDrizzle = drizzle(fakeClient as never);

vi.mock("./lib/db-helper", () => ({
  db: async () => realDrizzle,
  dbTyped: async () => realDrizzle,
  requireDb: async () => realDrizzle,
}));

import { campaignsRouter } from "./routers/campaigns";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

describe("campaign send stats are numbers, not driver strings", () => {
  it("list: sent + heldOut + failed adds arithmetically (9), never concatenates ('603')", async () => {
    const rows = await campaignsRouter.createCaller(ctx()).list();
    const stats = rows[0].stats;
    expect(stats).toMatchObject({ sent: 6, heldOut: 0, failed: 3, pending: 1 });
    for (const v of [stats.sent, stats.heldOut, stats.failed, stats.pending]) {
      expect(typeof v).toBe("number");
    }
    expect(stats.sent + stats.heldOut + stats.failed).toBe(9);
  });

  it("getById: the detail view's stats are numbers too", async () => {
    const res = await campaignsRouter.createCaller(ctx()).getById({ id: CAMPAIGN_ID });
    const stats = res!.stats;
    expect(stats).toMatchObject({ sent: 6, heldOut: 0, failed: 3, pending: 1 });
    expect(stats.sent + stats.heldOut + stats.failed).toBe(9);
  });
});
