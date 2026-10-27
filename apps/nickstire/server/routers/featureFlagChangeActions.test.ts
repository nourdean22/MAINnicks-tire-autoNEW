/**
 * Bug hunt 2026-10-27: Settings > pause switches show "since <date> by <who>" from the newest audit row of the flag.
 * The reader only looked for action `flag.toggled`, but the SMS panel's pause button (smsOps.setPause) writes its
 * audit row as `sms.global_pause`. So the most important switch, "Automated customer texts", read "never flipped since
 * install" (or the date of an older Settings flip) while it was paused from the SMS panel.
 *
 * This test follows the writer to the reader: whatever action smsOps.setPause writes must be an action the history
 * query asks for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("drizzle-orm");
vi.unmock("drizzle-orm/mysql-core");
vi.unmock("../../drizzle/schema");
vi.unmock("../services/featureFlags");

import { MySqlDialect } from "drizzle-orm/mysql-core";

const h = vi.hoisted(() => ({
  audited: [] as Array<{ action: string; entityType: string; entityId: string; newValue?: string }>,
  executed: [] as unknown[],
}));

const fakeDb = {
  select: () => ({ from: async () => [] }),
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  execute: async (q: unknown) => {
    h.executed.push(q);
    return [[], []];
  },
};

vi.mock("../db", () => ({ getDb: async () => fakeDb, getDbTyped: async () => fakeDb }));
vi.mock("../lib/db-helper", () => ({ db: async () => fakeDb, dbTyped: async () => fakeDb, requireDb: async () => fakeDb }));
vi.mock("../services/auditTrail", () => ({
  logAdminAction: async (a: { action: string; entityType: string; entityId: string; newValue?: string }) => {
    h.audited.push(a);
  },
}));

import { smsOpsRouter } from "./smsOps";
import { getLastFlagChanges } from "../services/featureFlags";

const ctx = {
  user: { id: 1, openId: "admin-u", email: "o@example.com", name: "O", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {} },
  res: { clearCookie: () => {} },
} as never;

beforeEach(() => {
  h.audited.length = 0;
  h.executed.length = 0;
});

describe("the flag change history asks for every action that records a flag flip", () => {
  it("smsOps.setPause's audit action is one the history query selects", async () => {
    await smsOpsRouter.createCaller(ctx).setPause({ paused: true });
    const written = h.audited.find((a) => a.entityType === "feature_flag" && a.entityId === "sms_global_pause");
    // Positive control: the writer was located and wrote the switch's new value.
    expect(written).toMatchObject({ newValue: "true" });

    h.executed.length = 0;
    await getLastFlagChanges();
    const sqlText = h.executed.map((q) => new MySqlDialect().sqlToQuery(q as never).sql).join("\n");
    expect(sqlText).toContain(`'${written!.action}'`);
    expect(sqlText).toContain("'flag.toggled'");
  });
});
