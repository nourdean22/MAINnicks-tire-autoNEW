/**
 * lotBriefRead -- the `lot_brief` bridge action's reads (camera audit N4), executed against a fake
 * database routed by SQL text, through the REAL rules module. Pins what the pure tests cannot see:
 * the shop-day windows reach SQL as the right epochs (DST included), the default day is yesterday in
 * New York, tickets are read only when the invoice mirror synced after the day closed, a missing
 * marks table is tolerated, a failed read is `ok: false` (never a quiet day), and the action is
 * registered in the bridge's handler map where StateNour's contract test looks for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: () => getDb() }));
const lastSync = vi.fn<() => Date | null>(() => null);
vi.mock("./shopDriverMirror", () => ({ getLastSuccessfulSync: () => lastSync() }));

import { addDays, readLotBrief, shopDate } from "./lotBriefRead";
import { QUERY_HANDLERS } from "../routes/nour-os-query";

/** Flatten a drizzle sql object to its text and params. */
function flat(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk(q.queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

const H = 3_600;
// Thursday 2026-10-15 (EDT): shop day 04:00Z..04:00Z, open 12:00Z..22:00Z.
const D_START = Date.UTC(2026, 9, 15, 4) / 1000;
const D_END = Date.UTC(2026, 9, 16, 4) / 1000;
const OPEN = Date.UTC(2026, 9, 15, 12) / 1000;
const CLOSE = Date.UTC(2026, 9, 15, 22) / 1000;
// The brief is read at 07:00 ET on Friday the 16th.
const NOW = Date.UTC(2026, 9, 16, 11);

interface Fixture {
  counts?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  anchor?: Array<Record<string, unknown>>;
  tickets?: number;
  dwell?: Array<Record<string, unknown>>;
  marks?: Array<Record<string, unknown>> | Error;
}

function fakeDb(f: Fixture) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const execute = vi.fn(async (q: { queryChunks: unknown[] }) => {
    const sqlText = flat(q);
    calls.push(sqlText);
    const t = sqlText.text;
    if (t.includes("FROM vehicle_visit_marks")) {
      if (f.marks instanceof Error) throw f.marks;
      return [f.marks ?? []];
    }
    if (t.includes("FROM vehicle_visits") && t.includes("GROUP BY etDate")) return [f.counts ?? []];
    if (t.includes("FROM vehicle_visits") && t.includes("LEAST(")) return [f.dwell ?? []];
    if (t.includes("FROM camera_health_events") && t.includes("LIMIT 1")) return [f.anchor ?? []];
    if (t.includes("FROM camera_health_events")) return [f.events ?? []];
    if (t.includes("FROM invoices")) return [[{ n: f.tickets ?? 0 }]];
    throw new Error(`unrouted query: ${t.slice(0, 80)}`);
  });
  return { db: { execute } as never, calls };
}

const fresh = (iso: string | null) => ({ dataAsOf: iso, ageMinutes: iso ? 5 : null, staleness: iso ? "recent" : "uncollected" });
const afterClose = new Date((CLOSE + 2 * H) * 1000).toISOString();

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("shop dates", () => {
  it("yesterday is computed in New York, and calendar steps never slip across DST", () => {
    expect(shopDate(NOW)).toBe("2026-10-16");
    expect(shopDate(Date.UTC(2026, 9, 16, 3, 30))).toBe("2026-10-15"); // 23:30 EDT is still the 15th
    expect(addDays("2026-11-02", -1)).toBe("2026-11-01");
    expect(addDays("2026-10-15", -28)).toBe("2026-09-17");
  });
});

describe("readLotBrief", () => {
  it("reads yesterday by default: five dates in one count, epochs from the shop day, the real rules on top", async () => {
    const { db, calls } = fakeDb({
      counts: [
        { etDate: "2026-10-15", arrivals: 14, passThroughs: 2 },
        { etDate: "2026-10-08", arrivals: 13, passThroughs: 1 },
      ],
      anchor: [{ fromState: "STALE", toState: "HEALTHY", reason: "resumed", atEpoch: D_START - 6 * H }],
      events: [
        { fromState: "HEALTHY", toState: "STALE", reason: "stopped", atEpoch: OPEN + 3 * H },
        { fromState: "STALE", toState: "HEALTHY", reason: "resumed", atEpoch: OPEN + 3 * H + 1800 },
      ],
      tickets: 11,
    });
    const r = await readLotBrief(db, {}, { freshness: fresh(afterClose), nowMs: NOW });
    if (!r.ok) throw new Error(r.error);
    expect(r.date).toBe("2026-10-15");
    expect(r.weekday).toBe("thursday");
    expect(r.arrivals).toBe(14);
    expect(r.coverage.pctExpected).toBeCloseTo(0.95, 6); // 30 STALE minutes of 600
    // Every earlier Thursday opened before the outage record was complete: no baseline, and it says so.
    expect(r.baseline).toMatchObject({ weeksConsidered: 4, weeksCompared: 0, meanArrivals: null });
    expect(r.lines).toEqual([
      "Thursday: 14 cars came in (camera watched 95% of business hours); no same-weekday comparison yet, 0 of the last 4 Thursdays were watched enough to compare.",
    ]);
    expect(r.tickets).toEqual({ count: 11, withheld: null });
    // The count spans 2026-09-17 04:00Z (four weeks back) to 2026-10-16 04:00Z, as epochs.
    const count = calls.find((c) => c.text.includes("GROUP BY etDate"))!;
    expect(count.text).toContain("DATE_FORMAT(CONVERT_TZ(arrivedAt, '+00:00', 'America/New_York'), '%Y-%m-%d') AS etDate");
    expect(count.text).toContain("COUNT(DISTINCT CASE WHEN state <> 'PASS_THROUGH' THEN COALESCE(episodeId, visitId) END) AS arrivals");
    expect(count.params).toEqual([Date.UTC(2026, 8, 17, 4) / 1000, D_END]);
    // Health rows are read only for the range the record covers (the target day here).
    const events = calls.find((c) => c.text.includes("FROM camera_health_events") && !c.text.includes("LIMIT 1"))!;
    expect(events.params).toEqual(["sign", D_START, D_END]);
    expect(r).toMatchObject({ dataAsOf: afterClose, staleness: "recent" });
  });

  it("tickets are withheld unless the invoice mirror synced after the day closed, and then never queried", async () => {
    // Each refusal pinned by its own reason: a mutation that dropped the first check survived a
    // shared /invoice mirror/ match, because `null < close` is true in JS and the second check
    // withheld it anyway (positive control, 2026-10-08).
    const cases: Array<[ReturnType<typeof fresh>, string]> = [
      [fresh(null), "the invoice mirror has not synced since the server started"],
      [fresh(new Date((CLOSE - H) * 1000).toISOString()), "the invoice mirror last synced before the day closed"],
    ];
    for (const [freshness, reason] of cases) {
      const { db, calls } = fakeDb({ counts: [{ etDate: "2026-10-15", arrivals: 20, passThroughs: 0 }], tickets: 1 });
      const r = await readLotBrief(db, {}, { freshness, nowMs: NOW });
      if (!r.ok) throw new Error(r.error);
      expect(r.tickets).toEqual({ count: null, withheld: reason });
      expect(calls.some((c) => c.text.includes("FROM invoices"))).toBe(false);
      expect(r.events.map((e) => e.kind)).not.toContain("few_tickets");
    }
  });

  it("long stays: read on a watched day, marks applied, a missing marks table tolerated", async () => {
    const dwell = [{
      visitId: "v-1", episodeKey: "v-1",
      arrivedEpoch: OPEN + H, departedEpoch: OPEN + H + 4 * H, bayEnteredEpoch: null, bayExitedEpoch: null,
    }];
    const watched = {
      counts: [{ etDate: "2026-10-15", arrivals: 9, passThroughs: 0 }],
      anchor: [{ fromState: null, toState: "HEALTHY", reason: null, atEpoch: D_START - H }],
      dwell,
    };
    const missing = Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    const a = await readLotBrief(fakeDb({ ...watched, marks: missing }).db, {}, { freshness: fresh(null), nowMs: NOW });
    if (!a.ok) throw new Error(a.error);
    expect(a.longDwells).toEqual({ count: 1, longestMinutes: 240, uncertain: 0 });
    expect(a.lines).toContain("1 car stayed 3h+ Thursday with no service recorded (longest 4h 0m).");

    const marked = await readLotBrief(fakeDb({
      ...watched,
      marks: [{ visitId: "v-1", mark: "SERVICE_STARTED", markedEpoch: OPEN + 2 * H, note: null }],
    }).db, {}, { freshness: fresh(null), nowMs: NOW });
    if (!marked.ok) throw new Error(marked.error);
    expect(marked.longDwells).toEqual({ count: 0, longestMinutes: null, uncertain: 0 });
  });

  it("an unwatched day is not judged for long stays at all (no dwell read)", async () => {
    const { db, calls } = fakeDb({
      counts: [{ etDate: "2026-10-15", arrivals: 9, passThroughs: 0 }],
      anchor: [{ fromState: null, toState: "PRODUCER_OFFLINE", reason: null, atEpoch: D_START - H }],
    });
    const r = await readLotBrief(db, {}, { freshness: fresh(null), nowMs: NOW });
    if (!r.ok) throw new Error(r.error);
    expect(r.coverage.pctExpected).toBe(0);
    expect(r.longDwells).toBeNull();
    expect(calls.some((c) => c.text.includes("LEAST("))).toBe(false);
    expect(r.events.map((e) => e.kind)).toEqual(["coverage_low"]);
  });

  it("the day DST ends is 25 hours long and the windows say so", async () => {
    const { db, calls } = fakeDb({});
    const r = await readLotBrief(db, { date: "2026-11-01" }, { freshness: fresh(null), nowMs: Date.UTC(2026, 10, 2, 13) });
    if (!r.ok) throw new Error(r.error);
    expect(r.weekday).toBe("sunday");
    const events = calls.find((c) => c.text.includes("FROM camera_health_events") && !c.text.includes("LIMIT 1"))!;
    // Every same weekday back to 2026-10-11 opened after the cutoff, so the range starts there.
    expect(events.params).toEqual(["sign", Date.UTC(2026, 9, 11, 4) / 1000, Date.UTC(2026, 10, 2, 5) / 1000]);
  });

  it("a failed read is ok:false with a safe description, never a quiet day", async () => {
    const execute = vi.fn().mockRejectedValue(Object.assign(new Error("Failed query: SELECT ... params: secret"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 }));
    const r = await readLotBrief({ execute } as never, {}, { freshness: fresh(null), nowMs: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.error).toContain("ER_LOCK_WAIT_TIMEOUT");
    expect(r.error).not.toContain("secret");
  });

  it("refuses a date that is today, in the future, malformed or too old", async () => {
    for (const date of ["2026-10-16", "2026-10-20", "10/15/2026", "2026-01-01", 20261015, "2026-09-31", "2026-10-00", null]) {
      const r = await readLotBrief(fakeDb({}).db, { date }, { freshness: fresh(null), nowMs: NOW });
      // By its own message: the read-failure catch also returns ok:false, and 2026-09-31 parses (V8
      // rolls it to October 1), so a bare ok:false would pass while a wrong day was read.
      expect(r).toEqual({ ok: false, error: "date must be YYYY-MM-DD, before today and within 120 days" });
    }
  });
});

describe("the lot_brief bridge action", () => {
  it("is registered where StateNour's contract test looks, and serves the brief through the route's handler", async () => {
    expect(typeof QUERY_HANDLERS.lot_brief).toBe("function");
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { db } = fakeDb({ counts: [{ etDate: "2026-10-15", arrivals: 3, passThroughs: 0 }] });
    getDb.mockResolvedValue(db);
    const r = (await QUERY_HANDLERS.lot_brief({})) as { ok: boolean; date: string; lines: string[]; staleness: string };
    expect(r.ok).toBe(true);
    expect(r.date).toBe("2026-10-15");
    expect(r.lines).toHaveLength(1);
    expect(r.staleness).toBe("uncollected");
  });

  it("no database is ok:false, not an empty brief", async () => {
    getDb.mockResolvedValue(null);
    expect(await QUERY_HANDLERS.lot_brief({})).toEqual({ ok: false, error: "No DB" });
  });
});
