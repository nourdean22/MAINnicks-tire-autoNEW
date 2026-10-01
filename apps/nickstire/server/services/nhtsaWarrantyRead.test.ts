/**
 * Q-50 phase 2b · ADR-0021 §7-§8 acceptance for the warranty-extension read path.
 *
 *   - empty vs error (§7.3): never ingested, 0138 missing and a failed read are `ok: false`;
 *     only a fresh, readable ingest says "none listed"; older than 3 days is flagged stale
 *   - freshness is the ingest's own `lastSuccessAt`, not cron_log (phase 2a review)
 *   - §8 matching: Chevy/Silverado/2015 reads CHEVROLET, both stored Mercedes spellings are
 *     read, an exact model beats a related one, a related match names NHTSA's model, year 9999
 *     is kept and labelled
 *   - §5 current rows: each chunk's latest pass time reaches the SQL as a parameter
 *   - the production SQL is SELECT-only
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  warrantyExtensionsByVehicle,
  type WarrantyReadQuery,
  type WarrantyReadStore,
  type WarrantyRow,
} from "./nhtsaWarrantyRead";
import type { IngestState } from "./nhtsaWarrantyIngest";

const db = vi.hoisted(() => ({ executed: [] as unknown[], stateValue: null as string | null, rows: [] as unknown[] }));
vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      db.executed.push(q);
      const text = JSON.stringify(q);
      if (text.includes("SELECT value FROM shop_settings")) return [db.stateValue == null ? [] : [{ value: db.stateValue }], []];
      return [db.rows, []];
    },
  }),
}));

const NOW = new Date("2026-10-08T14:00:00Z");
/** ADR-0021 §7.3: older than 3 days is stale. */
const STALE_AFTER_MS = 3 * 24 * 3_600_000;
const FRESH: IngestState = {
  chunks: {
    "2015-2019": { crc32: 1, size: 1, parsedAt: "2026-10-04T13:40:00.000Z" },
    "2025-2026": { crc32: 2, size: 2, parsedAt: "2026-10-08T13:40:00.000Z" },
  },
  lastSuccessAt: "2026-10-08T13:52:00.000Z",
};

function rowOf(p: Partial<WarrantyRow> & { nhtsaId: number }): WarrantyRow {
  return {
    documentId: `DOC-${p.nhtsaId}`,
    mfrCampaignId: null,
    communicationType: "Warranty Program/Extension",
    matchSignal: "nhtsa_type",
    matchedPhrase: null,
    mfrDate: "2025-01-02",
    components: "ENGINE",
    summary: "Engine inspection program.",
    modelNorm: "SILVERADO",
    modelRaw: "SILVERADO",
    modelYear: 2015,
    ...p,
  };
}

function memStore(state: IngestState | Error, rows: WarrantyRow[] | Error = []) {
  const queries: WarrantyReadQuery[] = [];
  const store: WarrantyReadStore = {
    async readState() {
      if (state instanceof Error) throw state;
      return state;
    },
    async readRows(q) {
      queries.push(q);
      if (rows instanceof Error) throw rows;
      return rows;
    },
  };
  return { store, queries };
}

const silverado = { year: "2015", make: "Chevy", model: "Silverado" };

/** The public read over a fresh ingest returning `rows`, as the panel sees it. */
async function groupMatches(rows: WarrantyRow[], model: string, year: number) {
  const { store } = memStore(FRESH, rows);
  const r = await warrantyExtensionsByVehicle({ year: String(year), make: "Chevrolet", model }, { store, now: () => NOW });
  if (!r.ok) throw new Error(r.error);
  return r.matches;
}

describe("empty vs error (§7.3)", () => {
  it("an ingest that never finished is unavailable, not 'none listed'", async () => {
    const { store, queries } = memStore({ chunks: {} });
    const r = await warrantyExtensionsByVehicle(silverado, { store, now: () => NOW });
    expect(r).toMatchObject({ ok: false, reason: "never_ingested" });
    expect(queries).toHaveLength(0);
  });

  it("migration 0138 missing (MySQL 1146) is unavailable and names the migration", async () => {
    const missing = Object.assign(new Error("Table 'nick.nhtsa_mfr_warranty_products' doesn't exist"), { errno: 1146, code: "ER_NO_SUCH_TABLE" });
    const { store } = memStore(FRESH, missing);
    const r = await warrantyExtensionsByVehicle(silverado, { store, now: () => NOW });
    expect(r).toMatchObject({ ok: false, reason: "not_installed", error: expect.stringMatching(/0138_nhtsa_mfr_warranty/) });
  });

  it("a failed read is unavailable with its reason, never 0 matches", async () => {
    const { store } = memStore(new Error("connection reset"));
    const r = await warrantyExtensionsByVehicle(silverado, { store, now: () => NOW });
    expect(r).toMatchObject({ ok: false, reason: "read_failed", error: "connection reset" });
  });

  it("a fresh ingest with no rows is a real 'none listed', with its update time", async () => {
    const { store } = memStore(FRESH, []);
    const r = await warrantyExtensionsByVehicle(silverado, { store, now: () => NOW });
    expect(r).toMatchObject({ ok: true, matchCount: 0, matches: [], freshness: { lastSuccessAt: FRESH.lastSuccessAt, stale: false } });
  });

  it("flags the list stale once the last success is older than 3 days, and still shows it (kill switch, §11)", async () => {
    const lastSuccessAt = new Date(NOW.getTime() - STALE_AFTER_MS - 60_000).toISOString();
    const { store } = memStore({ ...FRESH, lastSuccessAt }, [rowOf({ nhtsaId: 1 })]);
    const r = await warrantyExtensionsByVehicle(silverado, { store, now: () => NOW });
    expect(r).toMatchObject({ ok: true, matchCount: 1, freshness: { stale: true } });
    const justInside = new Date(NOW.getTime() - STALE_AFTER_MS + 60_000).toISOString();
    const r2 = await warrantyExtensionsByVehicle(silverado, { store: memStore({ ...FRESH, lastSuccessAt: justInside }).store, now: () => NOW });
    expect(r2).toMatchObject({ ok: true, freshness: { stale: false } });
  });

  it("rejects an input it cannot look up without touching the database", async () => {
    const { store, queries } = memStore(FRESH);
    expect(await warrantyExtensionsByVehicle({ year: "15", make: "Chevy", model: "Silverado" }, { store })).toMatchObject({ ok: false, reason: "invalid_input" });
    expect(queries).toHaveLength(0);
  });
});

describe("§8 matching", () => {
  it("Chevy / Silverado / 2015 reads CHEVROLET, the normalized model and every current chunk pass", async () => {
    const { store, queries } = memStore(FRESH, []);
    const r = await warrantyExtensionsByVehicle(silverado, { store, now: () => NOW });
    expect(r).toMatchObject({ ok: true, make: "CHEVROLET", model: "Silverado", aliased: true });
    expect(queries[0]).toMatchObject({ makeSpellings: ["CHEVROLET"], year: 2015, modelNorm: "SILVERADO" });
    expect(queries[0].currentPasses).toEqual([
      { chunk: "2015-2019", since: new Date("2026-10-04T13:40:00.000Z") },
      { chunk: "2025-2026", since: new Date("2026-10-08T13:40:00.000Z") },
    ]);
  });

  it("reads both stored Mercedes spellings (the ingest keeps MERCEDES BENZ's space)", async () => {
    const { store, queries } = memStore(FRESH, []);
    await warrantyExtensionsByVehicle({ year: "2019", make: "Mercedes", model: "C300" }, { store, now: () => NOW });
    expect([...queries[0].makeSpellings].sort()).toEqual(["MERCEDES BENZ", "MERCEDESBENZ"]);
  });

  it("an exact model ranks first; a related one names NHTSA's model; a 9999 row is labelled", async () => {
    const matches = await groupMatches(
      [
        rowOf({ nhtsaId: 10, modelNorm: "SILVERADO 1500", modelRaw: "SILVERADO 1500", mfrDate: "2025-06-01" }),
        rowOf({ nhtsaId: 10, modelNorm: "SILVERADO 2500", modelRaw: "SILVERADO 2500", mfrDate: "2025-06-01" }),
        rowOf({ nhtsaId: 20, mfrDate: "2019-01-01" }),
        rowOf({ nhtsaId: 30, modelYear: 9999, mfrDate: "2024-01-01", matchSignal: "summary_text" }),
        rowOf({ nhtsaId: 40, modelNorm: "SILVERADOS", modelRaw: "SILVERADOS" }), // not a whole word: dropped
        rowOf({ nhtsaId: 50, modelYear: 2016 }), // another year: dropped
      ],
      "SILVERADO",
      2015,
    );
    expect(matches.map((m) => m.nhtsaId)).toEqual([20, 30, 10]);
    expect(matches[0]).toMatchObject({ match: "exact", yearStated: true, nhtsaModels: [] });
    expect(matches[1]).toMatchObject({ match: "exact", yearStated: false, signal: "summary_text" });
    expect(matches[2]).toMatchObject({ match: "related", nhtsaModels: ["SILVERADO 1500", "SILVERADO 2500"] });
  });

  it("one communication listed under both the exact and a related model counts once, as exact", async () => {
    const matches = await groupMatches(
      [rowOf({ nhtsaId: 7, modelNorm: "SILVERADO 1500", modelRaw: "SILVERADO 1500" }), rowOf({ nhtsaId: 7 })],
      "SILVERADO",
      2015,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ match: "exact", nhtsaModels: [] });
  });

  it("a car named more narrowly than NHTSA (SILVERADO 1500 vs SILVERADO) is a related match", async () => {
    const [m] = await groupMatches([rowOf({ nhtsaId: 8 })], "SILVERADO 1500", 2015);
    expect(m).toMatchObject({ match: "related", nhtsaModels: ["SILVERADO"] });
  });
});

describe("the production store (SELECT only)", () => {
  const dialect = new MySqlDialect();

  it("renders one state read and one indexed product read, with the pass times as parameters", async () => {
    db.executed.length = 0;
    db.stateValue = JSON.stringify(FRESH);
    db.rows = [{
      nhtsaId: "11013460", documentId: "11013460", mfrCampaignId: "N232400380", communicationType: "Service Campaign",
      matchSignal: "summary_text", matchedPhrase: "SPECIAL COVERAGE", mfrDate: "2024-03-01", components: "ENGINE",
      summary: "Special coverage adjustment - engine thermostat.", modelNorm: "SILVERADO 1500", modelRaw: "SILVERADO 1500", modelYear: 2015,
    }];
    const r = await warrantyExtensionsByVehicle(silverado, { now: () => NOW });
    expect(r).toMatchObject({ ok: true, matchCount: 1, matches: [{ nhtsaId: 11013460, match: "related", signal: "summary_text" }] });

    const queries = db.executed.map((q) => dialect.sqlToQuery(q as SQL));
    for (const q of queries) expect(q.sql.trim()).toMatch(/^SELECT /);
    for (const q of queries) expect(q.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|DROP)\b/i);
    const read = queries[1];
    expect(read.sql.replace(/\s+/g, " ")).toMatch(/WHERE p\.make_norm IN \(\?\) AND p\.model_year IN \(\?, \?\)/);
    expect(read.params).toEqual(expect.arrayContaining(["CHEVROLET", 2015, 9999, "SILVERADO", "SILVERADO %", "2015-2019", "2025-2026"]));
    expect(read.params).toContainEqual(new Date("2026-10-08T13:40:00.000Z"));
  });

  it("escapes LIKE wildcards in the model", async () => {
    db.executed.length = 0;
    db.stateValue = JSON.stringify(FRESH);
    db.rows = [];
    await warrantyExtensionsByVehicle({ year: "2015", make: "Ford", model: "F_150%" }, { now: () => NOW });
    const read = dialect.sqlToQuery(db.executed[1] as SQL);
    expect(read.params).toContain("F\\_150\\% %");
  });
});
