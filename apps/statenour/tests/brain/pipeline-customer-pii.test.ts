/**
 * processShopEvent stores no customer name or phone in BrainMemory (2026-10-18, wave 3 group 7).
 *
 * Before: `Shop ${type}: ${JSON.stringify(event.data)}` wrote the whole bridge payload (customer,
 * phone) into business_event, `Phone call from ${phone}` and `New lead from ${source}: ${name}`
 * wrote them into insight rows. 18 of 27 business_event rows held a phone-shaped string.
 * Assertions read what brainMemory.remember was asked to STORE.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { remember, queryNick, queryNickBatch, connect } = vi.hoisted(() => ({
  remember: vi.fn(),
  queryNick: vi.fn(),
  queryNickBatch: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/nickstire/revenue", () => ({ readNickRevenue: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember } }));
vi.mock("@/lib/brain/relational-graph", () => ({ connect }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => vi.fn() }));
vi.mock("@/lib/nickstire/query", async (orig) => ({
  readBridge: (await orig<typeof import("@/lib/nickstire/query")>()).readBridge,
  queryNick,
  queryNickBatch,
}));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { processShopEvent } from "@/lib/brain/pipeline-controller";

const NAME = "Jane Roe";
const PHONE = "2165550199";

const storedText = () => JSON.stringify(remember.mock.calls.map((c) => [c[0], c[1], c[2]]));

beforeEach(() => {
  remember.mockReset().mockResolvedValue(undefined);
  connect.mockReset().mockResolvedValue(undefined);
  queryNick.mockReset().mockResolvedValue({ data: { customers: [{ totalVisits: 3, totalSpent: 1200, segment: "loyal" }] } });
  queryNickBatch.mockReset().mockResolvedValue({});
});

describe("processShopEvent keeps customer identity out of stored memory", () => {
  it.each([
    ["lead", { leadId: 1, customer: NAME, name: NAME, phone: PHONE, source: "web", interest: "Wheel alignment" }],
    ["booking", { bookingId: 2, customer: NAME, phone: PHONE, service: "Brake inspection", vehicle: "2015 Test Sedan" }],
    ["emergency", { name: NAME, phone: PHONE, description: "Flat tire on the highway", urgency: "high" }],
    ["call", { phone: PHONE, durationSeconds: 61, endedReason: "hangup", serviceMention: "tires" }],
  ] as const)("%s: no name and no phone in any remember() call", async (type, data) => {
    await processShopEvent({ type, data });
    expect(remember).toHaveBeenCalled();
    const text = storedText();
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(PHONE);
  });

  it("keeps the business facts: type, source, interest, duration, reason", async () => {
    await processShopEvent({ type: "lead", data: { customer: NAME, phone: PHONE, source: "web", interest: "Wheel alignment" } });
    await processShopEvent({ type: "call", data: { phone: PHONE, durationSeconds: 61, endedReason: "hangup", serviceMention: "tires" } });
    const contents = remember.mock.calls.map((c) => String(c[2]));
    expect(contents).toContain("New lead from web — Wheel alignment");
    expect(contents.some((c) => c.startsWith("Shop lead:") && c.includes("Wheel alignment"))).toBe(true);
    expect(contents).toContain("Phone call ended. Duration: 61s. Reason: hangup. Mentioned: tires.");
  });

  it("the repeat-customer lookup still searches by the real name (transient, never stored)", async () => {
    await processShopEvent({ type: "lead", data: { customer: NAME, source: "web" } });
    expect(queryNick).toHaveBeenCalledWith("customer_search", { term: NAME });
    expect(remember.mock.calls.map((c) => String(c[2])).some((c) => c.startsWith("REPEAT CUSTOMER"))).toBe(true);
  });
});
