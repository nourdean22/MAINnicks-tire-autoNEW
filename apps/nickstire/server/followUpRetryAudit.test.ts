/**
 * followUps.retry writes an audit row that says what happened: a failed retry was logged as
 * "customer.sms_sent", so the audit trail claimed a text that never went out.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  smsResult: { success: true, sid: "SM1" } as Record<string, unknown>,
  audits: [] as Array<{ action: string }>,
}));

function fakeDb() {
  const row = { id: 42, status: "failed", recipientPhone: "2165550142", message: "Thanks for stopping in", notificationType: "thank_you" };
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ...row }] }) }) }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  };
}

vi.mock("./lib/db-helper", () => ({ db: async () => null, dbTyped: async () => fakeDb(), requireDb: async () => fakeDb() }));
vi.mock("./sms", () => ({ sendSms: async () => h.smsResult }));
vi.mock("./services/auditTrail", () => ({ logAdminAction: async (d: { action: string }) => { h.audits.push(d); } }));

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const admin = () =>
  appRouter.createCaller({
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);

beforeEach(() => {
  h.audits = [];
});

describe("followUps.retry audit action follows the outcome", () => {
  it("a failed retry is audited as customer.sms_failed, never sms_sent", async () => {
    h.smsResult = { success: false, error: "Gateway returned 502" };
    const res = await admin().followUps.retry({ id: 42 });
    expect(res).toMatchObject({ ok: false, outcome: "failed" });
    expect(h.audits.map((a) => a.action)).toEqual(["customer.sms_failed"]);
  });

  it("queued is audited as customer.sms_queued", async () => {
    h.smsResult = { success: true, queued: true };
    await admin().followUps.retry({ id: 42 });
    expect(h.audits.map((a) => a.action)).toEqual(["customer.sms_queued"]);
  });

  it("delivered is audited as customer.sms_sent", async () => {
    h.smsResult = { success: true, sid: "SM9" };
    await admin().followUps.retry({ id: 42 });
    expect(h.audits.map((a) => a.action)).toEqual(["customer.sms_sent"]);
  });
});
