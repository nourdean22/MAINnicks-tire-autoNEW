/**
 * ROS-083 · the tire cockpit must not report a clear pipeline it cannot see.
 *
 * TireOrdersSection already HAD the right error branch — it renders "Failed to
 * load orders" on `isError`. The branch could never fire, because the router
 * returned `{ orders: [], total: 0 }` on an unreadable database: tRPC resolves
 * HTTP 200, react-query keeps `isError` false, and the operator got the empty
 * state — "No tire orders found" — about paid orders the shop may be sitting on.
 * The six metric tiles were worse: they read `stats?.x ?? 0` with no error
 * channel at all, so a failed read painted five zeroed pipeline stages and
 * "Tire Revenue $0".
 *
 * So the fix is server-side by necessity, and these pin it there. Mutation-
 * verified: restoring either early return turns its cases red.
 *
 * Deliberately NOT covered here, because deliberately NOT changed: every
 * publicProcedure on this router (publicStats, checkOrder, placeOrder,
 * createCheckout, getTireMarkup) still degrades quietly. Those render on
 * customer pages and sit on the order path — a thrown error there costs a sale,
 * while a missing social-proof line costs nothing. The asymmetry is the point:
 * an operator needs to know the number is unknown, a customer does not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("./lib/db-helper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/db-helper")>();
  return { ...actual, db: getDb };
});

beforeEach(() => {
  getDb.mockReset().mockResolvedValue(null); // DB unavailable
});

/** Pull a procedure's resolver out of a built tRPC router. */
async function callQuery(router: unknown, path: string, input?: unknown) {
  const proc = (router as Record<string, { _def?: { resolver?: unknown } }>)[path];
  const resolver = (proc as { _def: { resolver: (o: unknown) => unknown } })._def.resolver;
  return resolver({ input, ctx: {}, type: "query", path });
}

describe("listOrders · DB-down is not 'No tire orders found'", () => {
  it("throws instead of resolving an empty order list", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    await expect(callQuery(gatewayTireRouter, "listOrders", { limit: 100 })).rejects.toBeInstanceOf(TRPCError);
  });

  it("says unknown, not empty — so the existing isError branch is what renders", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    await expect(callQuery(gatewayTireRouter, "listOrders", { limit: 100 })).rejects.toThrow(/unknown, not empty/i);
  });
});

describe("orderStats · DB-down is not six zeros and $0 revenue", () => {
  it("throws instead of resolving an all-zero stats payload", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    await expect(callQuery(gatewayTireRouter, "orderStats")).rejects.toBeInstanceOf(TRPCError);
  });

  it("names revenue explicitly — the tile the operator reads as money", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    await expect(callQuery(gatewayTireRouter, "orderStats")).rejects.toThrow(/revenue are unknown, not zero/i);
  });

  it("reports SERVICE_UNAVAILABLE, not a generic 500", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    for (const path of ["listOrders", "orderStats"]) {
      await expect(callQuery(gatewayTireRouter, path, path === "listOrders" ? { limit: 100 } : undefined))
        .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
  });
});

describe("the customer-facing half stays quiet on purpose", () => {
  it("publicStats still returns zeros rather than throwing at a shopper", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    await expect(callQuery(gatewayTireRouter, "publicStats")).resolves.toMatchObject({
      ordersThisWeek: 0,
      installedThisWeek: 0,
      popularSize: null,
    });
  });

  it("checkOrder still resolves null rather than throwing on the tracking page", async () => {
    const { gatewayTireRouter } = await import("./routers/gatewayTire");
    await expect(callQuery(gatewayTireRouter, "checkOrder", { orderNumber: "TO-0001" })).resolves.toBeNull();
  });
});
