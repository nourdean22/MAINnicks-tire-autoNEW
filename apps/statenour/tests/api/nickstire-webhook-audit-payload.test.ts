/**
 * 07-SN-08 (audit round 3) - the nickstire webhook stored the whole event
 * payload in AuditEvent, so every lead's phone number and name sat in an
 * audit table forever. The audit row now keeps the field names and the ids
 * needed to find the source record, nothing a customer typed.
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

describe("nickstire webhook audit row carries no customer PII", () => {
  it("a lead's phone and name are not in the audit payload", async () => {
    await send("nickstire:lead", { leadId: 9003, customer: "Pat Customer", phone: "2165550100", interest: "brakes" });
    const payload = JSON.stringify((h.auditCreate.mock.calls[0]?.[0] as { data: { payload: unknown } }).data.payload);
    expect(payload).not.toContain("2165550100");
    expect(payload).not.toContain("Pat Customer");
  });

  it("CONTROL - the ids and field names survive, so the row still finds its source", async () => {
    await send("nickstire:invoice", { invoiceNumber: "INV-1", bookingId: 7, customer: "Pat Customer", totalAmount: 250 });
    const payload = (h.auditCreate.mock.calls[0]?.[0] as { data: { payload: Record<string, unknown> } }).data.payload;
    expect(payload).toMatchObject({ ids: { invoiceNumber: "INV-1", bookingId: 7 } });
    expect(payload.keys).toEqual(expect.arrayContaining(["invoiceNumber", "bookingId", "customer", "totalAmount"]));
  });
});
