import { describe, it, expect, vi, beforeEach } from "vitest";

// getTrackingInfo resolves the DB via `await import("../db")` (getDb) inside
// getDbAndSchema(); the real drizzle schema (table defs) loads fine. We only
// mock getDb so each `.select().from().where()` resolves to a queued result.
const mockWhere = vi.fn();
vi.mock("../db", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => mockWhere(...args),
      }),
    }),
  })),
}));

describe("getTrackingInfo — IDOR fail-closed (post-migration 0070, customerId is int|null)", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseWo = {
    id: 1,
    orderNumber: "WO-ABC",
    status: "in_progress",
    vehicleYear: "2018",
    vehicleMake: "Honda",
    vehicleModel: "Civic",
    serviceDescription: "Oil change",
    promisedAt: null,
    estimatedCompletion: null,
    createdAt: new Date("2026-06-01T12:00:00Z"),
  };

  it("returns null for a null customerId (walk-in) — cannot verify phone", async () => {
    mockWhere.mockResolvedValueOnce([{ ...baseWo, customerId: null }]); // workOrders
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "5551234567")).toBeNull();
  });

  it("returns null for a numeric customerId when the phone does NOT match", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: 381 }]) // workOrders
      .mockResolvedValueOnce([{ id: 381, phone: "2165550000" }]); // customers (wrong phone)
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "5551234567")).toBeNull();
  });

  it("returns null when the customer ID points to a non-existent customer", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: 99999 }]) // workOrders
      .mockResolvedValueOnce([]); // customers — no match
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "5551234567")).toBeNull();
  });

  it("returns null when the order number is unknown", async () => {
    mockWhere.mockResolvedValueOnce([]); // workOrders -> none
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-NOPE", "2165550000")).toBeNull();
  });

  it("returns tracking for a numeric customerId with the matching phone (legit)", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: 381 }]) // workOrders
      .mockResolvedValueOnce([{ id: 381, phone: "2165550000" }]) // customers (right phone)
      .mockResolvedValueOnce([{ description: "Brake pads", type: "service" }]); // items
    const { getTrackingInfo } = await import("./customerMessaging");
    const res = await getTrackingInfo("WO-ABC", "216-555-0000");
    expect(res).not.toBeNull();
    expect(res?.statusKey).toBe("in_progress");
  });

  it("returns null when phone is too short (< 10 digits)", async () => {
    mockWhere.mockResolvedValueOnce([{ ...baseWo, customerId: 381 }]); // workOrders
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "555")).toBeNull();
  });
});
