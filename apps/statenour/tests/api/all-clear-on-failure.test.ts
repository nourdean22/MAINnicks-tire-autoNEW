/**
 * tests/api/all-clear-on-failure.test.ts · ROS-083 sibling wave (2026-08-03).
 *
 * One rule, three surfaces: A SUCCESS VALUE MUST BE DERIVED FROM AN OBSERVED
 * OUTCOME, NEVER FROM AN INPUT OR A DISCARDED BOOLEAN.
 *
 * · webhooks/nickstire — `sendTelegram` reports failure by RETURNING false and
 *   never throws (lib/services/telegram.ts:19,27,49,55), so `notifyOrLog`'s
 *   catch was unreachable: `telegram_alert_failed` never emitted, every event
 *   recorded status "sent", and the documented emergency 500→retry was dead
 *   code twice over (the per-event isolation catch would have eaten a throw).
 *
 * · email-send — `sendEmail` returns null when Resend is unconfigured, yet an
 *   "email_sent" audit row was written and `ok` was typed as the LITERAL true,
 *   so no caller could branch on failure.
 *
 * · drafts — approve/schedule overwrote status with no state guard. Moving a
 *   row the publish worker holds in "rendering" trips its finalize lock, so a
 *   post that DID go live never records publishedAt, and the row returns to the
 *   claim set where the next dispatch double-posts it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendTelegram, sendEmail, auditCreate, findFirst, findUnique, updateMany } = vi.hoisted(() => ({
  sendTelegram: vi.fn(),
  sendEmail: vi.fn(),
  auditCreate: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: auditCreate },
    socialPublishQueue: { findFirst, findUnique, updateMany, update: vi.fn(), create: vi.fn() },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/services/telegram", () => ({
  sendTelegram,
  formatTelegramNotification: (t: string, b: string) => `${t}\n${b}`,
}));

vi.mock("@/lib/services/email", () => ({ sendEmail }));

import { POST as webhookPOST } from "@/app/api/webhooks/nickstire/route";
import { sendEmailWithAudit } from "@/lib/services/email-send";
import { approveDraft, markScheduled, DraftStateError } from "@/lib/content/drafts";

function webhook(events: unknown[]): Promise<Response> {
  return webhookPOST(
    new Request("http://test/api/webhooks/nickstire", {
      method: "POST",
      body: JSON.stringify({ events }),
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  sendTelegram.mockReset().mockResolvedValue(true);
  sendEmail.mockReset().mockResolvedValue("msg_123");
  auditCreate.mockReset().mockResolvedValue({});
  findFirst.mockReset();
  findUnique.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe("webhooks/nickstire · telegram delivery is observed, not assumed", () => {
  it("records 'sent' only when Telegram actually accepted it", async () => {
    const res = await webhook([{ type: "nickstire:lead", data: { name: "Moe" } }]);
    const body = await res.json();
    expect(body.results[0].status).toBe("sent");
  });

  it("records 'undelivered' when sendTelegram returns false — it never throws", async () => {
    sendTelegram.mockResolvedValue(false);
    const res = await webhook([{ type: "nickstire:lead", data: { name: "Moe" } }]);
    const body = await res.json();
    expect(body.results[0].status).toBe("undelivered");
  });

  it("an UNDELIVERED EMERGENCY answers non-2xx so nickstire retries", async () => {
    sendTelegram.mockResolvedValue(false);
    const res = await webhook([
      { type: "nickstire:emergency", data: { name: "Moe", phone: "216" } },
    ]);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("emergency_alert_undelivered");
  });

  it("a DELIVERED emergency still returns 200", async () => {
    const res = await webhook([{ type: "nickstire:emergency", data: { name: "Moe" } }]);
    expect(res.status).toBe(200);
  });

  it("a non-emergency failure does not 500 the batch (isolation preserved)", async () => {
    sendTelegram.mockResolvedValue(false);
    const res = await webhook([{ type: "nickstire:review", data: { rating: 5 } }]);
    expect(res.status).toBe(200);
  });
});

describe("email-send · ok reflects whether Resend took the message", () => {
  it("reports ok:true and audits email_sent on a real send", async () => {
    const res = await sendEmailWithAudit({ to: "a@b.c", subject: "hi", body: "x" });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(false);
    expect(auditCreate.mock.calls[0][0].data.eventType).toBe("email_sent");
  });

  it("reports ok:false when the provider is unconfigured (sendEmail → null)", async () => {
    sendEmail.mockResolvedValue(null);
    const res = await sendEmailWithAudit({ to: "a@b.c", subject: "hi", body: "x" });
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    // The audit trail must not claim a delivery that never happened.
    expect(auditCreate.mock.calls[0][0].data.eventType).toBe("email_send_skipped");
  });
});

describe("drafts · operator actions cannot re-state a row a worker owns", () => {
  it("refuses to approve a row the publish worker holds in 'rendering'", async () => {
    findFirst.mockResolvedValue({ id: "d1", status: "rendering", deletedAt: null });
    await expect(approveDraft("d1")).rejects.toBeInstanceOf(DraftStateError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses to schedule a row the publish worker holds in 'rendering'", async () => {
    findFirst.mockResolvedValue({ id: "d1", status: "rendering", deletedAt: null });
    await expect(markScheduled("d1", new Date().toISOString())).rejects.toBeInstanceOf(
      DraftStateError,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuses to approve an already-published row", async () => {
    findFirst.mockResolvedValue({ id: "d1", status: "published", deletedAt: null });
    await expect(approveDraft("d1")).rejects.toBeInstanceOf(DraftStateError);
  });

  it("still allows re-approving a rejected draft — that is a legitimate retry", async () => {
    findFirst.mockResolvedValue({ id: "d1", status: "rejected", deletedAt: null });
    findUnique.mockResolvedValue({
      id: "d1",
      status: "approved",
      content: "c",
      platforms: [],
      kind: "post",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(approveDraft("d1")).resolves.toBeTruthy();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("throws when the compare-and-set loses the race (count !== 1)", async () => {
    findFirst.mockResolvedValue({ id: "d1", status: "pending", deletedAt: null });
    updateMany.mockResolvedValue({ count: 0 });
    await expect(approveDraft("d1")).rejects.toBeInstanceOf(DraftStateError);
  });
});
