/**
 * A quote-by-text row is a lead, never an order (Codex review on PR #3157).
 *
 * Quotes share tire_orders with real orders so the shop sees them in one tab, but a
 * client-priced quote row must never reach money or metrics:
 *   - createCheckout refuses a TQ- number before any DB read (an attacker who quotes a
 *     $50 "Michelin" and then calls checkout with the number gets no Stripe session);
 *   - the Kafene lease lookups answer null for a TQ- number, so start / applyStarted /
 *     attach / markSigned all say not_found;
 *   - placeOrder's five-minute dedupe, publicStats and orderStats carry the ORDER_ROWS
 *     filter, so a quote neither swallows the customer's real order nor inflates the
 *     order count or "Tire Revenue" (pinned on the source, like formLimiterCoverage).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateQuoteNumber, isQuoteNumber, QUOTE_NUMBER_PREFIX } from "../lib/tire-order-guards";

vi.mock("../lib/adminActivity", () => ({ touchAdminActivity: () => undefined }));
vi.mock("../services/adminSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/adminSecurity")>();
  return { ...actual, getAdminSecurityState: async () => ({ ...actual.MFA_NOT_REQUIRED_STATE }) };
});
/** A DB handle that fails the test if any query runs: the refusals must come first. */
const neverQueried = new Proxy({}, { get: (_t, p) => { throw new Error(`DB touched via ${String(p)}`); } });
vi.mock("../lib/db-helper", () => ({
  db: async () => neverQueried,
  dbTyped: async () => neverQueried,
}));

const QUOTE = "TQ-20261018-123";
const ORDER = "TO-20261018-123";

describe("quote numbers", () => {
  it("generateQuoteNumber: TQ- plus the order-number tail; isQuoteNumber tells them apart", () => {
    const n = generateQuoteNumber(new Date("2026-10-18T12:00:00Z"));
    expect(n).toMatch(/^TQ-20261018-\d{3}$/);
    expect(isQuoteNumber(n)).toBe(true);
    expect(isQuoteNumber(ORDER)).toBe(false);
    expect(QUOTE_NUMBER_PREFIX).toBe("TQ-");
  });
});

describe("createCheckout refuses a quote row before any DB read", () => {
  it("TQ- number: a quote-not-order error, no select, no Stripe session", async () => {
    const { gatewayTireRouter } = await import("../routers/gatewayTire");
    const caller = gatewayTireRouter.createCaller({ req: { ip: "203.0.113.5", headers: {} }, res: {} } as never);
    const res = await caller.createCheckout({ orderNumber: QUOTE, phone: "2165550123" });
    expect(res).toMatchObject({ error: expect.stringMatching(/quote/i) });
    expect("url" in res).toBe(false);
  });
});

describe("Kafene lease lookups never find a quote row", () => {
  it("findOrder and findOrderByNumber answer null for a TQ- number without querying", async () => {
    const { findOrder, findOrderByNumber } = await import("../services/kafene/leases");
    expect(await findOrder(neverQueried as never, QUOTE, "2165550123")).toBeNull();
    expect(await findOrderByNumber(neverQueried as never, QUOTE)).toBeNull();
  });
});

describe("order queries carry the ORDER_ROWS filter (source pin)", () => {
  const src = readFileSync(path.resolve(__dirname, "../routers/gatewayTire.ts"), "utf8");
  const block = (start: RegExp, end: RegExp) => {
    const s = src.search(start);
    expect(s, `block start ${start}`).toBeGreaterThan(-1);
    const rest = src.slice(s);
    const e = rest.search(end);
    return e === -1 ? rest : rest.slice(0, e);
  };

  it("canary: listOrders (the admin tab that must SHOW quotes) carries no quote filter", () => {
    expect(block(/listOrders: adminProcedure/, /\n  \w+: (admin|public)Procedure/)).not.toMatch(/ORDER_ROWS/);
  });

  it("placeOrder's durable dedupe skips quote rows", () => {
    const dedupe = block(/L2: durable DB check/, /if \(recent\)/);
    expect(dedupe).toMatch(/ORDER_ROWS/);
  });

  it("publicStats: all three aggregates skip quote rows", () => {
    const b = block(/publicStats: publicProcedure/, /\n  \w+: (admin|public)Procedure/);
    expect(b.match(/ORDER_ROWS/g)?.length ?? 0).toBe(3);
  });

  it("orderStats (the Tire Revenue tile) skips quote rows", () => {
    const b = block(/orderStats: adminProcedure/, /\n  \w+: (admin|public)Procedure/);
    expect(b).toMatch(/\.from\(tireOrders\)\s*\.where\(ORDER_ROWS\)/);
  });

  it("ORDER_ROWS is the NOT LIKE on the quote prefix", () => {
    expect(src).toMatch(/const ORDER_ROWS = sql`\$\{tireOrders\.orderNumber\} NOT LIKE \$\{`\$\{QUOTE_NUMBER_PREFIX\}%`\}`/);
  });
});
