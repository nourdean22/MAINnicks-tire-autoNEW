/**
 * Telegram job, lane 2 (2026-10-17) - nickstire's own event bus already sends
 * lead, callback, booking and job-complete to Telegram (#3089), so statenour's
 * bridge copy buzzed Nour twice for one event. The bridge still records each
 * event (audit row); only the Telegram send is gone. Emergency and review keep
 * their statenour alert (emergency carries the retry-on-undelivered contract).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auditCreate: vi.fn(async (..._a: unknown[]) => ({})),
  sendTelegram: vi.fn(async (..._a: unknown[]) => true),
}));

vi.mock("@/lib/auth-guard", () => ({ requireSyncAuth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create: h.auditCreate } } }));
vi.mock("@/lib/services/telegram", async (orig) => ({
  ...(await orig<typeof import("@/lib/services/telegram")>()),
  sendTelegram: h.sendTelegram,
}));

import { POST } from "@/app/api/webhooks/nickstire/route";

const send = (type: string, data: Record<string, unknown>) =>
  POST(
    new Request("http://test/api/webhooks/nickstire", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ events: [{ type, data }] }),
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe("nickstire bridge sends no duplicate Telegram copy", () => {
  it.each([
    ["nickstire:lead", { leadId: 1, customer: "Test Customer", phone: "2165550101", interest: "brakes" }],
    ["nickstire:callback", { customer: "Test Customer", phone: "2165550102", reason: "quote" }],
    ["nickstire:booking:complete", { bookingId: 2, customer: "Test Customer", totalAmount: 120 }],
    ["nickstire:invoice", { invoiceNumber: "INV-1", customer: "Test Customer", totalAmount: 390 }],
  ])("%s: zero statenour Telegram sends, the event is still recorded", async (type, data) => {
    const res = await send(type, data);
    expect(res.status).toBe(200);
    expect(h.sendTelegram).not.toHaveBeenCalled();
    expect(h.auditCreate).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ type, action: "recorded" });
  });

  it("CONTROL - an emergency still reaches Telegram from statenour", async () => {
    await send("nickstire:emergency", { name: "Test Customer", phone: "2165550104", description: "flat" });
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("CONTROL - a review still reaches Telegram from statenour", async () => {
    await send("nickstire:review", { rating: 2, customerName: "Test Reviewer", reviewText: "slow" });
    expect(h.sendTelegram).toHaveBeenCalledTimes(1);
  });
});
