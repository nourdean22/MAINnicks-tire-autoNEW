/**
 * NHTSA manufacturer warranty extensions · the ingest (ADR-0021 §5, §6; Q-50 phase 2a).
 *
 * Downloads NHTSA's manufacturer-communications zip chunks, keeps only the
 * rows nhtsaWarrantyParse.classify() calls a warranty extension, and upserts
 * them into nhtsa_mfr_warranty_comms / nhtsa_mfr_warranty_products
 * (migration 0138). It sends nothing, contacts no one, and nothing reads the
 * tables until phase 2b's panel ships.
 *
 * Gated by the `nhtsa_warranty_ingest` flag, default OFF. The flag stays off
 * until a measured run shows the parse keeps the event loop responsive
 * (max delay under 250 ms, ADR-0021 §9 2a.5): the job runs in the web
 * process, next to the Vapi and SMS webhooks. scripts/measure-nhtsa-ingest.ts
 * takes that measurement without a database.
 *
 * WHY NODE'S zlib AND NOT fflate (ADR-0021 §6.5 proposed fflate). A zip entry
 * is a raw-deflate stream behind a 30-byte header; node:zlib's InflateRaw
 * decodes it on the libuv thread pool, so the 392-876 MB inflate never runs
 * on the event loop at all, and the build adds no dependency. What is left on
 * the main thread is line splitting and the classifier, done one inflated
 * slice at a time with a setImmediate yield after each (§6.5).
 *
 * WHAT IS FETCHED (§6.3)
 *   - each chunk's zip, whole (12-33 MB; see downloadChunk for why not a
 *     ranged read). Its central directory gives the entry's CRC-32 and size.
 *     A chunk whose CRC-32 + size match its last parsed pass is not parsed,
 *     and that pass stays its reference. `last-modified` and the ETag are
 *     useless: NHTSA regenerates every chunk daily, with a new zip timestamp.
 *   - daily: the open (current) chunk only; Sunday (ET), or when no chunk has
 *     ever been parsed: every chunk.
 * The inflated stream is checked against the directory's CRC-32 and size, so
 * a truncated or corrupt download fails the run instead of upserting a prefix.
 *
 * FAILURE IS LOUD. A chunk-name probe that finds nothing, a malformed-row rate
 * over 1%, a CRC mismatch or a download error throws, and the scheduler
 * records a failed cron_log row. The run never reports success with zero rows.
 */
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createInflateRaw, crc32 } from "node:zlib";
import { createLogger } from "../lib/logger";
import { isMissingTableError } from "../lib/dbErrors";
import {
  WIDTH,
  chunkPlan,
  chunkUrl,
  classify,
  fit,
  normalizeVehicleName,
  parseLine,
  repairMojibake,
  type Signal,
} from "./nhtsaWarrantyParse";

const log = createLogger("nhtsa-warranty-ingest");

const MIGRATION_NAME = "0138_nhtsa_mfr_warranty";
/** shop_settings key holding the per-chunk parse state (no new table, ADR-0021 §6.3). */
const STATE_KEY = "nhtsa_warranty_chunk_state";
/** More than this share of malformed rows means the layout changed (like the May 2024 reorder): fail. */
const MAX_MALFORMED_RATE = 0.01;

/* ── zip central directory ─────────────────────────────────────── */

export interface ZipEntryInfo {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  method: number;
}

const EOCD_SIG = 0x06054b50;
const CDFH_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;
const EOCD_MIN = 22;
/** EOCD (22 B) + the longest legal comment (65,535 B): the directory of a one-entry zip is inside this tail. */
const TAIL_BYTES = EOCD_MIN + 0xffff;

/**
 * Read the single .txt entry from a zip's tail bytes. `tailStart` is the file
 * offset of `tail[0]`. Throws on anything this reader does not handle (ZIP64,
 * a directory outside the tail, no .txt entry) rather than guessing.
 */
function readCentralDirectory(tail: Buffer, tailStart: number): ZipEntryInfo {
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end-of-central-directory record not found");
  const entries = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("zip: ZIP64 archive not supported");
  const rel = cdOffset - tailStart;
  if (rel < 0 || rel + cdSize > tail.length) throw new Error("zip: central directory is outside the fetched tail");

  let p = rel;
  for (let n = 0; n < entries; n++) {
    if (tail.readUInt32LE(p) !== CDFH_SIG) throw new Error("zip: bad central directory entry");
    const method = tail.readUInt16LE(p + 10);
    const crc = tail.readUInt32LE(p + 16);
    const compressedSize = tail.readUInt32LE(p + 20);
    const uncompressedSize = tail.readUInt32LE(p + 24);
    const nameLen = tail.readUInt16LE(p + 28);
    const extraLen = tail.readUInt16LE(p + 30);
    const commentLen = tail.readUInt16LE(p + 32);
    const localHeaderOffset = tail.readUInt32LE(p + 42);
    const name = tail.toString("utf8", p + 46, p + 46 + nameLen);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      throw new Error("zip: ZIP64 entry not supported");
    }
    if (name.toLowerCase().endsWith(".txt")) {
      return { name, crc32: crc, compressedSize, uncompressedSize, localHeaderOffset, method };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("zip: no .txt entry in the archive");
}

/* ── HTTP ──────────────────────────────────────────────────────── */

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

const HTTP_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** HEAD a candidate chunk: true on 200, false on 403/404 (S3 answers 403 for a missing key), throws otherwise. */
async function chunkExists(fetchImpl: FetchLike, range: string): Promise<boolean> {
  const res = await fetchImpl(chunkUrl(range), { method: "HEAD", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (res.ok) return true;
  if (res.status === 404 || res.status === 403) return false;
  throw new Error(`chunk probe ${range}: HTTP ${res.status}`);
}

/** The open chunk's live name (§6.4). Throws "current chunk not found" when no candidate answers. */
export async function resolveOpenChunk(fetchImpl: FetchLike, now: Date): Promise<string> {
  const { openCandidates } = chunkPlan(etYear(now));
  for (const range of openCandidates) {
    if (await chunkExists(fetchImpl, range)) return range;
  }
  throw new Error(`current chunk not found (tried ${openCandidates.join(", ")})`);
}

/**
 * NHTSA's largest zip is 32.9 MB. Anything far beyond that is not the file
 * this parser was written for (or a runaway response): refuse it.
 */
const MAX_ZIP_BYTES = 200 * 1024 * 1024;

/**
 * Download one chunk whole. Not a ranged read of the tail: measured
 * 2026-10-01, the host answered `Range: bytes=-N` with HTTP 200 and the full
 * body (for curl and Node alike), so a design that needs a 206 would fail
 * every run. The zips are 12-33 MB; buffering one costs less than a second
 * request, and the central directory is then read from the same bytes.
 */
export async function downloadChunk(fetchImpl: FetchLike, range: string): Promise<Buffer> {
  const res = await fetchImpl(chunkUrl(range), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`chunk ${range}: HTTP ${res.status}`);
  const parts: Buffer[] = [];
  let total = 0;
  for await (const part of Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>)) {
    const buf = part as Buffer;
    total += buf.length;
    if (total > MAX_ZIP_BYTES) throw new Error(`chunk ${range}: response over ${MAX_ZIP_BYTES} bytes`);
    parts.push(buf);
  }
  return Buffer.concat(parts, total);
}

/** The .txt entry of a whole zip held in memory. */
export function entryOf(zip: Buffer): ZipEntryInfo {
  const tailStart = Math.max(0, zip.length - TAIL_BYTES);
  return readCentralDirectory(zip.subarray(tailStart), tailStart);
}

/** Slices of a buffer, as the stream parseZipStream reads. */
async function* slices(buf: Buffer, size = 256 * 1024): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, Math.min(i + size, buf.length));
}

/* ── streaming parse ───────────────────────────────────────────── */

export interface KeptComm {
  nhtsaId: number;
  documentId: string;
  mfrCampaignId: string | null;
  communicationType: string;
  /** Stored as match_signal: SIGNAL is a reserved word in MySQL/TiDB. */
  signal: Signal;
  matchedPhrase: string | null;
  mfrDate: string | null;
  addedDate: string | null;
  components: Set<string>;
  summary: string;
}

export interface KeptProduct {
  nhtsaId: number;
  makeNorm: string;
  modelNorm: string;
  modelYear: number;
  makeRaw: string;
  modelRaw: string;
}

export interface ChunkParse {
  rowsRead: number;
  rowsMalformed: number;
  comms: Map<number, KeptComm>;
  products: Map<string, KeptProduct>;
  productsWithoutName: number;
}

/** Collects kept rows. Classification is decided once per communication (the first row); the 2025-2026 chunk has 0 ids whose rows disagree. */
class RowCollector {
  readonly result: ChunkParse = { rowsRead: 0, rowsMalformed: 0, comms: new Map(), products: new Map(), productsWithoutName: 0 };
  private readonly dropped = new Set<number>();

  line(text: string): void {
    if (text === "" || text === "\r") return;
    this.result.rowsRead++;
    const parsed = parseLine(text);
    if (!parsed.ok) {
      this.result.rowsMalformed++;
      return;
    }
    const row = parsed.row;
    if (this.dropped.has(row.nhtsaId)) return;
    let comm = this.result.comms.get(row.nhtsaId);
    if (!comm) {
      const c = classify(row.communicationType, row.summary);
      if (!c) {
        this.dropped.add(row.nhtsaId);
        return;
      }
      comm = {
        nhtsaId: row.nhtsaId,
        documentId: fit(row.documentId, WIDTH.documentId),
        mfrCampaignId: row.mfrCampaignId == null ? null : fit(row.mfrCampaignId, WIDTH.mfrCampaignId),
        communicationType: fit(row.communicationType, WIDTH.communicationType),
        signal: c.signal,
        matchedPhrase: c.matchedPhrase == null ? null : fit(c.matchedPhrase, WIDTH.matchedPhrase),
        mfrDate: row.mfrDate,
        addedDate: row.addedDate,
        components: new Set(),
        summary: fit(repairMojibake(row.summary), WIDTH.summary),
      };
      this.result.comms.set(row.nhtsaId, comm);
    }
    if (row.component) comm.components.add(row.component);
    const makeNorm = fit(normalizeVehicleName(row.make), WIDTH.make);
    const modelNorm = fit(normalizeVehicleName(row.model), WIDTH.model);
    if (!makeNorm || !modelNorm) {
      this.result.productsWithoutName++;
      return;
    }
    const key = `${row.nhtsaId}\u0000${makeNorm}\u0000${modelNorm}\u0000${row.modelYear}`;
    if (!this.result.products.has(key)) {
      this.result.products.set(key, {
        nhtsaId: row.nhtsaId,
        makeNorm,
        modelNorm,
        modelYear: row.modelYear,
        makeRaw: fit(row.make, WIDTH.make),
        modelRaw: fit(row.model, WIDTH.model),
      });
    }
  }
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Parse one zip entry from the full-file byte stream. Strips the local file
 * header, feeds exactly `compressedSize` bytes to InflateRaw, splits lines,
 * and checks the inflated CRC-32 and size against the central directory.
 */
export async function parseZipStream(body: AsyncIterable<Uint8Array>, entry: ZipEntryInfo): Promise<ChunkParse> {
  if (entry.method !== 8) throw new Error(`zip: compression method ${entry.method} not supported (deflate only)`);
  if (entry.localHeaderOffset !== 0) throw new Error("zip: entry does not start at offset 0");

  const inflate = createInflateRaw({ chunkSize: 64 * 1024 });
  const collector = new RowCollector();
  const decoder = new StringDecoder("utf8");
  let carry = "";
  let crc = 0;
  let inflatedBytes = 0;

  const consume = (async () => {
    for await (const slice of inflate as AsyncIterable<Buffer>) {
      crc = crc32(slice, crc);
      inflatedBytes += slice.length;
      const text = carry + decoder.write(slice);
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const l of lines) collector.line(l);
      await yieldToEventLoop();
    }
    const rest = carry + decoder.end();
    if (rest) collector.line(rest);
  })();

  const feed = (async () => {
    let header: Buffer | null = Buffer.alloc(0);
    let dataStart = -1;
    let fed = 0;
    for await (const raw of body) {
      let buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      if (header) {
        header = Buffer.concat([header, buf]);
        if (header.length < 30) continue;
        if (header.readUInt32LE(0) !== LFH_SIG) throw new Error("zip: bad local file header");
        dataStart = 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        if (header.length < dataStart) continue;
        buf = header.subarray(dataStart);
        header = null;
      }
      const want = entry.compressedSize - fed;
      if (want <= 0) break;
      const piece = buf.length > want ? buf.subarray(0, want) : buf;
      fed += piece.length;
      if (!inflate.write(piece)) await new Promise<void>((resolve) => inflate.once("drain", resolve));
      if (fed >= entry.compressedSize) break;
    }
    inflate.end();
    if (fed !== entry.compressedSize) throw new Error(`zip: download ended after ${fed} of ${entry.compressedSize} compressed bytes`);
  })();

  // A feed failure must also stop the consumer, or it waits forever on an inflate that never ends.
  await Promise.all([feed.catch((e) => { inflate.destroy(e); throw e; }), consume]);

  if (inflatedBytes !== entry.uncompressedSize) {
    throw new Error(`zip: inflated ${inflatedBytes} bytes, directory says ${entry.uncompressedSize}`);
  }
  if (crc >>> 0 !== entry.crc32 >>> 0) throw new Error("zip: CRC-32 mismatch, download corrupt");
  return collector.result;
}

/* ── storage ───────────────────────────────────────────────────── */

export interface ChunkState {
  crc32: number;
  size: number;
  /** ISO time the last full parse of this chunk started; every row it saw carries this last_seen_at. */
  parsedAt: string;
}

export interface IngestState {
  chunks: Record<string, ChunkState>;
  /** ISO time the last run that finished without error ended (phase 2b's freshness source). */
  lastSuccessAt?: string;
}

export interface WarrantyStore {
  /** "missing" = migration 0138 not applied. */
  tablesPresent(): Promise<"present" | "missing">;
  readState(): Promise<IngestState>;
  writeState(state: IngestState): Promise<void>;
  upsertComms(rows: KeptComm[], chunk: string, seenAt: Date): Promise<void>;
  upsertProducts(rows: KeptProduct[]): Promise<void>;
}

const COMM_BATCH = 100;
const PRODUCT_BATCH = 500;

/** The production store: raw SQL on the shop's TiDB, natural-key upserts only. */
async function dbWarrantyStore(): Promise<WarrantyStore | null> {
  const { getDb } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return null;

  return {
    async tablesPresent() {
      try {
        await db.execute(sql`SELECT 1 FROM nhtsa_mfr_warranty_comms LIMIT 1`);
        await db.execute(sql`SELECT 1 FROM nhtsa_mfr_warranty_products LIMIT 1`);
        return "present";
      } catch (err) {
        if (isMissingTableError(err)) return "missing";
        throw err;
      }
    },
    async readState() {
      const [rows] = await db.execute(sql`SELECT value FROM shop_settings WHERE \`key\` = ${STATE_KEY} LIMIT 1`);
      return parseState((rows as unknown as Array<{ value?: string }>)?.[0]?.value);
    },
    async writeState(state) {
      await db.execute(sql`
        INSERT INTO shop_settings (\`key\`, value, label, updatedAt)
        VALUES (${STATE_KEY}, ${JSON.stringify(state)}, 'NHTSA warranty ingest chunk state (internal)', NOW())
        ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = NOW()
      `);
    },
    async upsertComms(rows, chunk, seenAt) {
      for (let i = 0; i < rows.length; i += COMM_BATCH) {
        const values = rows.slice(i, i + COMM_BATCH).map(
          (c) => sql`(${c.nhtsaId}, ${c.documentId}, ${c.mfrCampaignId}, ${c.communicationType}, ${c.signal}, ${c.matchedPhrase},
            ${c.mfrDate}, ${c.addedDate}, ${componentsText(c.components)}, ${c.summary}, ${fit(chunk, WIDTH.sourceChunk)}, ${seenAt})`,
        );
        await db.execute(sql`
          INSERT INTO nhtsa_mfr_warranty_comms
            (nhtsa_id, document_id, mfr_campaign_id, communication_type, match_signal, matched_phrase,
             mfr_date, added_date, components, summary, source_chunk, last_seen_at)
          VALUES ${sql.join(values, sql`, `)}
          ON DUPLICATE KEY UPDATE
            document_id = VALUES(document_id), mfr_campaign_id = VALUES(mfr_campaign_id),
            communication_type = VALUES(communication_type), match_signal = VALUES(match_signal),
            matched_phrase = VALUES(matched_phrase), mfr_date = VALUES(mfr_date), added_date = VALUES(added_date),
            components = VALUES(components), summary = VALUES(summary), source_chunk = VALUES(source_chunk),
            last_seen_at = VALUES(last_seen_at)
        `);
        await yieldToEventLoop();
      }
    },
    async upsertProducts(rows) {
      for (let i = 0; i < rows.length; i += PRODUCT_BATCH) {
        const values = rows.slice(i, i + PRODUCT_BATCH).map(
          (p) => sql`(${p.nhtsaId}, ${p.makeNorm}, ${p.modelNorm}, ${p.modelYear}, ${p.makeRaw}, ${p.modelRaw})`,
        );
        await db.execute(sql`
          INSERT INTO nhtsa_mfr_warranty_products (nhtsa_id, make_norm, model_norm, model_year, make_raw, model_raw)
          VALUES ${sql.join(values, sql`, `)}
          ON DUPLICATE KEY UPDATE make_raw = VALUES(make_raw), model_raw = VALUES(model_raw)
        `);
        await yieldToEventLoop();
      }
    },
  };
}

function componentsText(components: Set<string>): string | null {
  if (components.size === 0) return null;
  return fit([...components].sort().join(", "), WIDTH.components);
}

/** A corrupt or absent state row reads as "nothing parsed yet", which forces a full pass: the safe direction. */
function parseState(raw: string | null | undefined): IngestState {
  if (!raw) return { chunks: {} };
  try {
    const v = JSON.parse(raw) as IngestState;
    if (!v || typeof v !== "object" || !v.chunks || typeof v.chunks !== "object") return { chunks: {} };
    return v;
  } catch {
    return { chunks: {} };
  }
}

/* ── the run ───────────────────────────────────────────────────── */

export interface ChunkReceipt {
  range: string;
  status: "parsed" | "skipped_unchanged";
  rowsRead?: number;
  rowsMalformed?: number;
  comms?: number;
  products?: number;
}

export type IngestOutcome =
  | { status: "skipped"; reason: string }
  | {
      status: "completed";
      fullPass: boolean;
      chunks: ChunkReceipt[];
      rowsRead: number;
      rowsMalformed: number;
      commsKept: number;
      bySignal: Record<Signal, number>;
      productsUpserted: number;
    };

export interface IngestDeps {
  fetchImpl?: FetchLike;
  store?: WarrantyStore | null;
  now?: () => Date;
  isEnabled?: () => Promise<boolean>;
}

function etParts(now: Date): { year: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", weekday: "short" }).formatToParts(now);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    weekday: parts.find((p) => p.type === "weekday")?.value ?? "",
  };
}

function etYear(now: Date): number {
  return etParts(now).year;
}

/**
 * Sunday in ET, or any closed chunk never parsed -> every chunk; otherwise the
 * open chunk only. "Never parsed" (not "state empty") so a first full pass that
 * died half way finishes the next day instead of waiting for Sunday.
 */
function isFullPassDay(now: Date, state: IngestState, closed: readonly string[]): boolean {
  return etParts(now).weekday === "Sun" || closed.some((range) => !state.chunks[range]);
}

export async function runNhtsaWarrantyIngest(deps: IngestDeps = {}): Promise<IngestOutcome> {
  const enabled = deps.isEnabled ?? (async () => (await import("./featureFlags")).isEnabled("nhtsa_warranty_ingest"));
  if (!(await enabled())) return { status: "skipped", reason: "flag nhtsa_warranty_ingest is OFF" };

  const store = deps.store !== undefined ? deps.store : await dbWarrantyStore();
  if (!store) throw new Error("database unavailable");
  if ((await store.tablesPresent()) === "missing") {
    log.warn(`nhtsa_warranty_ingest is ON but migration ${MIGRATION_NAME} is not applied`);
    return { status: "skipped", reason: `migration ${MIGRATION_NAME} not applied` };
  }

  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const clock = deps.now ?? (() => new Date());
  const now = clock();
  const state = await store.readState();
  const { closed } = chunkPlan(etYear(now));
  const fullPass = isFullPassDay(now, state, closed);
  const open = await resolveOpenChunk(fetchImpl, now);
  const ranges = fullPass ? [...closed, open] : [open];

  const receipts: ChunkReceipt[] = [];
  const bySignal: Record<Signal, number> = { nhtsa_type: 0, summary_text: 0, both: 0 };
  let rowsRead = 0;
  let rowsMalformed = 0;
  let commsKept = 0;
  let productsUpserted = 0;

  for (const range of ranges) {
    const zip = await downloadChunk(fetchImpl, range);
    const entry = entryOf(zip);
    const prev = state.chunks[range];
    if (prev && prev.crc32 === entry.crc32 && prev.size === entry.uncompressedSize) {
      receipts.push({ range, status: "skipped_unchanged" });
      continue;
    }

    // One timestamp per chunk pass: every row this pass sees carries it, so "current" = seen by the latest pass (§5).
    const seenAt = new Date(Math.floor(clock().getTime() / 1000) * 1000);
    const parsed = await parseZipStream(slices(zip), entry);

    if (parsed.rowsRead === 0) throw new Error(`chunk ${range}: zero rows read`);
    if (parsed.rowsMalformed / parsed.rowsRead > MAX_MALFORMED_RATE) {
      throw new Error(`chunk ${range}: ${parsed.rowsMalformed} of ${parsed.rowsRead} rows malformed (over 1%: layout changed?)`);
    }

    const comms = [...parsed.comms.values()];
    const products = [...parsed.products.values()];
    await store.upsertComms(comms, range, seenAt);
    await store.upsertProducts(products);
    // Only after both upserts: a crash in between leaves the old reference, so the next run re-parses.
    state.chunks[range] = { crc32: entry.crc32 >>> 0, size: entry.uncompressedSize, parsedAt: seenAt.toISOString() };
    await store.writeState(state);

    for (const c of comms) bySignal[c.signal]++;
    rowsRead += parsed.rowsRead;
    rowsMalformed += parsed.rowsMalformed;
    commsKept += comms.length;
    productsUpserted += products.length;
    receipts.push({ range, status: "parsed", rowsRead: parsed.rowsRead, rowsMalformed: parsed.rowsMalformed, comms: comms.length, products: products.length });
  }

  state.lastSuccessAt = clock().toISOString();
  await store.writeState(state);
  return { status: "completed", fullPass, chunks: receipts, rowsRead, rowsMalformed, commsKept, bySignal, productsUpserted };
}

/** The cron_log `details` line (§6.6). */
export function describeOutcome(o: IngestOutcome): string {
  if (o.status === "skipped") return `skipped — ${o.reason}`;
  const parsed = o.chunks.filter((c) => c.status === "parsed").map((c) => c.range);
  const unchanged = o.chunks.filter((c) => c.status === "skipped_unchanged").map((c) => c.range);
  return [
    `${o.fullPass ? "full" : "daily"} pass`,
    `chunks parsed ${parsed.length}${parsed.length ? ` (${parsed.join(", ")})` : ""}`,
    `unchanged ${unchanged.length}${unchanged.length ? ` (${unchanged.join(", ")})` : ""}`,
    `rows read ${o.rowsRead}, malformed ${o.rowsMalformed}`,
    `communications kept ${o.commsKept} (type ${o.bySignal.nhtsa_type}, text ${o.bySignal.summary_text}, both ${o.bySignal.both})`,
    `products upserted ${o.productsUpserted}`,
  ].join(" · ");
}
