/**
 * NHTSA manufacturer warranty extensions · the read path (ADR-0021 §7, §8; Q-50 phase 2b).
 *
 * Reads the rows the phase-2a ingest (nhtsaWarrantyIngest.ts) stored, for one
 * year/make/model, for the work-order drawer's NHTSA panel. Information for
 * the advisor only: "may apply", never a coverage claim, and nothing here
 * reaches a customer, an AI estimate or a text.
 *
 * EMPTY VS ERROR (§7.3). Only a fresh, readable ingest can say "none listed".
 * A missing table (0138 not applied), a failed read, or an ingest that has
 * never finished returns `{ ok: false }`, which the panel shows as
 * "unavailable — NOT the same as none on file".
 *
 * FRESHNESS comes from the ingest's own state row (`lastSuccessAt` in
 * shop_settings `nhtsa_warranty_chunk_state`), not cron_log: a flag-off or
 * missing-migration skip is also logged there as `completed` (phase 2a review).
 * The flag itself is not read here: turning it off is the kill switch, and the
 * panel then keeps the last ingest with a staleness note after 3 days (§11).
 *
 * CURRENT ROWS ONLY (§5). A communication NHTSA dropped keeps its row, but its
 * last_seen_at stops moving; a row counts only when its chunk's latest parsed
 * pass saw it. The pass times are passed to SQL as parameters, so they are
 * compared in the database the way they were written (never a JS parse of a
 * driver-shifted TIMESTAMP).
 */
import { createLogger } from "../lib/logger";
import { isMissingTableError } from "../lib/dbErrors";
import { STATE_KEY, parseState, type IngestState } from "./nhtsaWarrantyIngest";
import { normalizeVehicleName, type Signal } from "./nhtsaWarrantyParse";
import { storedMakeSpellings, toNhtsaVehicleName } from "./nhtsaVehicleNames";

const log = createLogger("nhtsa-warranty-read");

const SOURCE_LABEL = "NHTSA manufacturer communications (public federal data)";
/** §7.3: a last successful ingest older than this shows "may be out of date". */
const STALE_AFTER_MS = 3 * 24 * 3_600_000;
/** Matches returned to the panel; `matchCount` is the full total. */
const MAX_MATCHES = 25;
/** Product rows read per lookup. One make + year is a few hundred rows; hitting this is reported, never hidden. */
const MAX_ROWS = 1_000;
/** Summaries are up to 4,000 characters; the panel collapses them after two lines. */
const SUMMARY_CHARS = 2_000;
/** model_year when the manufacturer did not state one. */
const YEAR_NOT_STATED = 9999;

/** The ingest's feature flag (featureFlags.ts FLAG_DEFINITIONS). */
const INGEST_FLAG = "nhtsa_warranty_ingest";

const WARRANTY_DISCLAIMER =
  "Eligibility depends on VIN, mileage, in-service date and sometimes state. Confirm with a dealer before quoting this repair.";

/** One stored product row joined to its communication. */
export interface WarrantyRow {
  nhtsaId: number;
  documentId: string;
  mfrCampaignId: string | null;
  communicationType: string;
  matchSignal: string;
  matchedPhrase: string | null;
  mfrDate: string | null;
  components: string | null;
  summary: string;
  modelNorm: string;
  modelRaw: string;
  modelYear: number;
}

export interface WarrantyReadQuery {
  /** Stored make_norm spellings (storedMakeSpellings). */
  makeSpellings: string[];
  year: number;
  /** §8 step 1 normalized model. */
  modelNorm: string;
  /** Each parsed chunk and the start of its latest pass: rows older than that were dropped by NHTSA. */
  currentPasses: Array<{ chunk: string; since: Date }>;
  limit: number;
}

export interface WarrantyReadStore {
  readState(): Promise<IngestState>;
  readRows(q: WarrantyReadQuery): Promise<WarrantyRow[]>;
}

export interface WarrantyMatch {
  nhtsaId: number;
  documentId: string;
  mfrCampaignId: string | null;
  communicationType: string;
  signal: Signal;
  matchedPhrase: string | null;
  mfrDate: string | null;
  components: string | null;
  summary: string;
  /** exact = NHTSA's model name equals the car's; related = one is a whole-word prefix of the other (SILVERADO / SILVERADO 1500). */
  match: "exact" | "related";
  /** NHTSA's own model name(s) for a related match, e.g. ["SILVERADO 1500"]. */
  nhtsaModels: string[];
  /** false = listed only under "model year not stated by the manufacturer". */
  yearStated: boolean;
}

export interface WarrantyExtensionsResult {
  ok: true;
  source: string;
  year: string;
  /** Make/model as NHTSA spells them (§8 aliases applied). */
  make: string;
  model: string;
  aliased: boolean;
  freshness: { lastSuccessAt: string; stale: boolean };
  matchCount: number;
  matches: WarrantyMatch[];
  /** The row cap was hit: the list may be incomplete. */
  truncated: boolean;
  disclaimer: string;
}

export interface WarrantyExtensionsError {
  ok: false;
  source: string;
  reason: "invalid_input" | "not_installed" | "never_ingested" | "read_failed";
  error: string;
}

const SIGNALS: ReadonlySet<string> = new Set(["nhtsa_type", "summary_text", "both"]);

function modelMatch(carModel: string, nhtsaModel: string): "exact" | "related" | null {
  if (carModel === nhtsaModel) return "exact";
  if (nhtsaModel.startsWith(carModel + " ") || carModel.startsWith(nhtsaModel + " ")) return "related";
  return null;
}

/** Rows -> one match per communication, best model match first, newest manufacturer date first. */
function groupMatches(rows: WarrantyRow[], carModel: string, year: number): WarrantyMatch[] {
  const byId = new Map<number, WarrantyMatch>();
  for (const r of rows) {
    const m = modelMatch(carModel, r.modelNorm);
    if (!m || (r.modelYear !== year && r.modelYear !== YEAR_NOT_STATED)) continue;
    const signal = (SIGNALS.has(r.matchSignal) ? r.matchSignal : "summary_text") as Signal;
    let hit = byId.get(r.nhtsaId);
    if (!hit) {
      hit = {
        nhtsaId: r.nhtsaId,
        documentId: r.documentId,
        mfrCampaignId: r.mfrCampaignId,
        communicationType: r.communicationType,
        signal,
        matchedPhrase: r.matchedPhrase,
        mfrDate: r.mfrDate,
        components: r.components,
        summary: r.summary.length > SUMMARY_CHARS ? r.summary.slice(0, SUMMARY_CHARS) + "…" : r.summary,
        match: m,
        nhtsaModels: [],
        yearStated: false,
      };
      byId.set(r.nhtsaId, hit);
    }
    if (m === "exact") hit.match = "exact";
    if (r.modelYear === year) hit.yearStated = true;
    if (m === "related" && !hit.nhtsaModels.includes(r.modelRaw)) hit.nhtsaModels.push(r.modelRaw);
  }
  for (const hit of byId.values()) if (hit.match === "exact") hit.nhtsaModels = [];
  return [...byId.values()].sort(
    (a, b) =>
      Number(b.match === "exact") - Number(a.match === "exact") ||
      Number(b.yearStated) - Number(a.yearStated) ||
      (b.mfrDate ?? "").localeCompare(a.mfrDate ?? "") ||
      b.nhtsaId - a.nhtsaId,
  );
}

/** The production store: SELECTs only, on the shop's TiDB. */
async function dbReadStore(): Promise<WarrantyReadStore | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  return {
    async readState() {
      const [rows] = await db.execute(sql`SELECT value FROM shop_settings WHERE \`key\` = ${STATE_KEY} LIMIT 1`);
      return parseState((rows as unknown as Array<{ value?: string }>)?.[0]?.value);
    },
    async readRows(q) {
      const like = q.modelNorm.replace(/[\\%_]/g, (c) => "\\" + c) + " %";
      const current = sql.join(
        q.currentPasses.map((p) => sql`(c.source_chunk = ${p.chunk} AND c.last_seen_at >= ${p.since})`),
        sql` OR `,
      );
      const [rows] = await db.execute(sql`
        SELECT c.nhtsa_id AS nhtsaId, c.document_id AS documentId, c.mfr_campaign_id AS mfrCampaignId,
               c.communication_type AS communicationType, c.match_signal AS matchSignal,
               c.matched_phrase AS matchedPhrase, DATE_FORMAT(c.mfr_date, '%Y-%m-%d') AS mfrDate,
               c.components AS components, c.summary AS summary,
               p.model_norm AS modelNorm, p.model_raw AS modelRaw, p.model_year AS modelYear
        FROM nhtsa_mfr_warranty_products p
        JOIN nhtsa_mfr_warranty_comms c ON c.nhtsa_id = p.nhtsa_id
        WHERE p.make_norm IN (${sql.join(q.makeSpellings.map((s) => sql`${s}`), sql`, `)})
          AND p.model_year IN (${q.year}, ${YEAR_NOT_STATED})
          AND (p.model_norm = ${q.modelNorm} OR p.model_norm LIKE ${like} OR ${q.modelNorm} LIKE CONCAT(p.model_norm, ' %'))
          AND (${current})
        LIMIT ${q.limit}
      `);
      return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
        nhtsaId: Number(r.nhtsaId),
        documentId: String(r.documentId ?? ""),
        mfrCampaignId: r.mfrCampaignId == null ? null : String(r.mfrCampaignId),
        communicationType: String(r.communicationType ?? ""),
        matchSignal: String(r.matchSignal ?? ""),
        matchedPhrase: r.matchedPhrase == null ? null : String(r.matchedPhrase),
        mfrDate: r.mfrDate == null ? null : String(r.mfrDate),
        components: r.components == null ? null : String(r.components),
        summary: String(r.summary ?? ""),
        modelNorm: String(r.modelNorm ?? ""),
        modelRaw: String(r.modelRaw ?? ""),
        modelYear: Number(r.modelYear),
      }));
    },
  };
}

export interface WarrantyReadDeps {
  store?: WarrantyReadStore | null;
  now?: () => Date;
}

/* ── ingest freshness (Intelligence HQ's Data freshness row, Q-50 phase 3) ── */

/** What the Data freshness row needs: the ingest's last success, and whether the job is switched on. */
export interface WarrantyFreshnessStore {
  readState(): Promise<IngestState>;
  /** The `nhtsa_warranty_ingest` flag row. A missing row is OFF (the flag seeds OFF). */
  readArmed(): Promise<boolean>;
}

export type WarrantyIngestFreshness =
  | {
      ok: true;
      /** ISO time the last run that finished without error ended; null = no run has ever finished. */
      lastSuccessAt: string | null;
      /** Same 3-day rule the work-order panel uses (§7.3), so the two never disagree. */
      stale: boolean;
      /** The `nhtsa_warranty_ingest` flag. */
      armed: boolean;
    }
  | { ok: false; error: string };

async function dbFreshnessStore(): Promise<WarrantyFreshnessStore | null> {
  const store = await dbReadStore();
  if (!store) return null;
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;
  return {
    readState: () => store.readState(),
    async readArmed() {
      // Read directly, not through featureFlags.isEnabled: that answers false when the
      // flag table cannot be read, and this row must say "unknown" then, not "off".
      const [rows] = await db.execute(sql`SELECT value FROM feature_flags WHERE \`key\` = ${INGEST_FLAG} LIMIT 1`);
      const v = (rows as unknown as Array<{ value?: unknown }>)?.[0]?.value;
      return v === true || v === 1 || v === "1";
    },
  };
}

/**
 * How current the stored NHTSA warranty list is, for the Data freshness card.
 * A failed read is `{ ok: false }` (the row says "unknown"), never "never ran".
 */
export async function warrantyIngestFreshness(
  deps: { store?: WarrantyFreshnessStore | null; now?: () => Date } = {},
): Promise<WarrantyIngestFreshness> {
  try {
    const store = deps.store !== undefined ? deps.store : await dbFreshnessStore();
    if (!store) throw new Error("database unavailable");
    const [state, armed] = await Promise.all([store.readState(), store.readArmed()]);
    const lastSuccessMs = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : NaN;
    if (!Number.isFinite(lastSuccessMs)) return { ok: true, lastSuccessAt: null, stale: false, armed };
    const now = (deps.now ?? (() => new Date()))();
    return { ok: true, lastSuccessAt: new Date(lastSuccessMs).toISOString(), stale: now.getTime() - lastSuccessMs > STALE_AFTER_MS, armed };
  } catch (err) {
    log.warn("warranty ingest freshness read failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Manufacturer warranty extensions that may apply to a year/make/model (§7.1). */
export async function warrantyExtensionsByVehicle(
  args: { year: string; make: string; model: string },
  deps: WarrantyReadDeps = {},
): Promise<WarrantyExtensionsResult | WarrantyExtensionsError> {
  const year = args.year.trim();
  const { make, model, aliased } = toNhtsaVehicleName(args.make, args.model);
  const modelNorm = normalizeVehicleName(model);
  if (!/^\d{4}$/.test(year) || !make || !modelNorm) {
    return { ok: false, source: SOURCE_LABEL, reason: "invalid_input", error: "year (YYYY), make, model required" };
  }

  try {
    const store = deps.store !== undefined ? deps.store : await dbReadStore();
    if (!store) throw new Error("database unavailable");

    const state = await store.readState();
    const lastSuccessMs = state.lastSuccessAt ? Date.parse(state.lastSuccessAt) : NaN;
    if (!Number.isFinite(lastSuccessMs)) {
      return {
        ok: false,
        source: SOURCE_LABEL,
        reason: "never_ingested",
        error: "the NHTSA warranty list has not been downloaded yet (the nhtsa_warranty_ingest job has never finished a run)",
      };
    }
    const currentPasses = Object.entries(state.chunks)
      .map(([chunk, c]) => ({ chunk, since: new Date(c.parsedAt) }))
      .filter((p) => Number.isFinite(p.since.getTime()));

    const rows = currentPasses.length
      ? await store.readRows({ makeSpellings: storedMakeSpellings(make), year: Number(year), modelNorm, currentPasses, limit: MAX_ROWS })
      : [];
    const all = groupMatches(rows, modelNorm, Number(year));
    const now = (deps.now ?? (() => new Date()))();
    return {
      ok: true,
      source: SOURCE_LABEL,
      year,
      make,
      model,
      aliased,
      freshness: { lastSuccessAt: new Date(lastSuccessMs).toISOString(), stale: now.getTime() - lastSuccessMs > STALE_AFTER_MS },
      matchCount: all.length,
      matches: all.slice(0, MAX_MATCHES),
      truncated: rows.length >= MAX_ROWS,
      disclaimer: WARRANTY_DISCLAIMER,
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { ok: false, source: SOURCE_LABEL, reason: "not_installed", error: "migration 0138_nhtsa_mfr_warranty is not applied" };
    }
    log.warn("warranty extension read failed", { error: err instanceof Error ? err.message : String(err) });
    return { ok: false, source: SOURCE_LABEL, reason: "read_failed", error: err instanceof Error ? err.message : String(err) };
  }
}
