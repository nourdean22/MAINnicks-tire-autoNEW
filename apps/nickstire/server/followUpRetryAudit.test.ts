/**
 * followUps.retry writes an audit row that says what happened: a failed retry was logged as
 * "customer.sms_sent", so the audit trail claimed a text that never went out.
 *
 * vi.doMock per test + vi.doUnmock in afterEach, router imported after the mocks: doMocks are NOT
 * file-scoped under singleFork (apps/nickstire/AGENTS.md §3), and a hoisted vi.mock of the db
 * helper, sms and the audit trail would leak into every file that runs after this one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const DOMOCKED = ["./lib/db-helper", "./sms", "./services/auditTrail"];
let smsResult: Record<string, unknown> = { success: true, sid: "SM1" };
let audits: Array<{ action: string }> = [];

function fakeDb() {
  const row = { id: 42, status: "failed", recipientPhone: "2165550142", message: "Thanks for stopping in", notificationType: "thank_you" };
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ...row }] }) }) }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  };
}

beforeEach(() => {
  vi.resetModules();
  audits = [];
  vi.doMock("./lib/db-helper", () => ({ db: async () => null, dbTyped: async () => fakeDb(), requireDb: async () => fakeDb() }));
  vi.doMock("./sms", () => ({ sendSms: async () => smsResult }));
  vi.doMock("./services/auditTrail", () => ({ logAdminAction: async (d: { action: string }) => { audits.push(d); } }));
});

afterEach(() => {
  for (const m of DOMOCKED) vi.doUnmock(m);
  vi.resetModules();
});

async function admin() {
  const { appRouter } = await import("./routers");
  return appRouter.createCaller({
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext);
}

describe("followUps.retry audit action follows the outcome", () => {
  it("a failed retry is audited as customer.sms_failed, never sms_sent", async () => {
    smsResult = { success: false, error: "Gateway returned 502" };
    const res = await (await admin()).followUps.retry({ id: 42 });
    expect(res).toMatchObject({ ok: false, outcome: "failed" });
    expect(audits.map((a) => a.action)).toEqual(["customer.sms_failed"]);
  });

  it("queued is audited as customer.sms_queued", async () => {
    smsResult = { success: true, queued: true };
    await (await admin()).followUps.retry({ id: 42 });
    expect(audits.map((a) => a.action)).toEqual(["customer.sms_queued"]);
  });

  it("delivered is audited as customer.sms_sent", async () => {
    smsResult = { success: true, sid: "SM9" };
    await (await admin()).followUps.retry({ id: 42 });
    expect(audits.map((a) => a.action)).toEqual(["customer.sms_sent"]);
  });
});
