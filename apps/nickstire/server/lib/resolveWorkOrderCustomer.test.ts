import { describe, it, expect, vi, beforeEach } from "vitest";

const results: unknown[][] = [];

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(results.shift() ?? []),
        }),
      }),
    }),
  })),
}));

describe("resolveWorkOrderCustomer — numeric customerId", () => {
  beforeEach(() => {
    results.length = 0;
  });

  it("resolves a numeric customerId via the id lookup", async () => {
    results.push([{ id: 42, firstName: "Test", phone: "2165551234" }]);
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    const cust = await resolveWorkOrderCustomer(42);
    expect(cust).not.toBeNull();
    expect((cust as { id: number }).id).toBe(42);
    expect(results.length).toBe(0);
  });

  it("returns null for empty / null/ 0 input", async () => {
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    expect(await resolveWorkOrderCustomer(null)).toBeNull();
    expect(await resolveWorkOrderCustomer(0)).toBeNull();
  });
});
