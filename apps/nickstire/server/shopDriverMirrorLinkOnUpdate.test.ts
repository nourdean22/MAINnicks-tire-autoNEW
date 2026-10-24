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
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
};

const pick = (row: object, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));

function fakeDb(sink: Recorded[]) {
  return {
    select(fields: Record<string, unknown>) {
      const keys = Object.keys(fields);
      return {
        from(table: unknown) {
          return {
            where(w: SQL) {
              const q = dialect.sqlToQuery(w);
              const wanted = q.params.map((p) => String(p).trim().toLowerCase());
              let rows: object[];
              if (table === invoices) rows = state.invoices.filter((r) => q.params.includes(r.invoiceNumber));
              else if (q.sql.includes("COLLATE")) rows = state.customers.filter((c) => wanted.includes(String(c.lastName ?? "").trim().toLowerCase()));
              else rows = state.customers.filter((c) => c.phone != null && q.params.includes(c.phone));
              return Promise.resolve(rows.map((r) => pick(r, keys)));
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
  state.customers = [
    { id: 11, firstName: "Alma", lastName: "Testfield", phone: "2165550111" },
    { id: 22, firstName: "Dana", lastName: "Smithson", phone: "2165550122" },
    { id: 23, firstName: "Rory", lastName: "Smithson", phone: "2165550123" },
    { id: 41, firstName: "Pat", lastName: "Orlov", phone: "2165550141" },
    { id: 42, firstName: "Pat", lastName: "Orlov", phone: "2165550142" },
    { id: 31, firstName: "Ana", lastName: "Alder", phone: "2165550131" },
    { id: 32, firstName: "Ben", lastName: "Birch", phone: "2165550132" },
    { id: 51, firstName: "Cy", lastName: "Short", phone: "216555" },
  ];
  h.db = { ...fakeDb(state.updates), execute: async () => [[{ rev: 0, cnt: 0 }]] };
  h.sendTelegram.mockClear();
  stubShopDriver();
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
    state.tickets = [ticket("X-6", { primaryNumber: "216555" }), ticket("X-7")];
    await run();
    expect(updateFor(206)?.vals).not.toHaveProperty("customerId");
    expect(updateFor(207)?.vals).not.toHaveProperty("customerId");
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
