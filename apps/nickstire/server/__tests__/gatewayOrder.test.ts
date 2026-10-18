/**
 * gatewayOrder v1 · admin two-step D&K supplier order for a paid tire order.
 *
 * Driven through the real router (createCaller, admin ctx) and the REAL gatewayClient; only
 * global fetch (a stateful fake of api-b2b.dktire.com) and the database handle are replaced.
 * D&K is never called. The fake DB interprets the rendered WHERE of every UPDATE, so a claim
 * whose predicate loses a clause behaves like it would in TiDB: it matches when it should not.
 *
 * The promises pinned here:
 *   - submit is OFF unless GATEWAY_ORDERING_ENABLED=true, and then makes no D&K call at all;
 *   - on-submit-order is sent at most once per order, ever: two concurrent submits -> one call,
 *     and an outcome D&K may have accepted (timeout, 5xx) is never released for a second try;
 *   - nothing is sent unless the cart still holds exactly the lines prepare showed (token);
 *   - a staff line in the D&K cart is never touched or ordered;
 *   - the bearer token and the password never reach a log line.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const dialect = new MySqlDialect();

type Order = {
  id: number; orderNumber: string; tireBrand: string; tireModel: string; tireSize: string; quantity: number;
  paymentStatus: string; status: string; gatewayOrderRef: string | null; adminNotes: string | null;
  customerName: string; customerPhone: string;
};

const h = vi.hoisted(() => ({
  order: null as null | Record<string, unknown>,
  updates: [] as Array<{ sql: string; params: unknown[]; set: Record<string, unknown>; applied: boolean }>,
  logLines: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  telegrams: [] as string[],
}));

vi.mock("../lib/logger", () => ({
  createLogger: (module: string) => {
    const rec = (level: string) => (msg: string, ...args: unknown[]) => {
      h.logLines.push(`${level} ${module} ${msg} ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : JSON.stringify(a))).join(" ")}`);
    };
    return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
  },
}));
vi.mock("../services/adminSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/adminSecurity")>();
  return { ...actual, getAdminSecurityState: async () => ({ ...actual.MFA_NOT_REQUIRED_STATE }) };
});
vi.mock("../lib/adminActivity", () => ({ touchAdminActivity: () => undefined }));
vi.mock("../services/auditTrail", () => ({
  logAdminAction: async (d: Record<string, unknown>) => { h.audits.push(d); },
}));
vi.mock("../services/telegram", () => ({
  sendTelegram: async (text: string) => { h.telegrams.push(text); return true; },
}));

/** A drizzle-shaped fake over ONE tire_orders row. UPDATEs honour the clauses their rendered WHERE names. */
vi.mock("../lib/db-helper", async () => {
  const { MySqlDialect: D } = await import("drizzle-orm/mysql-core");
  const d = new D();
  // Walk the rendered predicate in order; each recognised clause consumes its params.
  const CLAUSE = /\(`tire_orders`\.`gatewayOrderRef` is null or `tire_orders`\.`gatewayOrderRef` = \?\)|`tire_orders`\.`(\w+)` (is null|= \?|in \(([?, ]+)\))/g;
  const matches = (sql: string, params: unknown[], row: Record<string, unknown>): boolean => {
    let p = 0;
    let ok = true;
    for (const m of sql.matchAll(CLAUSE)) {
      if (!m[1]) { const empty = params[p++]; ok = ok && (row.gatewayOrderRef === null || row.gatewayOrderRef === empty); continue; }
      const v = row[m[1]];
      if (m[2] === "is null") ok = ok && v === null;
      else if (m[2] === "= ?") ok = ok && v === params[p++];
      else { const n = (m[3].match(/\?/g) || []).length; const list = params.slice(p, p + n); p += n; ok = ok && list.includes(v); }
    }
    return ok;
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (h.order ? [{ ...h.order }] : []) }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          const { sql, params } = d.sqlToQuery(cond as never);
          const applied = !!h.order && matches(sql, params, h.order);
          if (applied) Object.assign(h.order!, set);
          h.updates.push({ sql, params, set, applied });
          return [{ affectedRows: applied ? 1 : 0 }];
        },
      }),
    }),
  };
  return { dbTyped: async () => db };
});

const fx = JSON.parse(readFileSync(new URL("./fixtures/gatewayOrder/dk.json", import.meta.url), "utf8"));

const USER = "shop-user-1a2";
const PASS = "shop-pass-3b4";
const TOKEN = "jwt-dk-5c6d";
const SHIP_TO = "SHIP-TO-UUID";
const ENV_KEYS = ["GATEWAY_TIRE_USERNAME", "GATEWAY_TIRE_PASSWORD", "GATEWAY_TIRE_SHIP_TO", "GATEWAY_ORDERING_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

let gatewayOrderRouter: typeof import("../routers/gatewayOrder").gatewayOrderRouter;
let svc: typeof import("../services/gatewaySupplierOrder");

const adminCtx = (): TrpcContext => ({
  user: { id: 1, openId: "admin-user", email: "owner@nickstire.org", name: "Owner", loginMethod: "google", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
}) as TrpcContext;
const caller = () => gatewayOrderRouter.createCaller(adminCtx());

// ── Stateful fake of api-b2b.dktire.com ─────────────────────────────
type Call = { method: string; path: string; query: Record<string, string>; body: unknown };
let dk: {
  calls: Call[];
  cart: Array<Record<string, any>>;
  search: Array<Record<string, any>>;
  keepPo: boolean;
  addResponse: () => Response;
  submitResponse: () => Response | Promise<Response>;
  listCart401Once: boolean;
};
let nextLineId = 1;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeDk() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body.startsWith("grant_type") ? "null" : init.body) : null;
    dk.calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    if (url.pathname === "/token") return json({ access_token: TOKEN, token_type: "bearer" });
    switch (`${method} ${url.pathname}`) {
      case "POST /quicksearch/cache": return json(dk.search);
      case "GET /cart/list-cart":
        if (dk.listCart401Once) { dk.listCart401Once = false; return json({ detail: "expired" }, 401); }
        return json(JSON.parse(JSON.stringify(dk.cart)));
      case "POST /cart/add-to-saved-cart": {
        const res = dk.addResponse();
        if (!res.ok) return res;
        for (const entry of body as Array<Record<string, any>>) {
          const item = [fx.searchHit, fx.searchOther, fx.searchTwin].find((i) => i.pricing_data[0]._id === entry._id);
          const line = { _id: `cart-${nextLineId++}`, dk_part_number: item?.dk_part_number, display_name: item?.display_name, num: entry.num, quantity: entry.quantity, selling_price: entry.selling_price, site_id: entry.site_id, customer_id: "C-1887" };
          let top = dk.cart.find((t) => t.ship_to === entry.ship_to);
          if (!top) { top = { ship_to: entry.ship_to, site_level_prepay: false, customer_level_prepay: false, tax_percent: 0, items: [] }; dk.cart.push(top); }
          let group = top.items.find((g: any) => g.ship_from === String(entry.site_id));
          if (!group) { group = { ship_from: String(entry.site_id), customer_po_number: "", customer_po_prefix: "", items: [] }; top.items.push(group); }
          group.items.push(line);
        }
        return res;
      }
      case "POST /cart/update-cart-after-listing":
        if (dk.keepPo) dk.cart = JSON.parse(JSON.stringify(body));
        return json({ status: "Success", data: dk.cart });
      case "POST /order/on-submit-order": return dk.submitResponse();
      case "POST /cart/save-cart-data":
        if (Array.isArray(body) && body.length === 0) dk.cart = [];
        return json({ status: "Success" });
      case "DELETE /cart/delete-items-in-cart": {
        const id = url.searchParams.get("cart_id");
        for (const top of dk.cart) for (const g of top.items) g.items = g.items.filter((l: any) => l._id !== id);
        for (const top of dk.cart) top.items = top.items.filter((g: any) => g.items.length > 0);
        dk.cart = dk.cart.filter((t) => t.items.length > 0);
        return json({ status: "Success" });
      }
      case "GET /master/get-cut-off-time":
        return json({ cutofftime: [{ site_id: 7001, cut_off_time: "3:00 PM", delivery_day: "TUESDAY" }] });
      default: return json({ detail: "Not Found" }, 404);
    }
  });
}

const writes = () => dk.calls.filter((c) => c.method !== "GET" && c.path !== "/token" && c.path !== "/quicksearch/cache");
const callsTo = (path: string) => dk.calls.filter((c) => c.path === path);

const paidOrder = (over: Partial<Order> = {}): Order => ({
  id: 41, orderNumber: "TO-20261018-007", tireBrand: "LANDSAIL", tireModel: "LS388", tireSize: "215/55R16", quantity: 4,
  paymentStatus: "paid", status: "received", gatewayOrderRef: null, adminNotes: null,
  customerName: "Pat Doe", customerPhone: "2165550100", ...over,
});
const PO = "online order TO-20261018-007";

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GATEWAY_TIRE_USERNAME = USER;
  process.env.GATEWAY_TIRE_PASSWORD = PASS;
  process.env.GATEWAY_TIRE_SHIP_TO = SHIP_TO;
  process.env.GATEWAY_ORDERING_ENABLED = "true";
  dk = {
    calls: [], cart: [], search: [fx.searchHit, fx.searchOther], keepPo: true,
    addResponse: () => json({ status: "Success" }),
    submitResponse: () => json(fx.submitOk),
    listCart401Once: false,
  };
  nextLineId = 1;
  h.order = paidOrder();
  h.updates.length = 0;
  h.logLines.length = 0;
  h.audits.length = 0;
  h.telegrams.length = 0;
  vi.stubGlobal("fetch", fakeDk());
  vi.resetModules();
  ({ gatewayOrderRouter } = await import("../routers/gatewayOrder"));
  svc = await import("../services/gatewaySupplierOrder");
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

const order = () => h.order as unknown as Order;

describe("request bodies (the part the first live run checks)", () => {
  it("add-to-saved-cart sends the portal's shape: the item's first pricing row + num, total, ship_to", () => {
    expect(svc.buildAddToCartBody(fx.searchHit, 4, SHIP_TO)).toEqual([
      { ...fx.searchHit.pricing_data[0], num: 4, total: 245, ship_to: SHIP_TO },
    ]);
  });

  it("the D&K order reference: a named order field first, else the response JSON cut to 100 chars", () => {
    expect(svc.extractOrderRef(fx.submitOk)).toBe("SO-7001-448812");
    const fallback = svc.extractOrderRef(fx.submitOkNoRef);
    expect(fallback).toBe(JSON.stringify(fx.submitOkNoRef).slice(0, 100));
    expect(fallback.length).toBeLessThanOrEqual(100);
  });
});

describe("prepare", () => {
  it("without the flag: preview only, the lines it WOULD add, and no cart write", async () => {
    delete process.env.GATEWAY_ORDERING_ENABLED;
    const res = await caller().prepare({ orderId: 41 });
    expect(res).toMatchObject({
      ok: true, preview: true, cartHadOtherLines: false,
      match: { partNumber: "LS388-2155516", brand: "LANDSAIL", model: "LS388", size: "215/55R16", wholesaleCents: 6125, qtyAvailable: 12 },
      lines: [{ partNumber: "LS388-2155516", quantity: 4, unitCostCents: 6125, lineTotalCents: 24500, poNumber: PO }],
    });
    expect(writes()).toEqual([]);
  });

  it("with the flag: adds exactly the order's tires with our PO, and shows the cart's lines back", async () => {
    const res = await caller().prepare({ orderId: 41 });
    expect(callsTo("/cart/add-to-saved-cart")).toHaveLength(1);
    expect(callsTo("/cart/add-to-saved-cart")[0].body).toEqual(svc.buildAddToCartBody(fx.searchHit, 4, SHIP_TO));
    const update = callsTo("/cart/update-cart-after-listing")[0].body as any[];
    expect(update[0].items[0].customer_po_number).toBe(PO);
    expect(res).toMatchObject({
      ok: true, preview: false, cartHadOtherLines: false, cutoff: "3:00 PM",
      lines: [{ partNumber: "LS388-2155516", description: "LANDSAIL LS388 215/55R16 97V XL", quantity: 4, unitCostCents: 6125, lineTotalCents: 24500, poNumber: PO }],
    });
    const expectedToken = createHash("sha256")
      .update(JSON.stringify([{ part: "LS388-2155516", qty: 4, po: PO, unitCostCents: 6125 }]))
      .digest("hex");
    expect((res as { cartToken: string }).cartToken).toBe(expectedToken);
    expect(order().gatewayOrderRef).toBeNull(); // prepare never claims
  });

  it("a staff line already in the D&K cart blocks the write and is described back", async () => {
    dk.cart = JSON.parse(JSON.stringify(fx.foreignCart));
    const res = await caller().prepare({ orderId: 41 });
    expect(res).toMatchObject({ ok: false, reason: "cart_not_empty", otherLines: [{ partNumber: "MICH-2256517", quantity: 2 }] });
    expect(writes()).toEqual([]);
  });

  it("in preview, a staff line is reported (cartHadOtherLines) but nothing is written", async () => {
    delete process.env.GATEWAY_ORDERING_ENABLED;
    dk.cart = JSON.parse(JSON.stringify(fx.foreignCart));
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: true, preview: true, cartHadOtherLines: true });
    expect(writes()).toEqual([]);
  });

  it("refuses an unpaid order, an ordered one and one already holding a D&K ref", async () => {
    h.order = paidOrder({ paymentStatus: "unpaid" });
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "not_paid" });
    h.order = paidOrder({ status: "ordered" });
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "already_ordered" });
    h.order = paidOrder({ gatewayOrderRef: "SO-1" });
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "already_ordered" });
    expect(dk.calls).toEqual([]);
  });

  it("no D&K item for the order's brand and model is no_match", async () => {
    dk.search = [fx.searchOther];
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "no_match" });
    expect(writes()).toEqual([]);
  });

  it("two part numbers for the same tire is ambiguous_match with candidates; the admin's pick then prepares", async () => {
    dk.search = [fx.searchHit, fx.searchTwin, fx.searchOther];
    const res = await caller().prepare({ orderId: 41 });
    expect(res).toMatchObject({ ok: false, reason: "ambiguous_match" });
    expect((res as { candidates: Array<{ partNumber: string }> }).candidates.map((c) => c.partNumber).sort())
      .toEqual(["LS388-2155516", "LS388-2155516-B"]);
    expect(writes()).toEqual([]);
    const picked = await caller().prepare({ orderId: 41, partNumber: "LS388-2155516-B" });
    expect(picked).toMatchObject({ ok: true, match: { partNumber: "LS388-2155516-B" } });
    // a part number that is not one of this tire's candidates is refused
    expect(await caller().prepare({ orderId: 41, partNumber: "PR-2155516" })).toMatchObject({ ok: false, reason: "no_match" });
  });

  it("no D&K login or no ship-to is unconfigured, before any D&K call", async () => {
    delete process.env.GATEWAY_TIRE_PASSWORD;
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "unconfigured" });
    process.env.GATEWAY_TIRE_PASSWORD = PASS;
    delete process.env.GATEWAY_TIRE_SHIP_TO;
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "unconfigured" });
    expect(dk.calls).toEqual([]);
  });

  it("a 400 from add-to-saved-cart is upstream_error carrying D&K's detail for the admin", async () => {
    dk.addResponse = () => json(fx.badRequest, 400);
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: false, reason: "upstream_error", detail: "Invalid ship_to value" });
  });

  it("if D&K does not keep the PO on the cart line, prepare says so instead of returning a token", async () => {
    dk.keepPo = false;
    const res = await caller().prepare({ orderId: 41 });
    expect(res).toMatchObject({ ok: false, reason: "upstream_error" });
    expect((res as { detail: string }).detail).toMatch(/PO/);
  });

  it("a 401 on the cart read logs in again and retries the READ once", async () => {
    dk.listCart401Once = true;
    expect(await caller().prepare({ orderId: 41 })).toMatchObject({ ok: true });
    expect(callsTo("/token")).toHaveLength(2);
  });

  it("an unknown order is NOT_FOUND", async () => {
    h.order = null;
    await expect(caller().prepare({ orderId: 41 })).rejects.toThrow(/not found/i);
  });
});

describe("submit", () => {
  async function prepared(): Promise<string> {
    const res = await caller().prepare({ orderId: 41 });
    expect(res.ok).toBe(true);
    return (res as { cartToken: string }).cartToken;
  }

  it("without the flag: disabled, and no D&K call of any kind", async () => {
    const token = await prepared();
    dk.calls.length = 0;
    delete process.env.GATEWAY_ORDERING_ENABLED;
    expect(await caller().submit({ orderId: 41, cartToken: token })).toEqual({ ok: false, reason: "disabled" });
    expect(dk.calls).toEqual([]);
    for (const v of ["false", "1", "TRUE ", "yes"]) {
      process.env.GATEWAY_ORDERING_ENABLED = v;
      expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ reason: "disabled" });
    }
    expect(dk.calls).toEqual([]);
    expect(order().gatewayOrderRef).toBeNull();
  });

  it("places the order once: D&K ref stored, status ordered, note, audit, Telegram, our leftover lines removed", async () => {
    const token = await prepared();
    const res = await caller().submit({ orderId: 41, cartToken: token });
    expect(res).toMatchObject({ ok: true, gatewayOrderRef: "SO-7001-448812" });
    const sent = callsTo("/order/on-submit-order");
    expect(sent).toHaveLength(1);
    const ax = (sent[0].body as { ax_order: any[] }).ax_order;
    expect(ax[0].items[0].customer_po_number).toBe(PO);
    expect(ax[0].items[0].items.map((l: any) => [l.dk_part_number, l.num])).toEqual([["LS388-2155516", 4]]);
    expect(sent[0].body).not.toHaveProperty("payment_obj");
    expect(order()).toMatchObject({ gatewayOrderRef: "SO-7001-448812", status: "ordered" });
    expect(order().adminNotes).toMatch(/D&K order placed \d{4}-\d\d-\d\dT.* by owner@nickstire\.org PO online order TO-20261018-007/);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ entityType: "tire_order", entityId: "TO-20261018-007", newValue: "SO-7001-448812", actor: "owner@nickstire.org" });
    expect(h.telegrams).toHaveLength(1);
    expect(h.telegrams[0]).toMatch(/TO-20261018-007[\s\S]*4x LANDSAIL LS388 215\/55R16[\s\S]*SO-7001-448812/);
    // never save-cart-data([]): in the portal that is the "Empty Cart" button and would wipe staff lines
    expect(callsTo("/cart/save-cart-data")).toHaveLength(0);
    expect(callsTo("/cart/delete-items-in-cart").map((d) => d.query)).toEqual([{ cart_id: "cart-1" }]);
  });

  it("an ok response with no named order field stores the response JSON cut to 100 chars", async () => {
    const token = await prepared();
    dk.submitResponse = () => json(fx.submitOkNoRef);
    const res = await caller().submit({ orderId: 41, cartToken: token });
    expect(res).toMatchObject({ ok: true, gatewayOrderRef: JSON.stringify(fx.submitOkNoRef).slice(0, 100) });
    expect(order().gatewayOrderRef!.length).toBeLessThanOrEqual(100);
  });

  it("a cart that changed since prepare is token_mismatch: no claim, nothing sent", async () => {
    const token = await prepared();
    dk.cart[0].items[0].items[0].num = 5;
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false, reason: "token_mismatch" });
    expect(callsTo("/order/on-submit-order")).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it("a staff line that appeared since prepare is token_mismatch: their line is never ordered", async () => {
    const token = await prepared();
    dk.cart[0].items[0].items.push({ _id: "cart-staff-9", dk_part_number: "MICH-2256517", num: 2, quantity: 30, selling_price: 140 });
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false, reason: "token_mismatch" });
    expect(callsTo("/order/on-submit-order")).toHaveLength(0);
  });

  it("a staff group (no PO) that appeared since prepare blocks the submit even though our lines are unchanged", async () => {
    const token = await prepared();
    dk.cart[0].items.push(JSON.parse(JSON.stringify(fx.foreignCart[0].items[0])));
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false, reason: "token_mismatch" });
    expect(callsTo("/order/on-submit-order")).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it("two concurrent submits for one order send on-submit-order exactly once", async () => {
    const token = await prepared();
    const [a, b] = await Promise.all([
      caller().submit({ orderId: 41, cartToken: token }),
      caller().submit({ orderId: 41, cartToken: token }),
    ]);
    expect(callsTo("/order/on-submit-order")).toHaveLength(1);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ ok: false, reason: "claimed" });
  });

  it("the claim is one compare-and-swap naming the id, an empty ref, paid and an open status", async () => {
    const token = await prepared();
    await caller().submit({ orderId: 41, cartToken: token });
    const claim = h.updates.find((u) => typeof u.set.gatewayOrderRef === "string" && (u.set.gatewayOrderRef as string).startsWith("pending:"));
    expect(claim).toBeDefined();
    expect(claim!.sql).toMatch(/`tire_orders`\.`id` = \?/);
    expect(claim!.sql).toMatch(/`tire_orders`\.`gatewayOrderRef` is null/);
    expect(claim!.sql).toMatch(/`tire_orders`\.`paymentStatus` = \?/);
    expect(claim!.sql).toMatch(/`tire_orders`\.`status` in \(\?, \?\)/);
    expect(claim!.params).toEqual(expect.arrayContaining([41, "paid", "received", "confirmed"]));
    expect((claim!.set.gatewayOrderRef as string).length).toBeLessThanOrEqual(100);
  });

  it("a definite D&K refusal (4xx) releases the claim, so the order can be tried again after a fix", async () => {
    const token = await prepared();
    dk.submitResponse = () => json({ detail: "PO number required" }, 400);
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false, reason: "upstream_error", detail: "PO number required" });
    expect(order().gatewayOrderRef).toBeNull();
    expect(order().status).toBe("received");
  });

  it("an outcome D&K may have accepted (timeout, 5xx) is NEVER released or retried", async () => {
    const token = await prepared();
    dk.submitResponse = () => { throw new TypeError("fetch failed"); };
    const first = await caller().submit({ orderId: 41, cartToken: token });
    expect(first).toMatchObject({ ok: false, reason: "upstream_error" });
    expect((first as { detail: string }).detail).toMatch(/check the D&K portal/i);
    expect(order().gatewayOrderRef).toMatch(/^uncertain:/);
    expect(h.telegrams.join("\n")).toMatch(/TO-20261018-007/);
    dk.submitResponse = () => json(fx.submitOk);
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false });
    expect(callsTo("/order/on-submit-order")).toHaveLength(1);
  });

  it("a 502 from on-submit-order is treated as uncertain too", async () => {
    const token = await prepared();
    dk.submitResponse = () => json({ detail: "bad gateway" }, 502);
    await caller().submit({ orderId: 41, cartToken: token });
    expect(order().gatewayOrderRef).toMatch(/^uncertain:/);
  });

  it("an unpaid or already ordered order is refused before any D&K write", async () => {
    const token = await prepared();
    dk.calls.length = 0;
    h.order = paidOrder({ paymentStatus: "unpaid" });
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false, reason: "not_paid" });
    h.order = paidOrder({ gatewayOrderRef: "SO-1", status: "ordered" });
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false, reason: "already_ordered" });
    expect(writes()).toEqual([]);
  });
});

describe("clearOurLines", () => {
  it("deletes only this order's lines; a staff line stays", async () => {
    await caller().prepare({ orderId: 41 });
    dk.cart[0].items.push(JSON.parse(JSON.stringify(fx.foreignCart[0].items[0])));
    const res = await caller().clearOurLines({ orderId: 41 });
    expect(res).toEqual({ ok: true, removed: 1 });
    const deletes = callsTo("/cart/delete-items-in-cart");
    expect(deletes.map((d) => d.query)).toEqual([{ cart_id: "cart-1" }]);
    expect(dk.cart[0].items.flatMap((g: any) => g.items.map((l: any) => l._id))).toEqual(["cart-staff-1"]);
  });

  it("is a cart write, so it is disabled without the flag", async () => {
    delete process.env.GATEWAY_ORDERING_ENABLED;
    expect(await caller().clearOurLines({ orderId: 41 })).toEqual({ ok: false, reason: "disabled" });
    expect(dk.calls).toEqual([]);
  });
});

describe("secrets", () => {
  it("no log line carries the bearer token or the password, across success and failure", async () => {
    const res = await caller().prepare({ orderId: 41 });
    const token = (res as { cartToken: string }).cartToken;
    dk.submitResponse = () => json({ detail: `token ${TOKEN} rejected` }, 403);
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: false });
    dk.submitResponse = () => json(fx.submitOk);
    expect(await caller().submit({ orderId: 41, cartToken: token })).toMatchObject({ ok: true }); // the success path logs too
    expect(h.logLines.some((l) => l.includes("add-to-saved-cart"))).toBe(true); // positive control
    expect(h.logLines.some((l) => l.includes("on-submit-order response keys"))).toBe(true);
    const all = h.logLines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(PASS);
  });
});
