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

describe("getTrackingInfo — IDOR fail-closed (code-underneath audit, data #6)", () => {
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

  it("returns null for a WALK-IN customer_id (no phone) — the original leak path", async () => {
    mockWhere.mockResolvedValueOnce([{ ...baseWo, customerId: "WALK-IN" }]); // workOrders
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "5551234567")).toBeNull();
  });

  it("returns null for a phone-string customer_id when the caller's phone does NOT match (IDOR closed)", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: "2169999999" }]) // workOrders
      .mockResolvedValueOnce([]); // customers lookup (no id 2169999999)
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "5551234567")).toBeNull();
  });

  it("returns null for a numeric customer_id when the phone does NOT match", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: "381" }]) // workOrders
      .mockResolvedValueOnce([{ id: 381, phone: "2165550000" }]); // customers (wrong phone)
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-ABC", "5551234567")).toBeNull();
  });

  it("returns null when the order number is unknown", async () => {
    mockWhere.mockResolvedValueOnce([]); // workOrders -> none
    const { getTrackingInfo } = await import("./customerMessaging");
    expect(await getTrackingInfo("WO-NOPE", "2165550000")).toBeNull();
  });

  it("returns tracking for a walk-in whose customer_id IS the matching phone (legit, not over-denied)", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: "2165550000" }]) // workOrders
      .mockResolvedValueOnce([]) // customers (no id 2165550000)
      .mockResolvedValueOnce([{ description: "Oil change", type: "service" }]); // items
    const { getTrackingInfo } = await import("./customerMessaging");
    const res = await getTrackingInfo("WO-ABC", "(216) 555-0000");
    expect(res).not.toBeNull();
    expect(res?.orderNumber).toBe("WO-ABC");
    expect(res?.services).toContain("Oil change");
  });

  it("returns tracking for a numeric customer_id with the matching phone (legit)", async () => {
    mockWhere
      .mockResolvedValueOnce([{ ...baseWo, customerId: "381" }]) // workOrders
      .mockResolvedValueOnce([{ id: 381, phone: "2165550000" }]) // customers (right phone)
      .mockResolvedValueOnce([{ description: "Brake pads", type: "service" }]); // items
    const { getTrackingInfo } = await import("./customerMessaging");
    const res = await getTrackingInfo("WO-ABC", "216-555-0000");
    expect(res).not.toBeNull();
    expect(res?.statusKey).toBe("in_progress");
  });
});
