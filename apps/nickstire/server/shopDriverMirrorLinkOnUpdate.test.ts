/**
 * ShopDriver mirror: an invoice that is UPDATED while it has no customer is linked by PHONE (the ticket's,
 * else the one stored, first with 7+ digits). A NEW invoice keeps its phone-then-exact-name match and phone
 * fill. Before 2026-10-24 only the INSERT path matched; an invoice first mirrored before its customer
 * existed stayed unlinked forever (admin map C5: 478 of 3,138 invoices, 306 matchable by phone). The update
 * path never links by name and never fills a phone: a name judged against today's customers can name a
 * stranger who never had the car.
 *
 * Drives the real runFullMirror -> upsertInvoices over a stubbed ShopDriver API and a fake database that
 * honours the WHERE parameters and the selected columns, so a prefetch that forgets a column or a row
 * shows up here. Fixtures are made-up names and phones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This file needs the REAL drizzle builder, schema and subject; another file's mock must not leak in (AGENTS.md section 3).
// Specifiers are relative to this file. ./db and the services mocked below stay mocked on purpose.
vi.unmock("drizzle-orm");
vi.unmock("drizzle-orm/mysql-core");
vi.unmock("../drizzle/schema");
vi.unmock("./services/shopDriverMirror");

import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { invoices } from "../drizzle/schema";

type StoredInvoice = {
  id: number;
  invoiceNumber: string;
  totalAmount: number;
  algTicketId: string | null;
  customerId: number | null;
  customerPhone: string | null;
};
type Customer = { id: number; firstName: string | null; lastName: string | null; phone: string | null };
type Recorded = { vals: Record<string, unknown>; params: unknown[] };

const h = vi.hoisted(() => ({
  db: null as unknown,
  sendTelegram: vi.fn(async () => undefined),
}));

vi.mock("./db", () => ({ getDb: async () => h.db }));
vi.mock("./services/telegram", () => ({ sendTelegram: h.sendTelegram }));
// created > 0 fans out to the event bus, SSE, statenour and Nick memory: none of it is under test.
vi.mock("./services/eventBus", () => ({ dispatch: vi.fn(async () => undefined) }));
vi.mock("./services/realtimePush", () => ({ pushToAdminDashboards: vi.fn() }));
vi.mock("./services/realtime", () => ({ emitRevenueUpdate: vi.fn(), emitAlert: vi.fn() }));
vi.mock("./cron/jobs/statenourSync", () => ({ syncToStatenour: vi.fn(async () => undefined) }));
vi.mock("./services/nickMemory", () => ({ remember: vi.fn(async () => undefined) }));
// The lock needs a real transaction; here it hands the body a fake transaction (its writes are recorded
// apart from the plain ones) and the stored total.
vi.mock("./services/paymentIntentLock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/paymentIntentLock")>()),
  withInvoiceLock: async (_d: unknown, id: number, body: (tx: unknown, row: unknown) => Promise<unknown>) => {
    const row = state.invoices.find((r) => r.id === id);
    return row ? body(fakeDb(state.txUpdates), { totalAmount: row.totalAmount, paymentStatus: "paid" }) : null;
  },
  lockedTotalPatch: async (_tx: unknown, _id: number, current: number, next: number) =>
    next > 0 && next !== current ? { totalAmount: next } : {},
}));

const dialect = new MySqlDialect();
const state = {
  invoices: [] as StoredInvoice[],
  customers: [] as Customer[],
  updates: [] as Recorded[],
  txUpdates: [] as Recorded[],
  inserts: [] as Array<Record<string, unknown>>,
  tickets: [] as Array<Record<string, unknown>>,
  phoneLookups: [] as string[],
};

// Each selected alias reads the column it is bound to, as the database does: `{ phone10: customers.phone }` yields the raw text.
const pick = (row: object, fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([alias, col]) => [alias, (row as Record<string, unknown>)[(col as { name: string }).name]]));

/** customers.phone10 as TiDB generates it (drizzle/schema.ts): RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10). */
const withPhone10 = (c: Customer) => ({ ...c, phone10: c.phone == null ? null : c.phone.replace(/\D/g, "").slice(-10) });

function fakeDb(sink: Recorded[]) {
  return {
    select(fields: Record<string, unknown>) {
      return {
        from(table: unknown) {
          return {
            where(w: SQL) {
              const q = dialect.sqlToQuery(w);
              const wanted = q.params.map((p) => String(p).trim().toLowerCase());
              let rows: object[];
              if (table === invoices) rows = state.invoices.filter((r) => q.params.includes(r.invoiceNumber));
              else if (q.sql.includes("COLLATE")) rows = state.customers.filter((c) => wanted.includes(String(c.lastName ?? "").trim().toLowerCase()));
              // A phone lookup filters the column the query names: the raw one only sees the stored text, the generated one the digits.
              else if (/`phone10`\s+in\b/i.test(q.sql)) {
                state.phoneLookups.push(...q.params.map(String));
                rows = state.customers.map(withPhone10).filter((c) => c.phone10 != null && q.params.includes(c.phone10));
              } else if (/`phone`\s+in\b/i.test(q.sql)) rows = state.customers.filter((c) => c.phone != null && q.params.includes(c.phone));
              else throw new Error(`fake DB: unrecognised customer lookup: ${q.sql}`);
              return Promise.resolve(rows.map((r) => pick(r, fields)));
            },
          };
        },
      };
    },
    update() {
      return {
        set(vals: Record<string, unknown>) {
          return { where: (w: SQL) => { sink.push({ vals, params: dialect.sqlToQuery(w).params }); return Promise.resolve(); } };
        },
      };
    },
    insert() {
      return { values: (v: Record<string, unknown>) => { state.inserts.push(v); return Promise.resolve(); } };
    },
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubShopDriver() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/account/login")) return json({ token: "test-token-0123456789-abcdef" });
    if (url.includes("/api/ticket/listRecentTickets")) return json(url.includes("pageNumber=1&") ? state.tickets : []);
    return json({}, 404);
  }));
}

async function run() {
  const { runFullMirror } = await import("./services/shopDriverMirror");
  return runFullMirror();
}

/** The customer an UPDATE/INSERT sets: a plain id, or the COALESCE(customerId, id) guard the update path writes. */
function linkedTo(v: unknown): { id: number; guarded: boolean } | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return { id: v, guarded: false };
  const q = dialect.sqlToQuery(v as SQL);
  return { id: Number(q.params[0]), guarded: /coalesce\(\s*`?(?:invoices`?\.`)?customerId`?\s*,/i.test(q.sql) };
}

const stored = (over: Partial<StoredInvoice> & Pick<StoredInvoice, "id" | "invoiceNumber">): StoredInvoice => ({
  totalAmount: 10000, algTicketId: null, customerId: null, customerPhone: null, ...over,
});
const ticket = (invoiceNumber: string, over: Record<string, unknown> = {}) => ({
  invoiceNumber, totalAmount: 100, date: "2026-10-20T15:00:00Z", serviceDescription: "Tire rotation", ...over,
});
const updateFor = (id: number) => state.updates.find((u) => u.params.includes(id));

beforeEach(() => {
  vi.stubEnv("AUTO_LABOR_USERNAME", "test-user");
  vi.stubEnv("AUTO_LABOR_PASSWORD", "test-pass");
  state.invoices = [];
  state.updates = [];
  state.txUpdates = [];
  state.inserts = [];
  state.tickets = [];
  state.phoneLookups = [];
  state.customers = [
    { id: 11, firstName: "Alma", lastName: "Testfield", phone: "2165550111" },
    { id: 22, firstName: "Dana", lastName: "Smithson", phone: "2165550122" },
    { id: 23, firstName: "Rory", lastName: "Smithson", phone: "2165550123" },
    { id: 41, firstName: "Pat", lastName: "Orlov", phone: "2165550141" },
    { id: 42, firstName: "Pat", lastName: "Orlov", phone: "2165550142" },
    { id: 31, firstName: "Ana", lastName: "Alder", phone: "2165550131" },
    { id: 32, firstName: "Ben", lastName: "Birch", phone: "2165550132" },
    { id: 51, firstName: "Cy", lastName: "Short", phone: "216555" },
    // Stored formatted: phone10 is "2165550100" and "5550152"; only a lookup on phone10 can find them from bare digits.
    { id: 61, firstName: "Eve", lastName: "Formatted", phone: "+1 (216) 555-0100" },
    { id: 52, firstName: "Gus", lastName: "Seven", phone: "555-0152" },
  ];
  h.db = { ...fakeDb(state.updates), execute: async () => [[{ rev: 0, cnt: 0 }]] };
  h.sendTelegram.mockClear();
  stubShopDriver();
});

// The fake fetch and env must not outlive this file (AGENTS.md section 3): the config only restores them before the NEXT test.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("instrument: the harness reaches upsertInvoices", () => {
  it("a NEW invoice is still linked on insert by phone, and by exactly-one name with the customer's phone", async () => {
    state.tickets = [
      ticket("N-1", { customerName: "Whoever", primaryNumber: "(216) 555-0111" }),
      ticket("N-2", { customerName: "Smithson, Dana" }),
    ];
    const r = await run();
    expect(r.invoicesFetched).toBe(2);
    expect(r.invoiceWriteErrors).toBe(0);
    const byNumber = Object.fromEntries(state.inserts.map((i) => [i.invoiceNumber as string, i]));
    expect(byNumber["N-1"].customerId).toBe(11);
    expect(byNumber["N-2"].customerId).toBe(22);
    expect(byNumber["N-2"].customerPhone).toBe("2165550122");
    expect(h.sendTelegram).not.toHaveBeenCalled();
  });
});

describe("an existing invoice with no customer is linked on update", () => {
  it("links by phone when the payload phone maps to exactly one customer", async () => {
    state.invoices = [stored({ id: 101, invoiceNumber: "U-1" })];
    state.tickets = [ticket("U-1", { customerName: "Whoever", primaryNumber: "(216) 555-0111" })];
    await run();
    const up = updateFor(101);
    expect(linkedTo(up?.vals.customerId)?.id).toBe(11);
  });

  it("writes the link as COALESCE(customerId, id) so a customer set meanwhile is never overwritten", async () => {
    state.invoices = [stored({ id: 101, invoiceNumber: "U-1" })];
    state.tickets = [ticket("U-1", { primaryNumber: "2165550111" })];
    await run();
    expect(linkedTo(updateFor(101)?.vals.customerId)).toEqual({ id: 11, guarded: true });
  });

  it("falls back to the phone already on the invoice when the payload carries none, and writes no phone", async () => {
    state.invoices = [stored({ id: 105, invoiceNumber: "U-5", customerPhone: "2165550111" })];
    state.tickets = [ticket("U-5", { customerName: "Unknown" })];
    await run();
    const up = updateFor(105);
    expect(linkedTo(up?.vals.customerId)?.id).toBe(11);
    expect(up?.vals).not.toHaveProperty("customerPhone");
  });

  it("a ticket phone shorter than 7 digits does not hide a good stored phone", async () => {
    state.invoices = [stored({ id: 107, invoiceNumber: "U-7", customerPhone: "2165550111" })];
    state.tickets = [ticket("U-7", { primaryNumber: "216555" })];
    await run();
    expect(linkedTo(updateFor(107)?.vals.customerId)?.id).toBe(11);
  });

  it("tries the ticket's phone before the one stored on the invoice when both are usable", async () => {
    state.invoices = [stored({ id: 108, invoiceNumber: "U-8", customerPhone: "2165550132" })];
    state.tickets = [ticket("U-8", { primaryNumber: "2165550131" })];
    await run();
    expect(linkedTo(updateFor(108)?.vals.customerId)?.id).toBe(31);
  });

  it("the phone wins over the name: a ticket phone that maps to one customer links to THAT customer", async () => {
    state.invoices = [stored({ id: 104, invoiceNumber: "U-4" })];
    state.tickets = [ticket("U-4", { customerName: "Smithson, Dana", primaryNumber: "2165550111" })];
    await run();
    expect(linkedTo(updateFor(104)?.vals.customerId)?.id).toBe(11);
  });

  it("rides the locked write when the total also changes", async () => {
    state.invoices = [stored({ id: 106, invoiceNumber: "U-6", totalAmount: 5000 })];
    state.tickets = [ticket("U-6", { primaryNumber: "2165550111", totalAmount: 100 })];
    await run();
    expect(state.updates).toHaveLength(0);
    const up = state.txUpdates.find((u) => u.params.includes(106));
    expect(up?.vals.totalAmount).toBe(10000);
    expect(linkedTo(up?.vals.customerId)?.id).toBe(11);
  });
});

// Both paths look customers up on customers.phone10 (the unique generated last-10 digits), not on the raw text, so a
// customer stored as "+1 (216) 555-0100" is found from bare digits. The ticket phone reaches the prefetch already
// digits-only (normalizePhone at ingest); the key is the same rule the column applies: strip non-digits, last 10.
describe("a customer stored with a formatted phone is found by its digits", () => {
  it.each([
    ["bare 10 digits", "2165550100"],
    ["punctuated", "(216) 555-0100"],
    ["11 digits with the leading 1", "12165550100"],
    ["+1 and dashes", "+1 216-555-0100"],
  ])("update links an unlinked invoice whose ticket phone is %s", async (_shape, primaryNumber) => {
    state.invoices = [stored({ id: 301, invoiceNumber: "F-1" })];
    state.tickets = [ticket("F-1", { primaryNumber })];
    await run();
    expect(linkedTo(updateFor(301)?.vals.customerId)).toEqual({ id: 61, guarded: true });
  });

  it("insert links a NEW invoice to the same customer", async () => {
    state.tickets = [ticket("F-2", { primaryNumber: "(216) 555-0100" })];
    await run();
    expect(state.inserts.find((i) => i.invoiceNumber === "F-2")?.customerId).toBe(61);
  });

  it("falls back to a stored invoice phone kept as +E.164 (11 digits), not only the bare 10 digits the mirror writes", async () => {
    state.invoices = [stored({ id: 304, invoiceNumber: "F-5", customerPhone: "+12165550100" })];
    state.tickets = [ticket("F-5")];
    await run();
    expect(linkedTo(updateFor(304)?.vals.customerId)).toEqual({ id: 61, guarded: true });
  });

  it("a 7-digit phone is still tried and matches only a customer whose digits are exactly those 7, never a suffix of a 10-digit one", async () => {
    state.invoices = [stored({ id: 302, invoiceNumber: "F-3" }), stored({ id: 303, invoiceNumber: "F-4" })];
    state.tickets = [ticket("F-3", { primaryNumber: "5550152" }), ticket("F-4", { primaryNumber: "5550100" })];
    await run();
    expect(linkedTo(updateFor(302)?.vals.customerId)?.id).toBe(52);
    expect(updateFor(303)?.vals).not.toHaveProperty("customerId");
  });
});

describe("an existing invoice is left alone when linking would be a guess or a move", () => {
  // An old phoneless invoice whose ticket name matches ONE customer today may be a namesake who never had the
  // car; linking it or copying that person's phone would make it textable about someone else's job
  // (serviceReminders plans texts from invoices.customerPhone). N-9 is a NEW invoice with the same name, so
  // the name map is loaded: only the update path's phone-only rule keeps U-2 and U-3 alone.
  it("update never links by name, even an exactly-one first+last match", async () => {
    state.invoices = [stored({ id: 102, invoiceNumber: "U-2" })];
    state.tickets = [ticket("N-9", { customerName: "Smithson, Dana" }), ticket("U-2", { customerName: "SMITHSON, DANA" })];
    await run();
    expect(state.inserts.find((i) => i.invoiceNumber === "N-9")?.customerId).toBe(22);
    expect(updateFor(102)?.vals).not.toHaveProperty("customerId");
  });

  it("update never fills a phone from a customer, and keeps the ticket's own phone", async () => {
    state.invoices = [stored({ id: 103, invoiceNumber: "U-3" }), stored({ id: 104, invoiceNumber: "U-4" })];
    state.tickets = [
      ticket("N-9", { customerName: "Smithson, Dana" }),
      ticket("U-3", { customerName: "Smithson, Dana" }),
      ticket("U-4", { customerName: "Smithson, Dana", primaryNumber: "2165550888" }),
    ];
    await run();
    expect(updateFor(103)?.vals).not.toHaveProperty("customerPhone");
    expect(updateFor(104)?.vals.customerPhone).toBe("2165550888");
    expect(updateFor(104)?.vals).not.toHaveProperty("customerId");
  });

  it("a ticket phone of 6 digits does not link, even to a customer stored with that 6-digit number", async () => {
    state.invoices = [stored({ id: 206, invoiceNumber: "X-6" }), stored({ id: 207, invoiceNumber: "X-7", customerPhone: "216555" })];
    state.tickets = [ticket("X-6", { primaryNumber: "216555" }), ticket("X-7"), ticket("X-8", { primaryNumber: "216555" })];
    await run();
    expect(updateFor(206)?.vals).not.toHaveProperty("customerId");
    expect(updateFor(207)?.vals).not.toHaveProperty("customerId");
    expect(state.inserts.find((i) => i.invoiceNumber === "X-8")?.customerId).toBeNull();
    // The 6-digit number (stored invoice or new one) never even reaches the customer lookup.
    expect(state.phoneLookups).not.toContain("216555");
  });

  it("stays unlinked on a surname shared by several people (no first name)", async () => {
    state.invoices = [stored({ id: 201, invoiceNumber: "X-1" })];
    state.tickets = [ticket("X-1", { customerName: "Smithson" })];
    await run();
    expect(updateFor(201)?.vals).not.toHaveProperty("customerId");
    expect(updateFor(201)?.vals).not.toHaveProperty("customerPhone");
  });

  it("stays unlinked when first AND last name still match two customers", async () => {
    state.invoices = [stored({ id: 202, invoiceNumber: "X-2" })];
    state.tickets = [ticket("X-2", { customerName: "Orlov, Pat" })];
    await run();
    expect(updateFor(202)?.vals).not.toHaveProperty("customerId");
  });

  it("stays unlinked when nothing matches", async () => {
    state.invoices = [stored({ id: 203, invoiceNumber: "X-3" })];
    state.tickets = [ticket("X-3", { customerName: "Nobody, Nemo", primaryNumber: "2165550000" })];
    await run();
    expect(updateFor(203)?.vals).not.toHaveProperty("customerId");
  });

  it("does not move an invoice already linked to customer A onto customer B", async () => {
    // X-4b is unlinked and carries B's phone, so B is in the batch's maps: only the "has a customer" rule stops X-4.
    state.invoices = [
      stored({ id: 204, invoiceNumber: "X-4", customerId: 31, customerPhone: "2165550131" }),
      stored({ id: 205, invoiceNumber: "X-4b" }),
    ];
    state.tickets = [
      ticket("X-4", { customerName: "Birch, Ben", primaryNumber: "2165550132" }),
      ticket("X-4b", { primaryNumber: "2165550132" }),
    ];
    await run();
    expect(linkedTo(updateFor(205)?.vals.customerId)?.id).toBe(32);
    expect(updateFor(204)?.vals).not.toHaveProperty("customerId");
  });
});
