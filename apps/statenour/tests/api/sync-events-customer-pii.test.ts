/**
 * POST /api/sync/events stores no customer identity (2026-10-19, wave 3 group 7b).
 *
 * Every bridge event used to land in AuditEvent with `event.data` verbatim, so customer names, phones
 * and emails sat in the bdnick database for every booking, lead, callback, review and emergency.
 * The stored payload is now an allowlist projection: ids, counts, amounts, event facts. Alerts and the
 * brain pipeline still receive the full `event.data` in memory (they need the name to alert the owner).
 * Every assertion reads what prisma was asked to STORE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditCreate, upsert, recordCoachEvent, processShopEvent } = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  upsert: vi.fn(),
  recordCoachEvent: vi.fn(),
  processShopEvent: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: auditCreate },
    socialPublishQueue: { upsert, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitDriftFired: vi.fn() }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processShopEvent }));

import { POST } from "@/app/api/sync/events/route";

const NAME = "Jane Roe";
const PHONE = "2165550199";
const EMAIL = "jane.roe@example.test";
const SURPRISE = "Sam Surprise";

function post(type: string, data: unknown) {
  return POST(
    new Request("http://test/api/sync/events", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test" },
      body: JSON.stringify({ events: [{ type, timestamp: "2026-10-19T12:00:00.000Z", source: "nickstire", data }] }),
    }),
  );
}
const storedPayload = () => auditCreate.mock.calls[0][0].data.payload as Record<string, unknown>;

beforeEach(() => {
  auditCreate.mockReset().mockResolvedValue({});
  upsert.mockReset().mockResolvedValue({});
  recordCoachEvent.mockReset().mockResolvedValue({ eventId: "c1" });
  processShopEvent.mockReset().mockResolvedValue({ processed: true, actions: [] });
});

describe("sync/events audit rows carry no customer identity", () => {
  it("drops name, phone, email and surprise identity keys; keeps the facts", async () => {
    const res = await post("nickstire:lead", {
      leadId: 9003,
      customer: NAME,
      customerName: NAME,
      phone: PHONE,
      email: EMAIL,
      contact: SURPRISE,
      callerPhone: PHONE,
      source: "web",
      urgencyScore: 3,
      interest: "Wheel alignment",
      nested: { customerEmail: EMAIL, contactName: SURPRISE, attempts: 2 },
    });
    expect(res.status).toBe(200);
    const text = JSON.stringify(storedPayload());
    for (const leak of [NAME, PHONE, EMAIL, SURPRISE]) expect(text).not.toContain(leak);
    expect(storedPayload()).toMatchObject({ leadId: 9003, source: "web", urgencyScore: 3, interest: "Wheel alignment" });
    expect(storedPayload().nested).toEqual({ attempts: 2 });
  });

  it("an event with nothing to strip is stored as sent", async () => {
    const data = { bookingId: 9001, service: "Brake inspection", vehicle: "2015 Test Sedan", urgency: "normal", refCode: "TEST01", totalAmount: 612 };
    await post("nickstire:booking", data);
    expect(storedPayload()).toEqual(data);
  });

  it("an unknown free-text string under an unknown key is not stored (allowlist, not denylist)", async () => {
    await post("nickstire:lead", { leadId: 1, whoCalled: SURPRISE, attempts: 3 });
    expect(JSON.stringify(storedPayload())).not.toContain(SURPRISE);
    expect(storedPayload()).toMatchObject({ leadId: 1, attempts: 3 });
  });

  it("the alert and the brain pipeline still receive the full event data", async () => {
    await post("nickstire:callback", { customer: NAME, phone: PHONE, reason: "Question about quote" });
    expect(recordCoachEvent.mock.calls[0][0].body).toContain(NAME);
    expect(processShopEvent.mock.calls[0][0].data).toMatchObject({ customer: NAME, phone: PHONE });
  });

  it("syncSocialDraft still mirrors the draft into the queue, content intact", async () => {
    await post("nickstire:social_draft:sync", { id: "d1", content: "Brake special this week", status: "pending", platforms: ["facebook"] });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ id: "d1", content: "Brake special this week" });
  });
});
