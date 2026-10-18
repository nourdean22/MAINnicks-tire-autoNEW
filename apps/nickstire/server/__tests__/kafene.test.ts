/**
 * kafene v1 · Kafene lease checkout for a placed tire order, and the admin activate / cancel.
 *
 * Driven through the real router (createCaller: public ctx and admin ctx); only global fetch (a
 * fake Kafene Partner API, shapes from Kafene's WooCommerce plugin v2.0.0) and the DB handle are
 * replaced. Kafene is never called. The fake DB interprets the rendered WHERE of every query, so a
 * compare-and-swap that loses a clause matches rows it should not, as it would in TiDB.
 *
 * Promises pinned here:
 *   - with KAFENE_MERCHANT_ID / KAFENE_STORE_ID / KAFENE_API_KEY not all set: everything says
 *     "disabled", config hands out no key, and nothing touches the network or the table;
 *   - a failed /v2/me is an UNKNOWN limit (null), never a limit of 0;
 *   - attach and activate are compare-and-swaps: one uid per lease, one activate call per lease;
 *   - a failed activate never leaves the lease "activated";
 *   - the order is never marked paid by a browser callback;
 *   - the API key and the bearer token never reach a log line.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  tables: { tire_orders: [] as Row[], kafene_leases: [] as Row[] } as Record<string, Row[]>,
  writes: [] as Array<{ table: string; kind: string; sql: string; params: unknown[]; set?: Row; affected: number }>,
  dbDown: false,
  missingTable: false,
  logLines: [] as string[],
  telegrams: [] as string[],
  emails: [] as Row[],
  nextId: 1,
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
vi.mock("../services/telegram", () => ({
  sendTelegram: async (text: string) => { h.telegrams.push(text); return true; },
}));
vi.mock("../email-notify", () => ({
  notifyTireOrderKafeneSigned: async (d: Row) => { h.emails.push(d); return { emailSent: true }; },
}));

/** A drizzle-shaped fake over two tables; every WHERE is evaluated from its rendered SQL. */
vi.mock("../lib/db-helper", async () => {
  const { MySqlDialect: D } = await import("drizzle-orm/mysql-core");
  const d = new D();
  const tableOf = (t: unknown): string => {
    const sym = Object.getOwnPropertySymbols(t as object).find((s) => s.description === "drizzle:Name");
    return (t as Record<symbol, string>)[sym as symbol];
  };
  const CLAUSE = /`(\w+)`\.`(\w+)` (is null|is not null|= \?|in \(([?, ]+)\))/g;
  const matches = (sql: string, params: unknown[], row: Row): boolean => {
    let p = 0;
    let ok = true;
    for (const m of sql.matchAll(CLAUSE)) {
      const v = row[m[2]] ?? null;
      if (m[3] === "is null") ok = ok && v === null;
      else if (m[3] === "is not null") ok = ok && v !== null;
      else if (m[3] === "= ?") ok = ok && v === params[p++];
      else { const n = (m[4].match(/\?/g) || []).length; const list = params.slice(p, p + n); p += n; ok = ok && list.includes(v); }
    }
    return ok;
  };
  const toSet = (set: Row): Row => {
    const out: Row = {};
    for (const [k, v] of Object.entries(set)) out[k] = v && typeof v === "object" && !(v instanceof Date) ? "<sql>" : v;
    return out;
  };
  const db = {
    select: () => ({
      from: (t: unknown) => {
        const table = tableOf(t);
        const q = {
          cond: null as unknown,
          desc: false,
          where(c: unknown) { q.cond = c; return q; },
          orderBy() { q.desc = true; return q; },
          async limit(n: number) {
            if (h.dbDown) throw new Error("ECONNREFUSED");
            if (h.missingTable && table === "kafene_leases") throw Object.assign(new Error("Table 'nicks.kafene_leases' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
            const { sql, params } = q.cond ? d.sqlToQuery(q.cond as never) : { sql: "", params: [] };
            let rows = h.tables[table].filter((r) => matches(sql, params, r));
            if (q.desc) rows = [...rows].sort((a, b) => (b.id as number) - (a.id as number));
            return rows.slice(0, n).map((r) => ({ ...r }));
          },
        };
        return q;
      },
    }),
    insert: (t: unknown) => ({
      values: async (v: Row) => {
        if (h.dbDown) throw new Error("ECONNREFUSED");
        const table = tableOf(t);
        if (h.missingTable && table === "kafene_leases") throw Object.assign(new Error("Table 'nicks.kafene_leases' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
        const row = { id: h.nextId++, createdAt: new Date(), uid: null, activationDate: null, activatedAt: null, activatedBy: null, cancelledAt: null, lastError: null, ...v };
        h.tables[table].push(row);
        h.writes.push({ table, kind: "insert", sql: "", params: [], set: v, affected: 1 });
        return [{ insertId: row.id, affectedRows: 1 }];
      },
    }),
    update: (t: unknown) => ({
      set: (set: Row) => ({
        where: async (cond: unknown) => {
          if (h.dbDown) throw new Error("ECONNREFUSED");
          const table = tableOf(t);
          const { sql, params } = d.sqlToQuery(cond as never);
          const hit = h.tables[table].filter((r) => matches(sql, params, r));
          for (const r of hit) Object.assign(r, toSet(set));
          h.writes.push({ table, kind: "update", sql, params, set, affected: hit.length });
          return [{ affectedRows: hit.length }];
        },
      }),
    }),
  };
  return { dbTyped: async () => (h.dbDown ? null : db), db: async () => (h.dbDown ? null : db) };
});

const dialect = new MySqlDialect();
void dialect;

const MERCHANT = "merchant-77";
const STORE = "store-always-approve";
const API_KEY = "kafene-key-9f8e7d";
const TOKEN = "kafene-bearer-1a2b3c";
const ENV_KEYS = ["KAFENE_MERCHANT_ID", "KAFENE_STORE_ID", "KAFENE_API_KEY", "KAFENE_ENVIRONMENT"] as const;
const savedEnv: Record<string, string | undefined> = {};

let kafeneRouter: typeof import("../routers/kafene").kafeneRouter;

const publicCtx = () => ({ req: { ip: "203.0.113.5", headers: {} }, res: {} }) as unknown as TrpcContext;
const adminCtx = () => ({
  user: { id: 1, openId: "admin-user", email: "owner@nickstire.org", name: "Owner", loginMethod: "google", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
  req: { protocol: "https", headers: {} },
  res: { clearCookie: () => {} },
}) as unknown as TrpcContext;
const pub = () => kafeneRouter.createCaller(publicCtx());
const admin = () => kafeneRouter.createCaller(adminCtx());

// ── Fake Kafene Partner API ──────────────────────────────────────────
type Call = { method: string; url: URL; headers: Record<string, string>; body: unknown };
let kf: {
  calls: Call[];
  maxApproval: unknown; // dollars, or a Response to return
  meStatus: number;
  activate: () => Response | Promise<Response>;
  token401Once: boolean;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeKafene() {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    kf.calls.push({ method: (init?.method ?? "GET").toUpperCase(), url, headers, body });
    if (url.pathname === "/v2/auth/token") {
      if (headers.kafene_api_key !== API_KEY) return json({ message: "bad key" }, 401);
      return json({ data: { access_token: TOKEN } });
    }
    if (headers.authorization !== `Bearer ${TOKEN}`) return json({ message: "unauthorized" }, 401);
    if (kf.token401Once && url.pathname.endsWith("/activate")) { kf.token401Once = false; return json({ message: "expired" }, 401); }
    if (url.pathname === "/v2/me") return kf.meStatus === 200 ? json({ merchant: { max_approval_amount: kf.maxApproval } }) : json({}, kf.meStatus);
    if (/^\/v2\/applications\/[^/]+\/activate$/.test(url.pathname)) return kf.activate();
    if (/^\/v2\/applications\/[^/]+\/cancel$/.test(url.pathname)) return json({ data: { status: "cancelled" } });
    return json({ message: "not found" }, 404);
  });
}

const callsTo = (suffix: string) => kf.calls.filter((c) => c.url.pathname.endsWith(suffix));
const leases = () => h.tables.kafene_leases;
const order = () => h.tables.tire_orders[0];

function seedOrder(over: Row = {}) {
  h.tables.tire_orders = [{
    id: 9, orderNumber: "TO-20261018-011", customerName: "Pat Q Doe", customerPhone: "2165550100", customerEmail: "pat@example.com",
    tireBrand: "LANDSAIL", tireModel: "LS388", tireSize: "215/55R16", quantity: 4, pricePerTire: 12250, serviceFeePerTire: 3500,
    fetPerTire: 0, totalAmount: 63000, status: "received", paymentStatus: "unpaid", adminNotes: null, vehicleInfo: "2018 Honda Civic",
    ...over,
  }];
}
const IDS = { orderNumber: "TO-20261018-011", phone: "2165550100" };

beforeEach(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.KAFENE_MERCHANT_ID = MERCHANT;
  process.env.KAFENE_STORE_ID = STORE;
  process.env.KAFENE_API_KEY = API_KEY;
  delete process.env.KAFENE_ENVIRONMENT;
  kf = { calls: [], maxApproval: 2500, meStatus: 200, activate: () => json({ data: { status: "activated" } }), token401Once: false };
  h.tables = { tire_orders: [], kafene_leases: [] };
  h.writes = [];
  h.dbDown = false;
  h.missingTable = false;
  h.logLines.length = 0;
  h.telegrams.length = 0;
  h.emails.length = 0;
  h.nextId = 1;
  seedOrder();
  vi.stubGlobal("fetch", fakeKafene());
  vi.resetModules();
  ({ kafeneRouter } = await import("../routers/kafene"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("disabled: not all three KAFENE_ ids set", () => {
  for (const missing of ["KAFENE_MERCHANT_ID", "KAFENE_STORE_ID", "KAFENE_API_KEY"] as const) {
    it(`${missing} unset -> config hands out nothing and every procedure says disabled, no network, no table`, async () => {
      delete process.env[missing];
      expect(await pub().config()).toEqual({ enabled: false, apiKey: null, storeId: null, environment: null, maxApprovalCents: null });
      expect(await pub().start(IDS)).toEqual({ ok: false, reason: "disabled" });
      expect(await pub().attach({ ...IDS, uid: "app_1" })).toEqual({ ok: false, reason: "disabled" });
      expect(await pub().markSigned({ ...IDS, uid: "app_1" })).toEqual({ ok: false, reason: "disabled" });
      expect(await admin().activate({ orderNumber: IDS.orderNumber })).toEqual({ ok: false, reason: "disabled" });
      expect(await admin().cancel({ orderNumber: IDS.orderNumber, reason: "customer changed mind" })).toEqual({ ok: false, reason: "disabled" });
      // status reads the table with or without keys (keyless "applied" rows must show); nothing here
      expect(await admin().status({ orderNumber: IDS.orderNumber })).toEqual({ ok: true, lease: null });
      expect(kf.calls).toEqual([]);
      expect(h.writes).toEqual([]);
    });
  }

  it("a blank value counts as unset", async () => {
    process.env.KAFENE_API_KEY = "   ";
    expect((await pub().config()).enabled).toBe(false);
    expect(kf.calls).toEqual([]);
  });
});

describe("config", () => {
  it("enabled: the SDK ids, sandbox by default, and the merchant limit in cents from /v2/me", async () => {
    expect(await pub().config()).toEqual({ enabled: true, apiKey: API_KEY, storeId: STORE, environment: "sandbox", maxApprovalCents: 250000 });
    const [token, me] = kf.calls;
    expect(token.url.href).toBe("https://staging-partner-api.kafene.com/v2/auth/token");
    expect(token.method).toBe("POST");
    expect(token.headers.kafene_api_key).toBe(API_KEY);
    expect(token.body).toEqual({ merchant_id: MERCHANT });
    expect(me.url.href).toBe("https://staging-partner-api.kafene.com/v2/me");
    expect(me.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("production uses partner-api.kafene.com", async () => {
    process.env.KAFENE_ENVIRONMENT = "production";
    expect((await pub().config()).environment).toBe("production");
    expect(kf.calls[0].url.origin).toBe("https://partner-api.kafene.com");
  });

  it("a failed /v2/me is an unknown limit (null), never 0", async () => {
    kf.meStatus = 503;
    expect(await pub().config()).toMatchObject({ enabled: true, maxApprovalCents: null });
  });

  it("a merchant with no published limit is null too", async () => {
    kf.maxApproval = null;
    expect((await pub().config()).maxApprovalCents).toBeNull();
  });

  it("the limit is cached for an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await pub().config();
    await pub().config();
    expect(callsTo("/v2/me")).toHaveLength(1);
    vi.setSystemTime(Date.now() + 61 * 60_000);
    await pub().config();
    expect(callsTo("/v2/me")).toHaveLength(2);
  });
});

describe("start", () => {
  it("builds one leasable line per tire in dollars and records a started lease", async () => {
    const res = await pub().start(IDS);
    expect(res).toEqual({
      ok: true,
      orderId: "TO-20261018-011",
      items: [{ model: "LANDSAIL LS388 215/55R16", description: "LANDSAIL LS388 215/55R16", price: 157.5, quantity: 4, condition: "New", damage: "", leasable: true }],
      shippingCost: 0,
      customer: { billing: { first_name: "Pat", last_name: "Q Doe", phone: "2165550100", email: "pat@example.com" } },
    });
    expect(leases()).toHaveLength(1);
    expect(leases()[0]).toMatchObject({ orderNumber: "TO-20261018-011", status: "started", merchandiseCents: 63000, uid: null });
  });

  it("a second start reuses the open lease row instead of adding one", async () => {
    await pub().start(IDS);
    await pub().start(IDS);
    expect(leases()).toHaveLength(1);
  });

  it("refuses a wrong phone, a paid order and a cancelled order", async () => {
    expect(await pub().start({ ...IDS, phone: "2165559999" })).toEqual({ ok: false, reason: "not_found" });
    seedOrder({ paymentStatus: "paid" });
    expect(await pub().start(IDS)).toEqual({ ok: false, reason: "already_paid" });
    seedOrder({ status: "cancelled" });
    expect(await pub().start(IDS)).toEqual({ ok: false, reason: "cancelled" });
    expect(leases()).toEqual([]);
  });

  it("over the merchant's Kafene limit is over_limit and records nothing", async () => {
    kf.maxApproval = 500;
    expect(await pub().start(IDS)).toEqual({ ok: false, reason: "over_limit" });
    expect(leases()).toEqual([]);
  });

  it("an unknown limit does not block the start (Kafene decides at application)", async () => {
    kf.meStatus = 500;
    expect((await pub().start(IDS)).ok).toBe(true);
  });

  it("a signed lease on the order is already_signed, not a second lease", async () => {
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
    await pub().markSigned({ ...IDS, uid: "app_123" });
    expect(await pub().start(IDS)).toEqual({ ok: false, reason: "already_signed" });
    expect(leases()).toHaveLength(1);
  });

  it("a database that cannot be reached is upstream_error", async () => {
    h.dbDown = true;
    expect(await pub().start(IDS)).toEqual({ ok: false, reason: "upstream_error" });
  });
});

describe("attach", () => {
  it("puts the uid on the open lease with one compare-and-swap", async () => {
    await pub().start(IDS);
    expect(await pub().attach({ ...IDS, uid: "app_123" })).toEqual({ ok: true });
    expect(leases()[0]).toMatchObject({ uid: "app_123", status: "approved" });
    const cas = h.writes.find((w) => w.kind === "update" && w.table === "kafene_leases");
    expect(cas!.sql).toMatch(/`kafene_leases`\.`orderNumber` = \?/);
    expect(cas!.sql).toMatch(/`kafene_leases`\.`status` = \?/);
    expect(cas!.sql).toMatch(/`kafene_leases`\.`uid` is null/);
    expect(cas!.params).toEqual(expect.arrayContaining(["TO-20261018-011", "started"]));
  });

  it("a second, different uid for the same lease is a conflict and does not overwrite", async () => {
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
    expect(await pub().attach({ ...IDS, uid: "app_999" })).toEqual({ ok: false, reason: "conflict" });
    expect(leases()[0].uid).toBe("app_123");
  });

  it("the same uid again is ok (a retried attach)", async () => {
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
    expect(await pub().attach({ ...IDS, uid: "app_123" })).toEqual({ ok: true });
  });

  it("a uid already on another order's lease is a conflict", async () => {
    await pub().start(IDS);
    h.tables.kafene_leases.push({ id: 50, orderNumber: "TO-OTHER", uid: "app_123", status: "approved", merchandiseCents: 1000 });
    expect(await pub().attach({ ...IDS, uid: "app_123" })).toEqual({ ok: false, reason: "conflict" });
  });

  it("no started lease, or a wrong phone, is not_found", async () => {
    expect(await pub().attach({ ...IDS, uid: "app_123" })).toEqual({ ok: false, reason: "not_found" });
    await pub().start(IDS);
    expect(await pub().attach({ ...IDS, phone: "000-000-0000", uid: "app_123" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects a uid that could not be a Kafene id before touching anything", async () => {
    await expect(pub().attach({ ...IDS, uid: "x".repeat(65) })).rejects.toThrow();
    await expect(pub().attach({ ...IDS, uid: "app 1; drop" })).rejects.toThrow();
  });
});

describe("markSigned", () => {
  async function approved() {
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
  }

  it("signs the lease, notes the order, hands off to the shop once; the order is NOT marked paid", async () => {
    await approved();
    expect(await pub().markSigned({ ...IDS, uid: "app_123" })).toEqual({ ok: true, status: "signed" });
    expect(leases()[0].status).toBe("signed");
    expect(order().paymentStatus).toBe("unpaid");
    expect(String(order().adminNotes)).toMatch(/Kafene lease signed \d{4}-\d\d-\d\dT\S+ uid app_123/);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]).toMatchObject({ orderNumber: "TO-20261018-011", uid: "app_123", quantity: 4 });
    expect(h.telegrams).toHaveLength(1);
    expect(h.telegrams[0]).toMatch(/Kafene lease signed/);
    // again: still ok, no second hand-off
    expect(await pub().markSigned({ ...IDS, uid: "app_123" })).toEqual({ ok: true, status: "signed" });
    expect(h.emails).toHaveLength(1);
    expect(h.telegrams).toHaveLength(1);
  });

  it("a uid that is not this order's lease is unknown_uid", async () => {
    await approved();
    expect(await pub().markSigned({ ...IDS, uid: "app_456" })).toEqual({ ok: false, reason: "unknown_uid" });
    expect(leases()[0].status).toBe("approved");
    expect(h.emails).toHaveLength(0);
  });

  it("a wrong phone is not_found", async () => {
    await approved();
    expect(await pub().markSigned({ ...IDS, phone: "000-000-0000", uid: "app_123" })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("admin activate", () => {
  async function signed() {
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
    await pub().markSigned({ ...IDS, uid: "app_123" });
    h.telegrams.length = 0;
  }

  it("activates once with today's Cleveland date; lease activated, note, Telegram", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-19T02:30:00Z")); // 22:30 ET on Oct 18
    await signed();
    const res = await admin().activate({ orderNumber: IDS.orderNumber });
    expect(res).toMatchObject({ ok: true, status: "activated" });
    const [call] = callsTo("/activate");
    expect(call.url.href).toBe("https://staging-partner-api.kafene.com/v2/applications/app_123/activate");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ delivery_date: "2026-10-18" });
    expect(leases()[0]).toMatchObject({ status: "activated", activationDate: "2026-10-18", activatedBy: "owner@nickstire.org" });
    expect(leases()[0].activatedAt).toBeInstanceOf(Date);
    expect(String(order().adminNotes)).toMatch(/Kafene lease activated .* by owner@nickstire\.org/);
    expect(h.telegrams.join("\n")).toMatch(/Kafene lease activated, funding in about 2 business days/);
  });

  it("a 500 from Kafene puts the lease back to signed with the error; never activated", async () => {
    await signed();
    kf.activate = () => json({ message: "temporary" }, 500);
    const res = await admin().activate({ orderNumber: IDS.orderNumber });
    expect(res).toMatchObject({ ok: false, reason: "upstream_error" });
    expect(leases()[0]).toMatchObject({ status: "signed", lastError: "Kafene activate HTTP 500" });
    // the admin can try again later; it works then
    kf.activate = () => json({ data: { status: "activated" } });
    expect(await admin().activate({ orderNumber: IDS.orderNumber })).toMatchObject({ ok: true });
    expect(callsTo("/activate")).toHaveLength(2);
  });

  it("two concurrent activates make ONE Kafene activate call", async () => {
    await signed();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    kf.activate = async () => { await gate; return json({ data: { status: "activated" } }); };
    const both = Promise.all([admin().activate({ orderNumber: IDS.orderNumber }), admin().activate({ orderNumber: IDS.orderNumber })]);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const results = await both;
    expect(callsTo("/activate")).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, reason: "not_signed" });
  });

  it("the claim is one compare-and-swap on the lease id and status signed", async () => {
    await signed();
    await admin().activate({ orderNumber: IDS.orderNumber });
    const claim = h.writes.find((w) => w.kind === "update" && w.table === "kafene_leases" && w.set?.status === "activating");
    expect(claim).toBeDefined();
    expect(claim!.sql).toMatch(/`kafene_leases`\.`id` = \?/);
    expect(claim!.sql).toMatch(/`kafene_leases`\.`status` = \?/);
    expect(claim!.params).toContain("signed");
  });

  it("an expired bearer (401) is refreshed and the activate is sent once more", async () => {
    await signed();
    kf.token401Once = true;
    expect(await admin().activate({ orderNumber: IDS.orderNumber })).toMatchObject({ ok: true });
    expect(callsTo("/v2/auth/token").length).toBeGreaterThanOrEqual(2);
  });

  it("a lease that is not signed is not_signed and Kafene is not called", async () => {
    await pub().start(IDS);
    expect(await admin().activate({ orderNumber: IDS.orderNumber })).toEqual({ ok: false, reason: "not_signed" });
    expect(callsTo("/activate")).toHaveLength(0);
  });
});

describe("admin cancel and status", () => {
  it("cancels at Kafene with the reason and marks the lease cancelled", async () => {
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
    expect(await admin().cancel({ orderNumber: IDS.orderNumber, reason: "Customer chose card" })).toMatchObject({ ok: true, status: "cancelled" });
    const [call] = callsTo("/cancel");
    expect(call.url.pathname).toBe("/v2/applications/app_123/cancel");
    expect(call.body).toEqual({ reason: "Customer chose card" });
    expect(leases()[0].status).toBe("cancelled");
    expect(leases()[0].cancelledAt).toBeInstanceOf(Date);
  });

  it("a lease Kafene never saw (no uid) is cancelled locally without a call", async () => {
    await pub().start(IDS);
    expect(await admin().cancel({ orderNumber: IDS.orderNumber, reason: "x" })).toMatchObject({ ok: true });
    expect(callsTo("/cancel")).toHaveLength(0);
  });

  it("status returns the order's latest lease, or null when it has none", async () => {
    expect(await admin().status({ orderNumber: IDS.orderNumber })).toEqual({ ok: true, lease: null });
    await pub().start(IDS);
    expect(await admin().status({ orderNumber: IDS.orderNumber })).toMatchObject({ ok: true, lease: { status: "started", merchandiseCents: 63000 } });
  });

  it("an unreadable database is an error, not 'no lease'", async () => {
    h.dbDown = true;
    await expect(admin().status({ orderNumber: IDS.orderNumber })).rejects.toThrow(/unavailable/i);
  });
});

describe("secrets", () => {
  it("no log line carries the API key or the bearer token, across failures", async () => {
    kf.meStatus = 500;
    await pub().config();
    await pub().start(IDS);
    await pub().attach({ ...IDS, uid: "app_123" });
    await pub().markSigned({ ...IDS, uid: "app_123" });
    kf.activate = () => json({ message: `bad token ${TOKEN}` }, 500);
    await admin().activate({ orderNumber: IDS.orderNumber });
    expect(h.logLines.some((l) => l.includes("/v2/me"))).toBe(true); // positive control
    const all = h.logLines.join("\n");
    expect(all).not.toContain(API_KEY);
    expect(all).not.toContain(TOKEN);
  });
});

// Manager 2026-10-18: a website "Apply with Kafene" click must reach the shop even before any
// KAFENE_* key exists. applyStarted records an "applied" lease and sends ONE Telegram per order
// per 24 h; it never answers "disabled".
describe("applyStarted (works with no Kafene keys)", () => {
  const TELEGRAM = "Kafene: Pat started an application for order TO-20261018-011 (LANDSAIL LS388 215/55R16 x4, $630.00). Look it up in merchant.kafene.com by phone when they come in. Phone ends in 0100.";
  const noKeys = () => { for (const k of ["KAFENE_MERCHANT_ID", "KAFENE_STORE_ID", "KAFENE_API_KEY"]) delete process.env[k]; };

  it("with no keys: records an applied lease, notes the order and sends exactly the Telegram; no Kafene call", async () => {
    noKeys();
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(leases()).toHaveLength(1);
    expect(leases()[0]).toMatchObject({ orderNumber: "TO-20261018-011", status: "applied", uid: null, merchandiseCents: 63000 });
    expect(String(order().adminNotes)).toMatch(/^Kafene application started from the website \d{4}-\d\d-\d\dT\S+Z$/);
    expect(h.telegrams).toEqual([TELEGRAM]);
    expect(order().paymentStatus).toBe("unpaid");
    expect(kf.calls).toEqual([]);
  });

  it("a second call within 24 h is ok with no second Telegram and no second row", async () => {
    noKeys();
    await pub().applyStarted(IDS);
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(h.telegrams).toHaveLength(1);
    expect(leases()).toHaveLength(1);
  });

  it("a server restart within 24 h does not repeat the Telegram (the applied row is the memory)", async () => {
    noKeys();
    await pub().applyStarted(IDS);
    vi.resetModules();
    ({ kafeneRouter } = await import("../routers/kafene"));
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(h.telegrams).toHaveLength(1);
    expect(leases()).toHaveLength(1);
  });

  it("after 24 h a new application is recorded and the shop told again", async () => {
    noKeys();
    vi.useFakeTimers({ toFake: ["Date"] });
    await pub().applyStarted(IDS);
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    await pub().applyStarted(IDS);
    expect(h.telegrams).toHaveLength(2);
    expect(leases()).toHaveLength(2);
  });

  it("works with the keys set too, and never answers disabled", async () => {
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(h.telegrams).toHaveLength(1);
  });

  it("an order already in the keyed checkout (an open lease) is ok without a new row or Telegram", async () => {
    await pub().start(IDS);
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(leases()).toHaveLength(1);
    expect(h.telegrams).toHaveLength(0);
  });

  it("refuses a wrong phone, a paid order and a cancelled order, telling nobody", async () => {
    noKeys();
    expect(await pub().applyStarted({ ...IDS, phone: "2165559999" })).toEqual({ ok: false, reason: "not_found" });
    seedOrder({ paymentStatus: "paid" });
    expect(await pub().applyStarted(IDS)).toEqual({ ok: false, reason: "already_paid" });
    seedOrder({ status: "cancelled" });
    expect(await pub().applyStarted(IDS)).toEqual({ ok: false, reason: "cancelled" });
    expect(h.telegrams).toEqual([]);
    expect(leases()).toEqual([]);
  });

  it("is limited per call per IP (a batched request is several calls): the 6th in an hour is rate_limited", async () => {
    noKeys();
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await pub().applyStarted(IDS));
    expect(results.slice(0, 5).every((r) => r.ok)).toBe(true);
    expect(results[5]).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("before migration 0148 (no table) the shop still hears once; a repeat in 24 h stays quiet", async () => {
    noKeys();
    h.missingTable = true;
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(await pub().applyStarted(IDS)).toEqual({ ok: true });
    expect(h.telegrams).toEqual([TELEGRAM]);
  });

  it("admin status shows the applied row with no keys set", async () => {
    noKeys();
    await pub().applyStarted(IDS);
    expect(await admin().status({ orderNumber: IDS.orderNumber })).toMatchObject({ ok: true, lease: { status: "applied", uid: null } });
  });
});