/**
 * tests/services/vehicle-customer-link.test.ts · 2026-09-08 (ADR-0017)
 *
 * A confirmed arrival with a plate asks nickstire who it is. Pinned: a match
 * lands as customerRef.status=matched and extends the Telegram alert; no
 * match is "unmatched"; a bridge failure is "lookup_failed" (never a
 * confident "unmatched"); nothing here ever throws into the ingest path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, mockQueryNick, mockEdit } = vi.hoisted(() => ({
  db: { deviceEvent: { findUnique: vi.fn(), update: vi.fn() } },
  mockQueryNick: vi.fn(),
  mockEdit: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/nickstire/query", () => ({ queryNick: mockQueryNick }));
vi.mock("@/lib/services/telegram", () => ({ editTelegramMessage: mockEdit }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { linkVisitToCustomer, lookupPlate } from "@/lib/services/vehicle-customer-link";

const MATCH = {
  source: "memberships",
  membershipId: 7,
  name: "Jane Member",
  phoneMasked: "***-0199",
  plate: "ABC1234",
  exact: true,
  vehicleDesc: "2019 Civic",
  membershipStatus: "active",
  bookingsToday: [{ id: 42, service: "Oil change", status: "confirmed", linkage: "phone+name" }],
};

describe("vehicle-customer-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.deviceEvent.findUnique.mockResolvedValue({ id: "evt_1", data: { state: "CONFIRMED_ARRIVAL", plate: { text: "ABC 1234" } } });
    db.deviceEvent.update.mockResolvedValue({});
    mockEdit.mockResolvedValue(true);
  });

  it("stores a match as customerRef and appends the customer line to the alert", async () => {
    mockQueryNick.mockResolvedValue({ query: "vehicle_lookup_by_plate", timestamp: "t", data: { normalized: "ABC1234", matches: [MATCH], count: 1 } });
    await linkVisitToCustomer({ eventId: "evt_1", plate: "ABC 1234", telegramMessageId: "999", alertText: "ALERT" });
    expect(mockQueryNick).toHaveBeenCalledWith("vehicle_lookup_by_plate", { plate: "ABC 1234" }, 6000);
    expect(db.deviceEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "evt_1" },
        data: { data: expect.objectContaining({ customerRef: expect.objectContaining({ status: "matched", normalized: "ABC1234", plate: "ABC 1234" }) }) },
      }),
    );
    expect(mockEdit).toHaveBeenCalledWith(999, expect.stringContaining("Jane Member (***-0199)"), undefined, undefined);
    expect(mockEdit.mock.calls[0][1]).toContain("booked today: Oil change");
  });

  it("no match is recorded as unmatched and the alert is left alone", async () => {
    db.deviceEvent.findUnique.mockResolvedValue({ id: "evt_1", data: { plate: { text: "ZZZ 9999" } } });
    mockQueryNick.mockResolvedValue({ query: "vehicle_lookup_by_plate", timestamp: "t", data: { normalized: "ZZZ9999", matches: [], count: 0 } });
    await linkVisitToCustomer({ eventId: "evt_1", plate: "ZZZ9999", telegramMessageId: "999", alertText: "ALERT" });
    const written = db.deviceEvent.update.mock.calls[0][0].data.data.customerRef;
    expect(written.status).toBe("unmatched");
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("a bridge failure is lookup_failed, never a confident unmatched, and never throws", async () => {
    mockQueryNick.mockResolvedValue({ error: "Unknown query: vehicle_lookup_by_plate", statusCode: 400 });
    await expect(linkVisitToCustomer({ eventId: "evt_1", plate: "ABC1234" })).resolves.toBeUndefined();
    const written = db.deviceEvent.update.mock.calls[0][0].data.data.customerRef;
    expect(written).toMatchObject({ status: "lookup_failed", plate: "ABC1234", error: expect.stringContaining("Unknown query") });
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("an in-flight lookup for a plate the row no longer carries is discarded (the corrected read wins)", async () => {
    db.deviceEvent.findUnique.mockResolvedValue({ id: "evt_1", data: { plate: { text: "XYZ 5555", normalizedText: "XYZ5555" } } });
    mockQueryNick.mockResolvedValue({ query: "vehicle_lookup_by_plate", timestamp: "t", data: { normalized: "ABC1234", matches: [MATCH], count: 1 } });
    await linkVisitToCustomer({ eventId: "evt_1", plate: "ABC1234", telegramMessageId: "999", alertText: "ALERT" });
    expect(db.deviceEvent.update).not.toHaveBeenCalled();
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it("a phone-only booking is shown as unconfirmed and never exposes the service", async () => {
    const phoneOnly = { ...MATCH, bookingsToday: [{ id: 9, status: "new", preferredDate: "2026-09-08", linkage: "phone_only" }] };
    mockQueryNick.mockResolvedValue({ query: "vehicle_lookup_by_plate", timestamp: "t", data: { normalized: "ABC1234", matches: [phoneOnly], count: 1 } });
    await linkVisitToCustomer({ eventId: "evt_1", plate: "ABC 1234", telegramMessageId: "999", alertText: "ALERT" });
    const text = mockEdit.mock.calls[0][1] as string;
    expect(text).toContain("same phone, unconfirmed");
    expect(text).not.toContain("booked today");
  });

  it("a thrown prisma error is swallowed (ingest must not fail on enrichment)", async () => {
    mockQueryNick.mockResolvedValue({ query: "q", timestamp: "t", data: { matches: [] } });
    db.deviceEvent.findUnique.mockRejectedValue(new Error("db down"));
    await expect(linkVisitToCustomer({ eventId: "evt_1", plate: "ABC1234" })).resolves.toBeUndefined();
  });

  it("lookupPlate maps the bridge envelope", async () => {
    mockQueryNick.mockResolvedValue({ query: "q", timestamp: "t", data: { normalized: "A1", matches: [MATCH] } });
    const r = await lookupPlate("a-1");
    expect(r).toEqual({ ok: true, normalized: "A1", matches: [MATCH] });
  });
});
