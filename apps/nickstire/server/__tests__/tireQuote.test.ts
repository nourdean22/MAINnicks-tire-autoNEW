/**
 * tireQuote.text · "Text me this quote" on the /tires top-pick cards.
 *
 * Driven through the real router (createCaller, public ctx) with the REAL
 * sendCustomerMessage underneath; only the DB handle, sendSms, Telegram and
 * the logger are replaced. The fake DB evaluates the rendered WHERE of every
 * select, so the five-minute dedupe is tested against its real clauses.
 *
 * Promises pinned here:
 *   - a quote is a tire_orders row (same record and admin tab as "Request these"),
 *     status received, never an invoice, never a booking;
 *   - exactly ONE customer text per quote, through the quoteTexted template, as a
 *     customer_confirmation (the class whose opt-out and pause rules apply);
 *   - an opted-out number is refused by sendSms and NOT retried; the row and the
 *     staff Telegram still happen so the shop can call back;
 *   - an uncertain gateway outcome is reported as uncertain and not retried;
 *   - the staff Telegram carries the phone's last four digits only;
 *   - a price under the $50 floor stores nothing and texts nothing;
 *   - the tire and price must be a supplier-feed row for the size, and the feed's own names are texted;
 *   - with ENABLE_CUSTOMER_CONFIRMATIONS unset the row is stored and no text goes out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state = {
    tables: { tire_orders: [] as Row[], sms_messages: [] as Row[], audit_log: [] as Row[] } as Record<string, Row[]>,
    dbDown: false,
    /** Next N inserts throw a duplicate-key error (order number collision). */
    dupInserts: 0,
    sms: [] as Array<{ to: string; body: string; opts: Record<string, unknown> }>,
    smsResult: { success: true, sid: "SM1" } as Record<string, unknown>,
    telegrams: [] as Array<{ text: string; cls: string }>,
    audits: [] as Row[],
    logs: [] as string[],
    /** Pipeline price cache for the size (null = cold), and the live supplier answer (null = unreachable). */
    feed: null as Row[] | null,
    live: null as Row[] | null,
  };
  const nameOf = (t: unknown): string => {
    const sym = Object.getOwnPropertySymbols(t as object).find((s) => s.description === "drizzle:Name");
    return (t as Record<symbol, string>)[sym as symbol];
  };
  const CLAUSE = /`\w+`\.`(\w+)` (= \?|is null|is not null)/g;
  /** eq / is-null clauses from the rendered SQL; other clauses (>= ?, <> 'x') are not evaluated. */
  const matches = async (cond: unknown, row: Row): Promise<boolean> => {
    if (!cond) return true;
    const { MySqlDialect } = await import("drizzle-orm/mysql-core");
    const { sql, params } = new MySqlDialect().sqlToQuery(cond as never);
    let p = 0;
    let ok = true;
    for (const m of sql.matchAll(CLAUSE)) {
      const v = row[m[1]] ?? null;
      if (m[2] === "is null") ok = ok && v === null;
      else if (m[2] === "is not null") ok = ok && v !== null;
      else ok = ok && v === params[p++];
    }
    return ok;
  };
  const fake = {
    select: () => {
      let table = "";
      let cond: unknown;
      const b = {
        from(t: unknown) { table = nameOf(t); return b; },
        where(c: unknown) { cond = c; return b; },
        orderBy() { return b; },
        async limit(n: number) {
          const out: Row[] = [];
          for (const r of state.tables[table] ?? []) if (await matches(cond, r)) out.push(r);
          // The rows were read; the answer still has to travel back. Yield a macrotask here so two
          // concurrent callers both read before either writes, as they would against TiDB.
          await new Promise((r) => setImmediate(r));
          return out.slice(0, n);
        },
      };
      return b;
    },
    insert: (t: unknown) => ({
      async values(v: Row) {
        if (state.dupInserts > 0) {
          state.dupInserts--;
          throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
        }
        const rows = state.tables[nameOf(t)];
        rows.push({ id: rows.length + 1, createdAt: new Date(), ...v });
      },
    }),
    /** send_pause_customer_confirmations read: no row, not paused. */
    execute: async () => [[]],
  };
  return { ...state, fake };
});

vi.mock("../lib/logger", () => ({
  createLogger: (module: string) => {
    const rec = (level: string) => (msg: string, ...args: unknown[]) => {
      h.logs.push(`${level} ${module} ${msg} ${args.map((a) => (a instanceof Error ? a.message : JSON.stringify(a))).join(" ")}`);
    };
    return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
  },
}));
vi.mock("../services/adminSecurity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/adminSecurity")>();
  return { ...actual, getAdminSecurityState: async () => ({ ...actual.MFA_NOT_REQUIRED_STATE }) };
});
vi.mock("../lib/adminActivity", () => ({ touchAdminActivity: () => undefined }));
vi.mock("../lib/db-helper", () => ({
  db: async () => (h.dbDown ? null : h.fake),
  dbTyped: async () => (h.dbDown ? null : h.fake),
}));
vi.mock("../db", () => ({
  getDb: async () => (h.dbDown ? null : h.fake),
  getDbTyped: async () => (h.dbDown ? null : h.fake),
}));
vi.mock("../sms", () => ({
  sendSms: async (to: string, body: string, opts: Record<string, unknown>) => {
    h.sms.push({ to, body, opts });
    return h.smsResult;
  },
}));
vi.mock("../services/telegram", () => ({
  sendTelegram: async (text: string, cls: string) => { h.telegrams.push({ text, cls }); return true; },
}));
vi.mock("../services/auditTrail", () => ({
  logAdminAction: async (d: Row) => { h.audits.push(d); },
}));
vi.mock("../services/dataPipelines", () => ({ getCachedPrices: () => h.feed }));
vi.mock("../services/gatewayClient", () => ({
  searchTiresBySize: async () => h.live,
  pickWholesaleCost: (item: Row) => Number(item.cost),
}));

/** What publicSearch shows for 215/60R16 at the default 100% markup: $76.50 cost -> $153.00 a tire. */
const FEED: Row[] = ["Defender 2", "CrossClimate 2", "Pilot Sport 4"].map((model) => ({
  brand: "Michelin", model, size: "215/60R16", wholesaleCost: 76.5, localQty: 4, fetchedAt: Date.now(),
}));

import { _resetQuoteClaimsForTest, tireQuoteRouter } from "../routers/tireQuote";

const ctx = () => ({ req: { ip: "203.0.113.5", headers: {} }, res: {} }) as unknown as TrpcContext;
const caller = () => tireQuoteRouter.createCaller(ctx());

const QUOTE = {
  phone: "(216) 555-0123",
  tireBrand: "Michelin",
  tireModel: "Defender 2",
  tireSize: "215/60R16",
  quantity: 4,
  pricePerTireCents: 15300,
  pick: "value" as const,
  vehicle: { year: 2019, make: "Honda", model: "Civic", trim: "LX" },
};

const ORIG_FLAG = process.env.ENABLE_CUSTOMER_CONFIRMATIONS;

describe("tireQuote.text", () => {
  beforeEach(async () => {
    h.tables.tire_orders = [];
    h.tables.sms_messages = [];
    h.tables.audit_log = [];
    h.dbDown = false;
    h.dupInserts = 0;
    h.sms = [];
    h.smsResult = { success: true, sid: "SM1" };
    h.telegrams = [];
    h.audits = [];
    h.logs = [];
    h.feed = FEED;
    h.live = null;
    process.env.ENABLE_CUSTOMER_CONFIRMATIONS = "true";
    _resetQuoteClaimsForTest();
    const { _resetSendPauseCacheForTest } = await import("../services/sendPause");
    _resetSendPauseCacheForTest();
  });
  afterEach(() => {
    if (ORIG_FLAG === undefined) delete process.env.ENABLE_CUSTOMER_CONFIRMATIONS;
    else process.env.ENABLE_CUSTOMER_CONFIRMATIONS = ORIG_FLAG;
  });

  it("stores the quote as a received tire_orders row and texts it once through the quoteTexted template", async () => {
    const res = await caller().text(QUOTE);
    expect(res).toMatchObject({ ok: true, sms: "sent" });

    expect(h.tables.tire_orders).toHaveLength(1);
    const row = h.tables.tire_orders[0];
    expect(row).toMatchObject({
      customerPhone: "2165550123",
      tireBrand: "Michelin",
      tireModel: "Defender 2",
      tireSize: "215/60R16",
      quantity: 4,
      pricePerTire: 15300,
      serviceFeePerTire: 0,
      totalAmount: 61200,
      status: "received",
      vehicleInfo: "2019 Honda Civic LX",
      customerEmail: null,
    });
    expect(row.invoiceId).toBeUndefined(); // a quote is not a job: no invoice, no booking
    // TQ-, not TO-: the persisted mark that keeps a quote out of checkout, Kafene, order dedupe and the stats.
    expect(String(row.orderNumber)).toMatch(/^TQ-\d{8}-\d{3}$/);
    expect(String(row.customerNotes)).toMatch(/quote by text/i);
    expect(res).toMatchObject({ orderNumber: row.orderNumber });

    expect(h.sms).toHaveLength(1);
    const [text] = h.sms;
    expect(text.to).toBe("2165550123");
    expect(text.opts.messageClass).toBe("customer_confirmation");
    expect(text.opts.variantKey).toBe(`confirm:quoteTexted:${row.orderNumber}`);
    expect(text.body).toContain("$612.00");
    expect(text.body).toContain("215/60R16");
    expect(text.body).toContain("2019 Honda Civic LX");
    expect(text.body).toContain("https://nickstire.org/tires?size=215/60R16");
    expect(text.body).toContain("Payment Programs");
    expect(text.body).not.toMatch(/financ/i);
  });

  it("tells the shop on Telegram as an incident (a customer is waiting; receipts are held by default) with the phone masked to its last four digits", async () => {
    await caller().text(QUOTE);
    expect(h.telegrams).toHaveLength(1);
    const { text, cls } = h.telegrams[0];
    expect(cls).toBe("incident");
    expect(text).toContain("0123");
    expect(text).not.toContain("2165550123");
    expect(text).not.toContain("555-0123");
    expect(text).toContain("Michelin Defender 2");
    expect(text).toContain("$612.00");
    expect(text).toContain("2019 Honda Civic LX");
  });

  it("an opted-out number: sendSms refuses once, nothing is retried, the row and the Telegram still happen", async () => {
    h.smsResult = { success: false, error: "Customer opted out of SMS" };
    const res = await caller().text(QUOTE);
    expect(res).toMatchObject({ ok: true, sms: "not_sent" });
    expect(h.sms).toHaveLength(1);
    expect(h.tables.tire_orders).toHaveLength(1);
    expect(h.telegrams).toHaveLength(1);
    expect(h.telegrams[0].text).toMatch(/not sent|refused|opted out/i);
  });

  it("an uncertain gateway outcome is reported as uncertain and never retried", async () => {
    h.smsResult = { success: true, uncertain: true, error: "gateway timeout" };
    const res = await caller().text(QUOTE);
    expect(res).toMatchObject({ ok: true, sms: "uncertain" });
    expect(h.sms).toHaveLength(1);
  });

  it("a queued text (quiet hours would park it) is reported as queued, not sent", async () => {
    h.smsResult = { success: true, queued: true };
    const res = await caller().text(QUOTE);
    expect(res).toMatchObject({ ok: true, sms: "queued" });
  });

  it("the same phone and tire inside five minutes reuses the row: no second row, no second text", async () => {
    const first = await caller().text(QUOTE);
    const again = await caller().text({ ...QUOTE, phone: "216-555-0123" });
    expect(again).toMatchObject({ ok: true, sms: "duplicate", orderNumber: (first as { orderNumber: string }).orderNumber });
    expect(h.tables.tire_orders).toHaveLength(1);
    expect(h.sms).toHaveLength(1);
    expect(h.telegrams).toHaveLength(1);
    // A different tire for the same phone is a new quote.
    const other = await caller().text({ ...QUOTE, tireModel: "CrossClimate 2" });
    expect(other).toMatchObject({ ok: true, sms: "sent" });
    expect(h.tables.tire_orders).toHaveLength(2);
  });

  it("two concurrent submissions of the same quote: one row, one text (the claim is taken before the first await)", async () => {
    const [a, b] = await Promise.all([caller().text(QUOTE), caller().text({ ...QUOTE, phone: "216-555-0123" })]);
    expect(h.tables.tire_orders).toHaveLength(1);
    expect(h.sms).toHaveLength(1);
    expect([a, b].filter((r) => r.ok && r.sms === "sent")).toHaveLength(1);
    expect([a, b].filter((r) => r.ok && r.sms === "duplicate")).toHaveLength(1);
  });

  it("a price under the $50 floor stores nothing and texts nothing", async () => {
    const res = await caller().text({ ...QUOTE, pricePerTireCents: 100 });
    expect(res).toEqual({ ok: false, reason: "price" });
    expect(h.tables.tire_orders).toHaveLength(0);
    expect(h.sms).toHaveLength(0);
    expect(h.telegrams).toHaveLength(0);
  });

  it("rejects a phone that is not ten US digits before touching the DB", async () => {
    await expect(caller().text({ ...QUOTE, phone: "555-0123" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.tables.tire_orders).toHaveLength(0);
  });

  it("rejects a tire name or size that carries markup or a link (the text echoes them)", async () => {
    for (const bad of [{ tireModel: "Defender <b>2</b>" }, { tireBrand: "see https://evil.test" }, { tireSize: "215/60R16 call me" }]) {
      await expect(caller().text({ ...QUOTE, ...bad })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(h.tables.tire_orders).toHaveLength(0);
  });

  it("accepts an 11-digit number with the US country code and stores the ten digits", async () => {
    await caller().text({ ...QUOTE, phone: "+1 216 555 0123" });
    expect(h.tables.tire_orders[0].customerPhone).toBe("2165550123");
  });

  it("without a vehicle the row and the text carry the size only", async () => {
    await caller().text({ ...QUOTE, vehicle: undefined });
    expect(h.tables.tire_orders[0].vehicleInfo).toBeNull();
    expect(h.sms[0].body).not.toMatch(/for your/);
    expect(h.sms[0].body).toContain("215/60R16");
  });

  it("ENABLE_CUSTOMER_CONFIRMATIONS unset: the row is stored, no text goes out, the customer is told it was not sent", async () => {
    delete process.env.ENABLE_CUSTOMER_CONFIRMATIONS;
    const res = await caller().text(QUOTE);
    expect(res).toMatchObject({ ok: true, sms: "not_sent" });
    expect(h.tables.tire_orders).toHaveLength(1);
    expect(h.sms).toHaveLength(0);
    expect(h.telegrams).toHaveLength(1);
  });

  it("an order-number collision is retried, never surfaced to the customer", async () => {
    h.dupInserts = 1;
    const res = await caller().text(QUOTE);
    expect(res).toMatchObject({ ok: true, sms: "sent" });
    expect(h.tables.tire_orders).toHaveLength(1);
  });

  it("DB unavailable: upstream_error, nothing texted", async () => {
    h.dbDown = true;
    const res = await caller().text(QUOTE);
    expect(res).toEqual({ ok: false, reason: "upstream_error" });
    expect(h.sms).toHaveLength(0);
  });

  it("a tire name the supplier feed does not list for this size is refused: no row, no text (the text echoes the name)", async () => {
    const res = await caller().text({ ...QUOTE, tireModel: "Defender 2 FREE ROTATIONS FOR LIFE" });
    expect(res).toEqual({ ok: false, reason: "price" });
    expect(h.tables.tire_orders).toHaveLength(0);
    expect(h.sms).toHaveLength(0);
    expect(h.telegrams).toHaveLength(0);
  });

  it("a price that is not the feed's price for that tire is refused, above the floor too", async () => {
    for (const pricePerTireCents of [9900, 15299, 15301, 99900]) {
      expect(await caller().text({ ...QUOTE, pricePerTireCents })).toEqual({ ok: false, reason: "price" });
    }
    expect(h.tables.tire_orders).toHaveLength(0);
    expect(h.sms).toHaveLength(0);
  });

  it("the row and the text carry the feed's own brand and model, not the client's spelling", async () => {
    await caller().text({ ...QUOTE, tireBrand: "MICHELIN", tireModel: "defender 2" });
    expect(h.tables.tire_orders[0]).toMatchObject({ tireBrand: "Michelin", tireModel: "Defender 2", pricePerTire: 15300 });
    expect(h.sms[0].body).toContain("Michelin Defender 2");
  });

  it("price cache cold: the live supplier feed is checked the way publicSearch shows it (brand upper-cased, BRAND - prefix stripped)", async () => {
    h.feed = null;
    h.live = [{ make: "Michelin", minor_name: "MICH - DEFENDER 2", cost: 76.5 }];
    const res = await caller().text({ ...QUOTE, tireBrand: "MICHELIN", tireModel: "DEFENDER 2" });
    expect(res).toMatchObject({ ok: true, sms: "sent" });
    expect(h.tables.tire_orders[0]).toMatchObject({ tireBrand: "MICHELIN", tireModel: "DEFENDER 2" });
  });

  it("feed unreadable (cache cold, supplier unreachable): upstream_error, nothing stored or texted", async () => {
    h.feed = null;
    h.live = null;
    expect(await caller().text(QUOTE)).toEqual({ ok: false, reason: "upstream_error" });
    expect(h.tables.tire_orders).toHaveLength(0);
    expect(h.sms).toHaveLength(0);
  });

  it("never logs the full phone number", async () => {
    await caller().text(QUOTE);
    h.smsResult = { success: false, error: "Customer opted out of SMS" };
    await caller().text({ ...QUOTE, tireModel: "Pilot Sport 4" });
    expect(h.logs.join("\n")).not.toContain("2165550123");
  });
});
