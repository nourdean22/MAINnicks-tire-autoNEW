/**
 * gatewayTire.tireActivity (2026-10-25, Codex review of PR 3293).
 *
 * The Tires activity strip read customerEvents.summary, which (1) needs customers.manage, so the tech
 * role (admin.view + workorders.manage) got FORBIDDEN and a Retry that can never succeed, and (2) returns
 * only the top 20 event names, so a low-volume tire event read "Not tracked" though rows existed.
 *
 * This asks the customer_events table for the five tire event names BY NAME, so a name with no rows is a
 * real 0 and a rare name can never fall off a top-20 list. The test drives the REAL drizzle builder over a
 * fake mysql2 client that records the SQL it is sent and answers it the way the database would (IN list,
 * time window, LIMIT), so a name dropped from the IN list or a reintroduced LIMIT changes the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This file needs the REAL drizzle builder, schema and subject; another file's mock must not leak in (AGENTS.md section 3).
vi.unmock("drizzle-orm/mysql2");
vi.unmock("drizzle-orm");
vi.unmock("../../drizzle/schema");
vi.unmock("../lib/tireActivity");
vi.unmock("./gatewayTire");

import { drizzle } from "drizzle-orm/mysql2";

const NOW = new Date("2026-10-25T21:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const NAMES = ["tire_search_submitted", "tire_quote_cta_click", "vehicle_size_selected", "tire_option_selected", "top_pick_selected"];

const h = vi.hoisted(() => ({
  events: [] as { name: string; at: Date; n: number }[],
  sent: [] as { sql: string; values: unknown[] }[],
  dead: false,
  failQuery: false,
}));

/** Answers a grouped customer_events select the way the database would: IN list, window, LIMIT. */
const fakeClient = {
  query: async (q: { sql: string; values?: unknown[] } | string, params?: unknown[]) => {
    const text = typeof q === "string" ? q : q.sql;
    const values = (typeof q === "string" ? params : q.values ?? params) ?? [];
    h.sent.push({ sql: text, values });
    if (h.failQuery) throw Object.assign(new Error("Lock wait timeout exceeded"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    if (!/from `customer_events`/i.test(text)) return [[], []];
    const inList = /`eventName` in \(([^)]*)\)/i.exec(text);
    const nIn = inList ? (inList[1].match(/\?/g) ?? []).length : 0;
    const names = inList ? (values.slice(0, nIn) as string[]) : null;
    const rawSince = values[nIn] as Date | string;
    const since = rawSince instanceof Date ? rawSince : new Date(`${String(rawSince).replace(" ", "T")}Z`);
    const totals = new Map<string, number>();
    for (const e of h.events) {
      if (e.at < since) continue;
      if (names && !names.includes(e.name)) continue;
      totals.set(e.name, (totals.get(e.name) ?? 0) + e.n);
    }
    let rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    // drizzle binds the limit as the last parameter (`limit ?`); a literal is read too.
    const lim = /\blimit (\d+|\?)/i.exec(text);
    if (lim) rows = rows.slice(0, Number(lim[1] === "?" ? values[values.length - 1] : lim[1]));
    // mysql2 with rowsAsArray: positional values per row (eventName, COUNT(*)). One count as a string: bigint columns can arrive that way.
    return [rows.map(([name, n], i) => [name, i === 0 ? String(n) : n]), []];
  },
};
const realDrizzle = drizzle(fakeClient as never);

// dbAdminProcedure's guard reads getDbTyped; getDb stays null so the admin-role read takes its documented missing-row path.
vi.mock("../db", () => ({
  getDb: async () => null,
  getDbTyped: async () => (h.dead ? null : realDrizzle),
  getNextInvoiceNumber: async () => "INV-TEST",
  createInvoice: async () => ({}),
}));
vi.mock("../lib/db-helper", () => ({
  db: async () => realDrizzle,
  dbTyped: async () => (h.dead ? null : realDrizzle),
  requireDb: async () => {
    if (h.dead) throw new Error("Database unavailable");
    return realDrizzle;
  },
}));

import { gatewayTireRouter } from "./gatewayTire";

function ctx(role: "admin" | "user") {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: "tech@example.com", name: "Tech", loginMethod: "manus",
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const caller = (role: "admin" | "user" = "admin") => gatewayTireRouter.createCaller(ctx(role));

const ev = (name: string, n: number, daysAgo = 1) => ({ name, n, at: new Date(NOW.getTime() - daysAgo * DAY) });
const zeros = Object.fromEntries(NAMES.map((n) => [n, 0]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.events = [];
  h.sent.length = 0;
  h.dead = false;
  h.failQuery = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("gatewayTire.tireActivity", () => {
  it("counts the five tire events by name over the window and reports the window it used", async () => {
    h.events = [
      ev("tire_search_submitted", 12), ev("tire_search_submitted", 3, 5),
      ev("tire_quote_cta_click", 4), ev("vehicle_size_selected", 9),
      ev("tire_option_selected", 2), ev("top_pick_selected", 1),
    ];
    expect(await caller().tireActivity({ days: 30 })).toEqual({
      available: true,
      days: 30,
      // 21:00Z on 10-25 is 17:00 ET, shop day 2026-10-25: 30 shop days is that day plus the 29 before it.
      fromDayKey: "2026-09-26",
      from: "2026-09-26T04:00:00.000Z",
      to: "2026-10-25T21:00:00.000Z",
      counts: {
        tire_search_submitted: 15, tire_quote_cta_click: 4, vehicle_size_selected: 9, tire_option_selected: 2, top_pick_selected: 1,
      },
    });
  });

  it("a name with no rows is 0 and still present, never missing", async () => {
    h.events = [ev("tire_search_submitted", 7)];
    const out = await caller().tireActivity({ days: 30 });
    expect(out).toMatchObject({ available: true, counts: { ...zeros, tire_search_submitted: 7 } });
    expect(Object.keys((out as { counts: object }).counts).sort()).toEqual([...NAMES].sort());
  });

  it("an empty table is five real zeros", async () => {
    expect(await caller().tireActivity({ days: 30 })).toMatchObject({ available: true, counts: zeros });
  });

  it("honours the window: a row at the ET midnight that opens it counts, one second earlier does not", async () => {
    // days=7 at 17:00 ET on 2026-10-25 opens at ET midnight of 2026-10-19 (EDT, 04:00Z).
    h.events = [
      { name: "tire_search_submitted", n: 5, at: new Date("2026-10-19T04:00:00.000Z") },
      { name: "tire_search_submitted", n: 100, at: new Date("2026-10-19T03:59:59.000Z") },
    ];
    const out = await caller().tireActivity({ days: 7 });
    expect(out).toMatchObject({ days: 7, fromDayKey: "2026-10-19", from: "2026-10-19T04:00:00.000Z", counts: { tire_search_submitted: 5 } });
  });

  describe("the window is whole shop days in America/New_York (AGENTS.md, Time), filtered in SQL text", () => {
    const sentSince = () => h.sent.filter((s) => /from `customer_events`/i.test(s.sql))[0].values[5];

    it("days=30 before the DST end opens at the ET midnight of 2026-10-02 and the SQL carries that boundary", async () => {
      vi.setSystemTime(new Date("2026-11-01T03:30:00.000Z")); // 2026-10-31 23:30 ET, still EDT
      const out = await caller().tireActivity({ days: 30 });
      expect(out).toMatchObject({ fromDayKey: "2026-10-02", from: "2026-10-02T04:00:00.000Z", to: "2026-11-01T03:30:00.000Z" });
      expect(sentSince()).toBe("2026-10-02 04:00:00");
    });

    it("days=1 after the DST end opens at 05:00Z (EST), not 04:00Z", async () => {
      vi.setSystemTime(new Date("2026-11-02T05:30:00.000Z")); // 2026-11-02 00:30 EST
      const out = await caller().tireActivity({ days: 1 });
      expect(out).toMatchObject({ fromDayKey: "2026-11-02", from: "2026-11-02T05:00:00.000Z" });
      expect(sentSince()).toBe("2026-11-02 05:00:00");
    });

    it("days=1 is today only, whatever the hour", async () => {
      vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
      const out = await caller().tireActivity({ days: 1 });
      expect(out).toMatchObject({ fromDayKey: "2026-10-26", from: "2026-10-26T04:00:00.000Z" });
      expect(sentSince()).toBe("2026-10-26 04:00:00");
    });

    it("between 20:00 ET and midnight the UTC date is already tomorrow; the shop day is still today", async () => {
      vi.setSystemTime(new Date("2026-10-26T01:30:00.000Z")); // 2026-10-25 21:30 ET
      expect(await caller().tireActivity({ days: 1 })).toMatchObject({ fromDayKey: "2026-10-25", from: "2026-10-25T04:00:00.000Z" });
    });
  });

  it("days defaults to 30 when the input is omitted or empty", async () => {
    expect(await caller().tireActivity()).toMatchObject({ available: true, days: 30 });
    expect(await caller().tireActivity({})).toMatchObject({ available: true, days: 30 });
  });

  it("days bounds: 1 and 180 pass; 0, 181 and 1.5 are BAD_REQUEST", async () => {
    await expect(caller().tireActivity({ days: 1 })).resolves.toMatchObject({ days: 1 });
    await expect(caller().tireActivity({ days: 180 })).resolves.toMatchObject({ days: 180 });
    for (const days of [0, 181, 1.5]) {
      await expect(caller().tireActivity({ days })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("asks for every name in one IN list and puts no LIMIT on it (the summary's top-20 cap is why it read Not tracked)", async () => {
    await caller().tireActivity({ days: 30 });
    const q = h.sent.filter((s) => /from `customer_events`/i.test(s.sql));
    expect(q).toHaveLength(1);
    expect(q[0].sql).toMatch(/`eventName` in \(\?, \?, \?, \?, \?\)/i);
    expect(q[0].values.slice(0, 5).sort()).toEqual([...NAMES].sort());
    expect(q[0].sql).not.toMatch(/\blimit\b/i);
  });

  it("a rare tire event is counted even when 20 busier event names outrank it (the 21st event)", async () => {
    h.events = [
      ...Array.from({ length: 20 }, (_, i) => ev(`page_view_${i}`, 1000 + i)),
      ev("top_pick_selected", 1),
      ev("tire_option_selected", 2),
    ];
    expect(await caller().tireActivity({ days: 30 })).toMatchObject({
      available: true,
      counts: { ...zeros, top_pick_selected: 1, tire_option_selected: 2 },
    });
  });

  it("a read that throws is available:false with the reason, never five zeros", async () => {
    h.failQuery = true;
    const out = await caller().tireActivity({ days: 30 });
    expect(out).toMatchObject({ available: false, reason: "error" });
    // The house describer names the driver error and leaves the SQL and its bound values out.
    expect((out as { message: string }).message).toMatch(/ER_LOCK_WAIT_TIMEOUT|1205/);
    expect((out as { message: string }).message).not.toMatch(/select|customer_events/i);
  });

  it("is admin only", async () => {
    await expect(caller("user").tireActivity({ days: 30 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a dead database handle is SERVICE_UNAVAILABLE at the router, never a result (dbAdminProcedure, ROS-083)", async () => {
    h.dead = true;
    await expect(caller().tireActivity({ days: 30 })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(h.sent).toHaveLength(0);
  });
});
