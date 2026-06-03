import { describe, it, expect, vi, beforeEach } from "vitest";

// Queue of results returned by each `.limit(1)` in call order. The resolver
// makes up to two queries (id lookup, then phone lookup); we control what each
// returns to assert which path it takes.
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

describe("resolveWorkOrderCustomer — polymorphic customer_id (wave-182)", () => {
  beforeEach(() => {
    results.length = 0;
  });

  it("resolves a numeric customer_id via the id lookup (one query)", async () => {
    results.push([{ id: 42, firstName: "Test", phone: "2165551234" }]); // id lookup hit
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    const cust = await resolveWorkOrderCustomer("42");
    expect(cust).not.toBeNull();
    expect((cust as { id: number }).id).toBe(42);
    // phone fallback must NOT have run — only one result consumed
    expect(results.length).toBe(0);
  });

  it("resolves a phone-string customer_id via the phone fallback (AI-chat walk-in)", async () => {
    results.push([]); // id lookup (id=2168620005) misses
    results.push([{ id: 7, firstName: "Walk", phone: "2168620005" }]); // phone match hits
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    const cust = await resolveWorkOrderCustomer("2168620005");
    expect(cust).not.toBeNull();
    expect((cust as { id: number }).id).toBe(7);
  });

  it("returns null for the WALK-IN sentinel (no id, no digits — no query)", async () => {
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    expect(await resolveWorkOrderCustomer("WALK-IN")).toBeNull();
    expect(results.length).toBe(0); // never queried
  });

  it("returns null for empty / null input", async () => {
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    expect(await resolveWorkOrderCustomer(null)).toBeNull();
    expect(await resolveWorkOrderCustomer("")).toBeNull();
  });

  it("returns null when a phone-string resolves to no customer", async () => {
    results.push([]); // id lookup miss
    results.push([]); // phone lookup miss
    const { resolveWorkOrderCustomer } = await import("./resolveWorkOrderCustomer");
    expect(await resolveWorkOrderCustomer("2169998888")).toBeNull();
  });
});
