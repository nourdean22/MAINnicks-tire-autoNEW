/**
 * POST /api/sync/events stores no customer identity (2026-10-19, wave 3 group 7b, review round).
 *
 * Every bridge event used to land in AuditEvent with `event.data` verbatim, so customer names, phones
 * and emails sat in the bdnick database for every booking, lead, callback, review and emergency. The
 * stored payload is now an allowlist projection: ids, counts, amounts, event facts. The coach event
 * (BrainMemory.metadata.body) and the drift bus event (BrainBusEvent.payload, plus 140 chars to
 * Inngest) are STORED text too, so they are built from scrubbed fields; only the Telegram alert
 * (a different route) may carry a name and phone. Every assertion reads what was STORED.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditCreate, auditFindMany, upsert, recordCoachEvent, processShopEvent, emitDriftFired } = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  auditFindMany: vi.fn(),
  upsert: vi.fn(),
  recordCoachEvent: vi.fn(),
  processShopEvent: vi.fn(),
  emitDriftFired: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireEvidenceAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditEvent: { create: auditCreate, findMany: auditFindMany },
    socialPublishQueue: { upsert, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    apiRequestLog: { create: vi.fn().mockResolvedValue({}) },
    errorLog: { create: vi.fn().mockResolvedValue({}) },
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/services/coach-events", () => ({ recordCoachEvent }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitDriftFired }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processShopEvent }));

import { GET, POST } from "@/app/api/sync/events/route";

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
  auditFindMany.mockReset().mockResolvedValue([]);
  upsert.mockReset().mockResolvedValue({});
  recordCoachEvent.mockReset().mockResolvedValue({ eventId: "c1" });
  emitDriftFired.mockReset().mockResolvedValue("bus1");
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

  it("a non-identity unknown key holding a name is not stored (allowlist, not denylist)", async () => {
    // `memo` and `note` do not look like identity keys, so only the allowlist can catch them.
    await post("nickstire:lead", { leadId: 1, memo: `${SURPRISE} asked twice`, note: `call ${PHONE}`, attempts: 3 });
    expect(JSON.stringify(storedPayload())).not.toContain(SURPRISE);
    expect(JSON.stringify(storedPayload())).not.toContain(PHONE);
    expect(storedPayload()).toMatchObject({ leadId: 1, attempts: 3 });
  });

  it("an array of strings is dropped; an id-shaped key (customerId) is kept", async () => {
    await post("nickstire:lead", { leadId: 2, customerId: "cus_123", attendees: [NAME, SURPRISE], tags: [{ weight: 2 }] });
    expect(JSON.stringify(storedPayload())).not.toContain(NAME);
    expect(JSON.stringify(storedPayload())).not.toContain(SURPRISE);
    expect(storedPayload()).toMatchObject({ leadId: 2, customerId: "cus_123" });
  });

  it("phones and emails inside the kept free-text keys are masked", async () => {
    await post("nickstire:lead", {
      leadId: 4,
      interest: `Alignment, call me back at (216) 555-0199 or ${EMAIL}`,
      service: `Brakes, reach 216-555-0100`,
      vehicle: `2015 Test Sedan, text ${PHONE}`,
    });
    const text = JSON.stringify(storedPayload());
    for (const leak of [PHONE, "555-0199", "555-0100", EMAIL]) expect(text).not.toContain(leak);
    expect(String(storedPayload().interest)).toContain("Alignment, call me back at");
  });

  // Codex P1 on PR 3181: scrubText masks phones and emails only, so a name written inside a customer or
  // staff sentence went straight into AuditEvent.payload. The five sentence keys are not stored at all.
  it("a name inside a sentence key (reason, description, reviewText, symptom, problem) is never stored", async () => {
    await post("nickstire:callback", {
      reason: `I'm ${NAME}, please call me back about the quote`,
      description: `${NAME}'s truck pulls left`,
      reviewText: `Great job by Sam, ${NAME} recommends them`,
      symptom: `${NAME} hears grinding when braking`,
      problem: `${NAME} is stuck on I-90`,
      urgency: "high",
      nested: { reason: `${NAME} again`, attempts: 2 },
    });
    expect(JSON.stringify(storedPayload())).not.toContain(NAME);
    expect(storedPayload()).toEqual({ urgency: "high", nested: { attempts: 2 } });
  });

  it("text and content are stored for a social draft only", async () => {
    await post("nickstire:lead", { leadId: 3, text: "free text", content: "more free text" });
    expect(storedPayload()).toEqual({ leadId: 3 });
    auditCreate.mockClear();
    await post("nickstire:social_draft:sync", { id: "d1", content: "Brake special this week", status: "pending", platforms: ["facebook"] });
    expect(storedPayload()).toMatchObject({ id: "d1", content: "Brake special this week" });
  });

  it("syncSocialDraft still mirrors the draft into the queue, content intact", async () => {
    await post("nickstire:social_draft:sync", { id: "d1", content: "Brake special this week", status: "pending", platforms: ["facebook"] });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ id: "d1", content: "Brake special this week" });
  });
});

describe("the STORED alert text (coach event, drift bus event) carries no customer identity", () => {
  it("callback: body and bus message name no customer and no phone", async () => {
    await post("nickstire:callback", { customer: NAME, phone: PHONE, reason: "Question about quote" });
    expect(recordCoachEvent).toHaveBeenCalledTimes(1);
    const body = String(recordCoachEvent.mock.calls[0][0].body);
    const bus = JSON.stringify(emitDriftFired.mock.calls[0][0]);
    for (const text of [body, bus]) {
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(PHONE);
    }
    expect(body).toContain("Callback requested");
  });

  it("negative review: body and bus message name no reviewer and carry no review text", async () => {
    await post("nickstire:review", { rating: 2, customerName: NAME, reviewText: `Rude. Call ${PHONE}` });
    expect(recordCoachEvent).toHaveBeenCalledTimes(1);
    const body = String(recordCoachEvent.mock.calls[0][0].body);
    const bus = JSON.stringify(emitDriftFired.mock.calls[0][0]);
    for (const text of [body, bus]) {
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain("Rude");
    }
    expect(body).toContain("2★");
  });

  it("CONTROL: the brain pipeline still receives the full event data in memory (it scrubs what it stores)", async () => {
    await post("nickstire:callback", { customer: NAME, phone: PHONE, reason: "Question about quote" });
    expect(processShopEvent.mock.calls[0][0].data).toMatchObject({ customer: NAME, phone: PHONE });
  });
});

describe("GET /api/sync/events scrubs rows written before the fix", () => {
  it("returns an old raw payload without names, phones or emails", async () => {
    auditFindMany.mockResolvedValue([
      {
        eventType: "nickstire:lead",
        payload: { leadId: 9, customer: NAME, phone: PHONE, email: EMAIL, memo: SURPRISE, interest: "Tires" },
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const res = await GET(new Request("http://test/api/sync/events", { headers: { authorization: "Bearer test" } }));
    const text = JSON.stringify(await res.json());
    for (const leak of [NAME, PHONE, EMAIL, SURPRISE]) expect(text).not.toContain(leak);
    expect(text).toContain("Tires");
  });

  it("returns an old row's sentence keys without the name written in them", async () => {
    auditFindMany.mockResolvedValue([
      {
        eventType: "nickstire:review",
        payload: { rating: 2, reviewText: `${NAME} waited an hour`, reason: `${NAME} asked`, urgency: "high" },
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const res = await GET(new Request("http://test/api/sync/events", { headers: { authorization: "Bearer test" } }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(NAME);
    expect(JSON.stringify(body)).toContain("high");
  });
});
