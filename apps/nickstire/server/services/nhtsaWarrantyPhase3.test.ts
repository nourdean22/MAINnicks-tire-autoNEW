/**
 * Q-50 phase 3 · the two server pieces named by the 2a/2b reviews and ADR-0021 §7.3's follow-up:
 *
 *   - `warrantyIngestFreshness`: the Data freshness row's reader. "Never finished a run",
 *     "fresh", "stale" (the drawer's own 3-day rule) and a failed read are four different
 *     answers; a failed read is never "never ran", and the flag is read from its row, so a
 *     flag-table failure is "unknown", not "off".
 *   - `previousYearCandidate`: early in a new year NHTSA can still serve last year's open-chunk
 *     name ("2025-2026" in January 2027). The probe tries it last, so the run does not fail
 *     "current chunk not found" for weeks; 2026's probe order and failure message are unchanged.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { warrantyIngestFreshness, type WarrantyFreshnessStore } from "./nhtsaWarrantyRead";
import { resolveOpenChunk, type FetchLike, type IngestState } from "./nhtsaWarrantyIngest";
import { previousYearCandidate } from "./nhtsaWarrantyParse";

const db = vi.hoisted(() => ({
  executed: [] as unknown[],
  stateValue: null as string | null,
  flagRows: [] as unknown[],
  failFlags: false,
}));
vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      db.executed.push(q);
      const text = JSON.stringify(q);
      if (text.includes("FROM shop_settings")) return [db.stateValue == null ? [] : [{ value: db.stateValue }], []];
      if (text.includes("FROM feature_flags")) {
        if (db.failFlags) throw new Error("Table 'feature_flags' is unreadable");
        return [db.flagRows, []];
      }
      throw new Error(`unexpected query ${text}`);
    },
  }),
}));

const NOW = new Date("2026-10-08T14:00:00Z");
const STALE_AFTER_MS = 3 * 24 * 3_600_000;
const state = (lastSuccessAt?: string): IngestState => ({
  chunks: { "2025-2026": { crc32: 1, size: 2, parsedAt: "2026-10-08T13:40:00.000Z" } },
  ...(lastSuccessAt ? { lastSuccessAt } : {}),
});
const store = (s: IngestState, armed: boolean | Error = true): WarrantyFreshnessStore => ({
  readState: async () => s,
  readArmed: async () => {
    if (armed instanceof Error) throw armed;
    return armed;
  },
});
const run = (s: WarrantyFreshnessStore | null) => warrantyIngestFreshness({ store: s, now: () => NOW });

describe("warrantyIngestFreshness", () => {
  it("an ingest that never finished a run says so, and carries the flag", async () => {
    expect(await run(store({ chunks: {} }, true))).toEqual({ ok: true, lastSuccessAt: null, stale: false, armed: true });
    expect(await run(store({ chunks: {} }, false))).toEqual({ ok: true, lastSuccessAt: null, stale: false, armed: false });
  });

  it("uses the drawer's 3-day rule: just inside is fresh, just past is stale", async () => {
    const inside = new Date(NOW.getTime() - STALE_AFTER_MS + 60_000).toISOString();
    const past = new Date(NOW.getTime() - STALE_AFTER_MS - 60_000).toISOString();
    expect(await run(store(state(inside)))).toEqual({ ok: true, lastSuccessAt: inside, stale: false, armed: true });
    expect(await run(store(state(past), false))).toEqual({ ok: true, lastSuccessAt: past, stale: true, armed: false });
  });

  it("a failed state read, a failed flag read or no database is ok:false, never 'never ran'", async () => {
    const failing: WarrantyFreshnessStore = { readState: async () => { throw new Error("timeout"); }, readArmed: async () => true };
    expect(await run(failing)).toEqual({ ok: false, error: "timeout" });
    expect(await run(store(state(NOW.toISOString()), new Error("flags down")))).toEqual({ ok: false, error: "flags down" });
    expect(await run(null)).toEqual({ ok: false, error: "database unavailable" });
  });

  it("the production store reads the state row and the flag row with SELECTs only", async () => {
    db.executed.length = 0;
    db.stateValue = JSON.stringify(state("2026-10-08T13:52:00.000Z"));
    db.flagRows = [{ value: 1 }];
    db.failFlags = false;
    expect(await warrantyIngestFreshness({ now: () => NOW })).toEqual({ ok: true, lastSuccessAt: "2026-10-08T13:52:00.000Z", stale: false, armed: true });

    const dialect = new MySqlDialect();
    const rendered = db.executed.map((q) => dialect.sqlToQuery(q as SQL));
    expect(rendered).toHaveLength(2);
    for (const r of rendered) expect(r.sql.trim()).toMatch(/^SELECT /);
    const flag = rendered.find((r) => r.sql.includes("feature_flags"));
    expect(flag?.params).toEqual(["nhtsa_warranty_ingest"]);

    db.flagRows = [];
    expect(await warrantyIngestFreshness({ now: () => NOW })).toMatchObject({ ok: true, armed: false });
  });

  it("a flag table that cannot be read is ok:false, not 'off' (featureFlags.isEnabled would say off)", async () => {
    db.stateValue = JSON.stringify(state("2026-10-08T13:52:00.000Z"));
    db.failFlags = true;
    expect(await warrantyIngestFreshness({ now: () => NOW })).toMatchObject({ ok: false });
    db.failFlags = false;
  });
});

/* ── previous-year chunk name ─────────────────────────────────── */

function headOnly(present: string[]): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const range = /TSBS_RECEIVED_(.+)\.zip$/.exec(url)?.[1] ?? "";
    calls.push(`${init?.method ?? "GET"} ${range}`);
    return new Response(null, { status: present.includes(range) ? 200 : 404 });
  };
  return { fetchImpl, calls };
}

describe("previousYearCandidate", () => {
  it("names last year's open range only when it differs from chunkPlan's candidates and is a real span", () => {
    expect(previousYearCandidate(2026)).toBeNull(); // "2025-2025": last year is the range's first
    expect(previousYearCandidate(2027)).toBe("2025-2026");
    expect(previousYearCandidate(2028)).toBe("2025-2027");
    expect(previousYearCandidate(2029)).toBe("2025-2028");
    expect(previousYearCandidate(2030)).toBeNull(); // last year belongs to the closed 2025-2029
    expect(previousYearCandidate(2032)).toBe("2030-2031");
  });

  it("in January 2027 the run finds 2025-2026 after the two usual names miss", async () => {
    const net = headOnly(["2025-2026"]);
    expect(await resolveOpenChunk(net.fetchImpl, new Date("2027-01-12T15:00:00Z"))).toBe("2025-2026");
    expect(net.calls).toEqual(["HEAD 2025-2027", "HEAD 2025-2029", "HEAD 2025-2026"]);
  });

  it("this year's name still wins, with no extra probe", async () => {
    const net = headOnly(["2025-2027", "2025-2026"]);
    expect(await resolveOpenChunk(net.fetchImpl, new Date("2027-03-02T15:00:00Z"))).toBe("2025-2027");
    expect(net.calls).toEqual(["HEAD 2025-2027"]);
  });

  it("still fails loudly when no name answers, listing every name tried", async () => {
    const net = headOnly([]);
    await expect(resolveOpenChunk(net.fetchImpl, new Date("2027-01-12T15:00:00Z"))).rejects.toThrow(
      "current chunk not found (tried 2025-2027, 2025-2029, 2025-2026)",
    );
  });

  it("the year is Cleveland's: 2027-01-01 03:00Z is still 2026 in ET, so no fallback probe", async () => {
    const net = headOnly([]);
    await expect(resolveOpenChunk(net.fetchImpl, new Date("2027-01-01T03:00:00Z"))).rejects.toThrow(
      "current chunk not found (tried 2025-2026, 2025-2029)",
    );
  });
});
