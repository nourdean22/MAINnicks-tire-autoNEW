/**
 * Q-12 phase 1c · ADR-0019 §9 completeness report.
 *
 * The contract: a business row whose outbox row exists is matched; one without
 * is missing (split by the row's source); an outbox row with no business row is
 * extra. The expected key is the one shadowEnqueue actually writes. And the
 * report never turns "not recording" or "table not there" into a zero.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  getDb: vi.fn<() => Promise<any>>(),
  rows: new Map<unknown, unknown[] | Error>(),
  selects: new Map<unknown, Record<string, unknown>>(),
  execute: vi.fn(),
}));

vi.mock("./featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("../db", () => ({ getDb: h.getDb }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { bookings, bridgeOutbox, callbackRequests, emergencyRequests, leads } from "../../drizzle/schema";
import { shadowEnqueue } from "./bridgeOutbox";
import { bridgeOutboxCompleteness } from "./bridgeOutboxCompleteness";

/** A select().from(table).where() chain that resolves to the rows set for that table. */
function fakeDb() {
  return {
    execute: h.execute,
    select: (fields: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: async () => {
          h.selects.set(table, fields);
          const r = h.rows.get(table);
          if (r instanceof Error) throw r;
          return r ?? [];
        },
      }),
    }),
  };
}

/** A business row as the SQL returns it: shop day and in-window flag computed in SQL. */
const row = (id: number, day: string, source?: string, inWindow: number | string = 1) => ({ id, day, inWindow, source });

/** Run the report over one family's rows and outbox keys; the other families are empty. */
async function family(
  table: unknown,
  name: string,
  rows: Array<ReturnType<typeof row>>,
  outbox: Array<{ key: string; eventType: string }>,
) {
  h.rows.clear();
  h.rows.set(table, rows);
  h.rows.set(bridgeOutbox, outbox);
  const r = await bridgeOutboxCompleteness();
  if (r.state !== "measured") throw new Error(`state ${r.state}`);
  return r.families.find((f) => f.family === name)!;
}

describe("completeness comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isEnabled.mockResolvedValue(true);
    h.getDb.mockResolvedValue(fakeDb());
  });

  it("counts matched, missing (by source) and extra per UTC day", async () => {
    const lead = (id: number) => ({ key: `v1:lead.created:lead:${id}`, eventType: "lead.created" });
    const r = await family(
      leads,
      "leads",
      [
        row(1, "2026-10-01", "popup"),
        row(2, "2026-10-01", "callback"),
        row(3, "2026-10-02", "popup"),
      ],
      [lead(1), lead(3), lead(99)],
    );
    expect(r).toMatchObject({ source: 3, matched: 2, missing: 1, extra: 1 });
    expect(r.days).toEqual([
      { day: "2026-10-01", source: 2, matched: 1, missing: 1, missingBySource: { callback: 1 } },
      { day: "2026-10-02", source: 1, matched: 1, missing: 0, missingBySource: {} },
    ]);
  });

  it("does not count an outbox row as extra when its business row sits just before the window", async () => {
    const outbox = [{ key: "v1:shop.booking.created:booking:7", eventType: "shop.booking.created" }];
    // Read as context (the extra day before the window), so not counted, but known.
    // inWindow "0" as a string must not count as in-window either.
    const edge = await family(bookings, "bookings", [row(7, "2026-09-28", undefined, "0")], outbox);
    expect(edge).toMatchObject({ source: 0, extra: 0 });
    const none = await family(bookings, "bookings", [], outbox);
    expect(none.extra).toBe(1);
  });

  it("expects exactly the key shadowEnqueue writes, for every family", async () => {
    const written = async (type: Parameters<typeof shadowEnqueue>[0]["type"], id: number) => {
      h.getDb.mockResolvedValue({ execute: h.execute });
      h.execute.mockReset();
      h.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
      await shadowEnqueue({ type, data: { id }, priority: "high", source: "t", timestamp: "2026-10-01T15:00:00.000Z" });
      const q = h.execute.mock.calls[0][0] as { queryChunks: unknown[] };
      const chunks = q.queryChunks;
      const key = chunks.find((c) => typeof c === "string" && c.startsWith("v1:")) as string;
      const eventType = chunks[chunks.indexOf(key) + 2] as string;
      h.getDb.mockResolvedValue(fakeDb());
      return { key, eventType };
    };
    const cases = [
      [leads, "leads", "lead_captured"],
      [bookings, "bookings", "booking_created"],
      [callbackRequests, "callbacks", "callback_requested"],
      [emergencyRequests, "emergencies", "emergency_request"],
    ] as const;
    for (const [table, name, type] of cases) {
      const outboxRow = await written(type, 41);
      expect(outboxRow.key, name).toBeTruthy();
      const r = await family(table, name, [row(41, "2026-10-01")], [outboxRow]);
      expect(r, name).toMatchObject({ matched: 1, missing: 0, extra: 0 });
    }
  });
});

describe("bridgeOutboxCompleteness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.rows.clear();
    h.isEnabled.mockResolvedValue(true);
    h.getDb.mockResolvedValue(fakeDb());
  });

  it("measures each family over the window", async () => {
    h.rows.set(bridgeOutbox, [
      { key: "v1:lead.created:lead:1", eventType: "lead.created" },
      { key: "v1:lead.callback_requested:callback:5", eventType: "lead.callback_requested" },
    ]);
    h.rows.set(leads, [
      row(1, "2026-10-03", "popup"),
      row(2, "2026-10-03", "sms"),
      row(3, "2026-09-28", "popup", 0), // the context day before the window: not counted
    ]);
    h.rows.set(callbackRequests, [row(5, "2026-10-04", "/tires")]);
    h.rows.set(bookings, [row(8, "2026-10-05")]);
    h.rows.set(emergencyRequests, []);

    const r = await bridgeOutboxCompleteness();
    expect(r.state).toBe("measured");
    if (r.state !== "measured") return;
    expect(r.windowDays).toBe(7);
    expect(r.totals).toEqual({ source: 4, matched: 2, missing: 2, extra: 0 });
    const by = Object.fromEntries(r.families.map((f) => [f.family, f]));
    expect(by.leads).toMatchObject({ source: 2, matched: 1, missing: 1 });
    expect(by.leads.days[0].missingBySource).toEqual({ sms: 1 });
    expect(by.bookings).toMatchObject({ source: 1, missing: 1 });
    expect(by.callbacks).toMatchObject({ source: 1, matched: 1 });
  });

  it("says not_measuring, never '100% missing', while the flag is OFF and nothing was recorded", async () => {
    h.isEnabled.mockResolvedValue(false);
    h.rows.set(leads, [row(1, "2026-10-03", "popup")]);
    const r = await bridgeOutboxCompleteness();
    expect(r.state).toBe("not_measuring");
  });

  it("says table_missing before migration 0137 is applied", async () => {
    h.rows.set(bridgeOutbox, Object.assign(new Error("Table 'nick.bridge_outbox' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }));
    await expect(bridgeOutboxCompleteness()).resolves.toEqual({ state: "table_missing" });
  });

  it("reports a failed read as an error state, not as zero rows", async () => {
    h.rows.set(bookings, Object.assign(new Error("Lock wait timeout"), { errno: 1205 }));
    await expect(bridgeOutboxCompleteness()).resolves.toEqual({ state: "error", family: "bookings" });
    h.rows.clear();
    h.rows.set(bridgeOutbox, Object.assign(new Error("Lock wait timeout"), { errno: 1205 }));
    await expect(bridgeOutboxCompleteness()).resolves.toEqual({ state: "error", family: "bridge_outbox" });
  });

  it("buckets by the shop's day and bounds the window in SQL, never on driver-parsed JS dates", async () => {
    await bridgeOutboxCompleteness({ windowDays: 7 });
    const text = (q: unknown) =>
      (q as { queryChunks: unknown[] }).queryChunks
        .map((c) => (c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value) ? (c as { value: string[] }).value.join("") : typeof c === "number" ? String(c) : "?"))
        .join("");
    for (const table of [leads, bookings, callbackRequests, emergencyRequests]) {
      const fields = h.selects.get(table)!;
      expect(text(fields.day)).toMatch(/DATE_FORMAT\(CONVERT_TZ\(\?, '\+00:00', 'America\/New_York'\), '%Y-%m-%d'\)/);
      expect(text(fields.inWindow)).toMatch(/\? >= NOW\(\) - INTERVAL 7 DAY/);
    }
  });

  it("returns no_db without a connection", async () => {
    h.getDb.mockResolvedValue(null);
    await expect(bridgeOutboxCompleteness()).resolves.toEqual({ state: "no_db" });
  });
});
