/**
 * Q-50 phase 2a · ADR-0021 §9 acceptance for the NHTSA warranty-extension ingest.
 *
 *   (1) fixture rows: typed WPE kept, GM "Service Campaign" Special Coverage kept,
 *       a typed "Warranty Newsletter" kept, a VW enrollment-window row dropped,
 *       a malformed row counted
 *   (2) each signal is load-bearing: rows found by only one signal pin it
 *   (3) the chunk-name probe fails the run when every candidate 404s
 *   (4) a re-parse of the same file upserts onto the same natural keys
 * plus the guards around them: CRC/size check, the 1% malformed ceiling,
 * flag-off and migration-missing skips, the Sunday / first-pass rule.
 *
 * The zip is built here, byte for byte in NHTSA's shape (deflate, data
 * descriptor, sizes only in the central directory), and served by a fake
 * fetch that answers HEAD and a chunked streaming GET.
 */
import { crc32, deflateRawSync } from "node:zlib";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  describeOutcome,
  entryOf,
  parseZipStream,
  runNhtsaWarrantyIngest,
  type ChunkParse,
  type FetchLike,
  type IngestState,
  type KeptComm,
  type KeptProduct,
  type WarrantyStore,
} from "./nhtsaWarrantyIngest";
import { chunkPlan, classify, normalizeVehicleName, parseLine, repairMojibake } from "./nhtsaWarrantyParse";

/*
 * The real dbWarrantyStore over a fake connection: the last describe block runs
 * the ingest with no injected store, so production SQL is what gets rendered.
 * Every other test injects an in-memory store and never reaches getDb.
 */
const db = vi.hoisted(() => ({ executed: [] as unknown[], stateValue: null as string | null }));
vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      db.executed.push(q);
      const text = JSON.stringify(q);
      if (text.includes("SELECT value FROM shop_settings")) return [db.stateValue == null ? [] : [{ value: db.stateValue }], []];
      return [[], []];
    },
  }),
}));

/* ── fixtures ──────────────────────────────────────────────────── */

function row(f: {
  id: number;
  type: string;
  make: string;
  model: string;
  year: string;
  component?: string;
  summary: string;
}): string {
  // 14 fields: id, (blank), added, doc id, mfr date, campaign, type, make, model, year, component, 2 blanks, summary
  return [String(f.id), "", "20250102", `DOC-${f.id}`, "20241220", `C${f.id}`, f.type, f.make, f.model, f.year, f.component ?? "ENGINE", "", "", f.summary].join("\t");
}

const TYPED = row({
  id: 11000001,
  type: "Warranty Program/Extension",
  make: "HYUNDAI",
  model: "SANTA FE",
  year: "2017",
  summary: "Certain 2013-2019 Santa Fe vehicles: engine damage inspection program.",
});
const GM_SPECIAL_COVERAGE = row({
  id: 11013460,
  type: "Service Campaign",
  make: "CHEVROLET",
  model: "SILVERADO 1500",
  year: "2016",
  component: "ENGINE AND ENGINE COOLING",
  summary: "SPECIAL COVERAGE ADJUSTMENT - ENGINE THERMOSTAT. This special coverage covers the condition described.",
});
const NEWSLETTER = row({
  id: 11011962,
  type: "Warranty Program / Extension",
  make: "ALFA ROMEO",
  model: "GIULIA",
  year: "2020",
  summary: "Warranty Newsletter - Volume 10.",
});
const VW_ENROLLMENT = row({
  id: 10122934,
  type: "Service Bulletin/Repair Instructions",
  make: "VOLKSWAGEN",
  model: "JETTA",
  year: "2015",
  summary: "Program update: the enrollment period for this program has been extended to December 31.",
});
const MALFORMED = "11099999\tonly\tthree fields";
const PLAIN_TSB = row({
  id: 11000777,
  type: "Service Bulletin/Repair Instructions",
  make: "FORD",
  model: "F-150",
  year: "2018",
  summary: "Rough idle after cold start. Reprogram the PCM.",
});

/** Run lines through the production path: zip them like NHTSA, then parseZipStream. */
async function collect(lines: string[]): Promise<ChunkParse> {
  const zip = buildZip("t.txt", lines.join("\n"));
  async function* pieces() {
    for (let i = 0; i < zip.length; i += 64) yield zip.subarray(i, i + 64);
  }
  return parseZipStream(pieces(), entryOf(zip));
}

/* ── zip + fake HTTP ───────────────────────────────────────────── */

function u16(n: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

/** A one-entry zip shaped like NHTSA's: general-purpose bit 3, zeros in the local header, a data descriptor. */
function buildZip(name: string, text: string, opts: { corruptCrc?: boolean } = {}): Buffer {
  const data = Buffer.from(text, "utf8");
  const deflated = deflateRawSync(data);
  const crc = opts.corruptCrc ? (crc32(data) ^ 1) >>> 0 : crc32(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(8), u16(8), u16(0), u16(0), u32(0), u32(0), u32(0), u16(nameBuf.length), u16(0), nameBuf]);
  const descriptor = Buffer.concat([u32(0x08074b50), u32(crc), u32(deflated.length), u32(data.length)]);
  const cdOffset = local.length + deflated.length + descriptor.length;
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(8), u16(8), u16(0), u16(0),
    u32(crc), u32(deflated.length), u32(data.length),
    u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), nameBuf,
  ]);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(cdOffset), u16(0)]);
  return Buffer.concat([local, deflated, descriptor, central, eocd]);
}

interface FakeNet {
  fetchImpl: FetchLike;
  calls: string[];
}

/** Serves `files` (range -> zip). Unknown chunks 404. The body streams in 7-byte pieces first, so the local header straddles reads. */
function fakeNet(files: Record<string, Buffer>): FakeNet {
  const calls: string[] = [];
  const rangeOf = (url: string) => /TSBS_RECEIVED_(.+)\.zip$/.exec(url)?.[1] ?? "";
  const fetchImpl: FetchLike = async (url, init) => {
    const range = rangeOf(url);
    const zip = files[range];
    const method = init?.method ?? "GET";
    calls.push(`${method} ${range}`);
    if (!zip) return new Response(null, { status: 404 });
    if (method === "HEAD") return new Response(null, { status: 200 });
    const pieces: Buffer[] = [];
    let i = 0;
    for (; i < Math.min(35, zip.length); i += 7) pieces.push(zip.subarray(i, Math.min(i + 7, zip.length)));
    for (; i < zip.length; i += 4096) pieces.push(zip.subarray(i, i + 4096));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of pieces) controller.enqueue(new Uint8Array(p));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  };
  return { fetchImpl, calls };
}

/** In-memory store keyed exactly like the tables' primary keys. */
function memoryStore(opts: { missing?: boolean } = {}) {
  const comms = new Map<number, KeptComm & { chunk: string; seenAt: Date }>();
  const products = new Map<string, KeptProduct>();
  let state: IngestState = { chunks: {} };
  const store: WarrantyStore = {
    tablesPresent: async () => (opts.missing ? "missing" : "present"),
    readState: async () => JSON.parse(JSON.stringify(state)) as IngestState,
    writeState: async (s) => {
      state = JSON.parse(JSON.stringify(s)) as IngestState;
    },
    upsertComms: async (rows, chunk, seenAt) => {
      for (const r of rows) comms.set(r.nhtsaId, { ...r, chunk, seenAt });
    },
    upsertProducts: async (rows) => {
      for (const p of rows) products.set(`${p.nhtsaId}|${p.makeNorm}|${p.modelNorm}|${p.modelYear}`, p);
    },
  };
  return { store, comms, products, getState: () => state, setState: (s: IngestState) => (state = s) };
}

const TUESDAY = new Date("2026-10-06T14:00:00Z"); // 10:00 ET
const SUNDAY = new Date("2026-10-04T14:00:00Z");
const on = async () => true;
const allClosed = (now: Date) => chunkPlan(Number(now.getUTCFullYear())).closed;
function fullyParsedState(now: Date): IngestState {
  const chunks: IngestState["chunks"] = {};
  for (const r of allClosed(now)) chunks[r] = { crc32: 1, size: 1, parsedAt: "2026-09-01T00:00:00.000Z" };
  return { chunks };
}

/** A zip for every chunk of 2026, each holding one plain TSB row. */
function everyChunk(): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  for (const r of [...allClosed(TUESDAY), "2025-2026"]) files[r] = buildZip(`TSBS_RECEIVED_${r}.txt`, `${PLAIN_TSB}\n`);
  return files;
}

/* ── (1) + (2) classification ──────────────────────────────────── */

describe("classification (ADR-0021 §4)", () => {
  it("keeps the typed row, the GM Special Coverage row and the typed newsletter; drops the VW enrollment row; counts the malformed row", async () => {
    const r = await collect([TYPED, GM_SPECIAL_COVERAGE, NEWSLETTER, VW_ENROLLMENT, MALFORMED, PLAIN_TSB, ""]);
    expect(r.rowsRead).toBe(6);
    expect(r.rowsMalformed).toBe(1);
    expect([...r.comms.keys()].sort()).toEqual([11000001, 11011962, 11013460]);
    expect(r.comms.get(11000001)?.signal).toBe("nhtsa_type");
    expect(r.comms.get(11013460)?.signal).toBe("summary_text");
    expect(r.comms.get(11013460)?.matchedPhrase).toBe("SPECIAL COVERAGE");
    expect(r.comms.get(11011962)?.signal).toBe("nhtsa_type");
    expect(r.comms.has(10122934)).toBe(false);
  });

  it("needs both signals: the typed row has no warranty wording, the GM row has no warranty type", () => {
    // Drop either signal from classify() and one of these turns red.
    expect(classify("Warranty Program/Extension", "Certain Santa Fe vehicles: engine damage inspection.")?.signal).toBe("nhtsa_type");
    expect(classify("Service Campaign", "SPECIAL COVERAGE ADJUSTMENT - ENGINE THERMOSTAT")?.signal).toBe("summary_text");
    expect(classify("Warranty Program/Extension", "This warranty extension covers the turbo.")?.signal).toBe("both");
  });

  it("requires WARRANTY or COVERAGE within 120 characters before HAS BEEN EXTENDED", () => {
    expect(classify("Other", "The enrollment period has been extended.")).toBeNull();
    expect(classify("Other", "The field campaign deadline has been extended to June.")).toBeNull();
    expect(classify("Other", "Coverage for the transmission valve body has been extended to 10 years.")?.matchedPhrase).toBe(
      "WARRANTY/COVERAGE ... HAS BEEN EXTENDED",
    );
    expect(classify("Other", `Warranty ${"x".repeat(130)} has been extended.`)).toBeNull();
  });

  it("collects every product of a kept communication, the union of its components, and normalized names", async () => {
    const second = row({ id: 11013460, type: "Service Campaign", make: "CHEVROLET", model: "SILVERADO 1500", year: "2017", component: "ELECTRICAL SYSTEM", summary: "SPECIAL COVERAGE ADJUSTMENT" });
    const sameProductOtherComponent = row({ id: 11013460, type: "Service Campaign", make: "CHEVROLET", model: "SILVERADO 1500", year: "2016", component: "POWER TRAIN", summary: "SPECIAL COVERAGE ADJUSTMENT" });
    const r = await collect([GM_SPECIAL_COVERAGE, second, sameProductOtherComponent]);
    expect(r.products.size).toBe(2);
    expect([...r.comms.get(11013460)!.components].sort()).toEqual(["ELECTRICAL SYSTEM", "ENGINE AND ENGINE COOLING", "POWER TRAIN"]);
    expect([...r.products.values()][0]).toMatchObject({ makeNorm: "CHEVROLET", modelNorm: "SILVERADO 1500", modelRaw: "SILVERADO 1500" });
  });

  it("never passes an impossible date to a DATE column (TiDB STRICT would fail the whole batch)", () => {
    const withDates = (added: string, mfr: string) =>
      parseLine(["11000001", "", added, "DOC", mfr, "C", "Other", "KIA", "FORTE", "2017", "ENGINE", "", "", "x"].join("\t"));
    const ok = withDates("20240229", "20241220");
    expect(ok.ok && [ok.row.addedDate, ok.row.mfrDate]).toEqual(["2024-02-29", "2024-12-20"]);
    for (const bad of ["20240231", "20230229", "20241301", "20240100", "2024123", ""]) {
      const p = withDates(bad, bad);
      expect(p.ok && [p.row.addedDate, p.row.mfrDate], bad).toEqual([null, null]);
    }
  });

  it("normalizes names per §8 step 1 and treats a blank year as 9999", () => {
    expect(normalizeVehicleName("F-150")).toBe("F150");
    expect(normalizeVehicleName("Mercedes-Benz")).toBe("MERCEDESBENZ");
    expect(normalizeVehicleName("  silverado   1500 ")).toBe("SILVERADO 1500");
    const p = parseLine(row({ id: 1, type: "Other", make: "KIA", model: "FORTE", year: "", summary: "x" }));
    expect(p.ok && p.row.modelYear).toBe(9999);
  });

  it("repairs the three mis-encodings seen in the live files, and leaves real text alone", () => {
    const u = (codes: number[]) => String.fromCodePoint(...codes);
    // 1 · cp1252 double encoding (the shape ADR-0021 quoted)
    expect(repairMojibake(`Owner${u([0xe2, 0x20ac, 0x2122])}s ${u([0xe2, 0x20ac, 0xa2])} note`)).toBe("Owner’s • note");
    // 2 · latin-1 double encoding, as in 2020-2024 id 10184998 ("the driver's airbag")
    expect(repairMojibake(`the driver${u([0xe2, 0x80, 0x99])}s airbag`)).toBe("the driver’s airbag");
    // 3 · latin-1 triple encoding, as in id 10189757 ("Vehicles - Front NOx")
    expect(repairMojibake(`Vehicles ${u([0xc3, 0xa2, 0xc2, 0x80, 0xc2, 0x93])} Front NOx`)).toBe("Vehicles – Front NOx");
    // a real accented letter touching a broken sequence does not block the repair
    expect(repairMojibake(`caf${u([0xe9, 0xe2, 0x80, 0x99])}s`)).toBe("café’s");
    // symbol-font bullets decode into the Private Use Area; shown as a bullet
    expect(repairMojibake(`${u([0xef, 0x82, 0xb7])} step one`)).toBe("• step one");
    // UTF-8-shaped but invalid bytes (an overlong sequence) stay as they are, never U+FFFD
    expect(repairMojibake(`x${u([0xe0, 0x80, 0x80])}y`)).toBe(`x${u([0xe0, 0x80, 0x80])}y`);
    // real text is untouched
    for (const ok of ["Café – plain", "Citroën éè", "90° bend", "plain ascii"]) expect(repairMojibake(ok)).toBe(ok);
  });
});

/* ── chunk naming ──────────────────────────────────────────────── */

describe("chunk plan (§6.4)", () => {
  it("lists the fixed closed ranges and probes the open range by this year first", () => {
    expect(chunkPlan(2026)).toEqual({
      closed: ["1995-1999", "2000-2004", "2005-2009", "2010-2014", "2015-2019", "2020-2024"],
      openCandidates: ["2025-2026", "2025-2029"],
    });
    expect(chunkPlan(2029).openCandidates).toEqual(["2025-2029"]);
    expect(chunkPlan(2030).closed.at(-1)).toBe("2025-2029");
    expect(chunkPlan(2030).openCandidates).toEqual(["2030-2030", "2030-2034"]);
  });

  it("does a full pass on Sunday ET, or while any closed chunk was never parsed", async () => {
    const fullPass = async (now: Date, state: IngestState) => {
      const mem = memoryStore();
      mem.setState(state);
      const o = await runNhtsaWarrantyIngest({ fetchImpl: fakeNet(everyChunk()).fetchImpl, store: mem.store, isEnabled: on, now: () => now });
      return o.status === "completed" && o.fullPass;
    };
    expect(await fullPass(TUESDAY, { chunks: {} })).toBe(true);
    expect(await fullPass(TUESDAY, fullyParsedState(TUESDAY))).toBe(false);
    const halfDone = fullyParsedState(TUESDAY);
    delete halfDone.chunks["2010-2014"];
    expect(await fullPass(TUESDAY, halfDone)).toBe(true);
    expect(await fullPass(SUNDAY, fullyParsedState(SUNDAY))).toBe(true);
    // 2026-10-05 02:30Z is still Sunday 22:30 in Cleveland; 2026-10-04 03:30Z is still Saturday.
    expect(await fullPass(new Date("2026-10-05T02:30:00Z"), fullyParsedState(SUNDAY))).toBe(true);
    expect(await fullPass(new Date("2026-10-04T03:30:00Z"), fullyParsedState(SUNDAY))).toBe(false);
  });
});

/* ── zip reader ────────────────────────────────────────────────── */

describe("zip central directory", () => {
  it("reads the entry's CRC-32 and sizes from the directory even though the local header carries zeros", () => {
    const text = `${TYPED}\n`;
    const info = entryOf(buildZip("TSBS_RECEIVED_2025-2026.txt", text));
    expect(info).toMatchObject({ name: "TSBS_RECEIVED_2025-2026.txt", method: 8, uncompressedSize: Buffer.byteLength(text), localHeaderOffset: 0 });
    expect(info.crc32).toBe(crc32(Buffer.from(text)));
  });

  it("refuses bytes that are not a zip instead of guessing", () => {
    expect(() => entryOf(Buffer.alloc(40))).toThrow(/end-of-central-directory/);
    expect(() => entryOf(Buffer.from("<html>Access Denied</html>"))).toThrow(/end-of-central-directory/);
  });
});

/* ── the run ───────────────────────────────────────────────────── */

const CURRENT_TEXT = [TYPED, GM_SPECIAL_COVERAGE, NEWSLETTER, VW_ENROLLMENT, PLAIN_TSB].join("\n") + "\n";

describe("runNhtsaWarrantyIngest", () => {
  it("skips without any download while the flag is OFF", async () => {
    const net = fakeNet({});
    const mem = memoryStore();
    const o = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: async () => false, now: () => TUESDAY });
    expect(describeOutcome(o)).toBe("skipped — flag nhtsa_warranty_ingest is OFF");
    expect(net.calls).toEqual([]);
  });

  it("skips, naming the migration, when the flag is ON but 0138 is not applied", async () => {
    const net = fakeNet({});
    const o = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: memoryStore({ missing: true }).store, isEnabled: on, now: () => TUESDAY });
    expect(describeOutcome(o)).toBe("skipped — migration 0138_nhtsa_mfr_warranty not applied");
    expect(net.calls).toEqual([]);
  });

  it("(3) fails the run when no open-chunk candidate exists, and writes nothing", async () => {
    const net = fakeNet({ "2020-2024": buildZip("x.txt", CURRENT_TEXT) });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    await expect(runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY })).rejects.toThrow(
      "current chunk not found (tried 2025-2026, 2025-2029)",
    );
    expect(net.calls).toEqual(["HEAD 2025-2026", "HEAD 2025-2029"]);
    expect(mem.comms.size).toBe(0);
  });

  it("takes the second candidate when this year's name is absent", async () => {
    const net = fakeNet({ "2025-2029": buildZip("TSBS_RECEIVED_2025-2029.txt", CURRENT_TEXT) });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    const o = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY });
    expect(o.status === "completed" && o.chunks.map((c) => c.range)).toEqual(["2025-2029"]);
  });

  it("streams the daily chunk end to end, records signals, and skips an unchanged chunk next time", async () => {
    const net = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", CURRENT_TEXT) });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    const first = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY });
    expect(describeOutcome(first)).toBe(
      "daily pass · chunks parsed 1 (2025-2026) · unchanged 0 · rows read 5, malformed 0 · communications kept 3 (type 2, text 1, both 0) · products upserted 3",
    );
    expect(mem.comms.get(11013460)).toMatchObject({ chunk: "2025-2026", signal: "summary_text", mfrDate: "2024-12-20", addedDate: "2025-01-02" });
    expect(mem.comms.get(11013460)!.seenAt.toISOString()).toBe("2026-10-06T14:00:00.000Z");
    expect(mem.getState().chunks["2025-2026"]).toMatchObject({ size: Buffer.byteLength(CURRENT_TEXT), parsedAt: "2026-10-06T14:00:00.000Z" });
    expect(mem.getState().lastSuccessAt).toBe("2026-10-06T14:00:00.000Z");

    net.calls.length = 0;
    const second = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => new Date("2026-10-07T14:00:00Z") });
    expect(second.status === "completed" && second.chunks).toEqual([{ range: "2025-2026", status: "skipped_unchanged" }]);
    expect(net.calls).toEqual(["HEAD 2025-2026", "GET 2025-2026"]); // downloaded, CRC read, not parsed
    expect(mem.getState().chunks["2025-2026"].parsedAt).toBe("2026-10-06T14:00:00.000Z"); // the parsed pass stays the reference
  });

  it("(4) re-parsing the same file lands on the same natural keys (row counts unchanged)", async () => {
    const net = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", CURRENT_TEXT) });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY });
    const counts = [mem.comms.size, mem.products.size];
    mem.setState(fullyParsedState(TUESDAY)); // forget the CRC so the chunk is parsed again
    await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => new Date("2026-10-07T14:00:00Z") });
    expect([mem.comms.size, mem.products.size]).toEqual(counts);
    expect(counts).toEqual([3, 3]);
  });

  it("parses every chunk on the first armed run", async () => {
    const files: Record<string, Buffer> = {};
    for (const r of [...allClosed(TUESDAY), "2025-2026"]) files[r] = buildZip(`TSBS_RECEIVED_${r}.txt`, `${PLAIN_TSB}\n`);
    files["2015-2019"] = buildZip("TSBS_RECEIVED_2015-2019.txt", `${GM_SPECIAL_COVERAGE}\n${PLAIN_TSB}\n`);
    const mem = memoryStore();
    const o = await runNhtsaWarrantyIngest({ fetchImpl: fakeNet(files).fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY });
    expect(o.status === "completed" && o.fullPass).toBe(true);
    expect(o.status === "completed" && o.chunks.map((c) => c.status)).toEqual(Array(7).fill("parsed"));
    expect(mem.comms.get(11013460)?.chunk).toBe("2015-2019");
    expect(Object.keys(mem.getState().chunks).sort()).toEqual([...allClosed(TUESDAY), "2025-2026"].sort());
  });

  it("fails a corrupt download (CRC mismatch) and keeps the old reference", async () => {
    const net = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", CURRENT_TEXT, { corruptCrc: true }) });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    await expect(runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY })).rejects.toThrow(/CRC-32 mismatch/);
    expect(mem.comms.size).toBe(0);
    expect(mem.getState().chunks["2025-2026"]).toBeUndefined();
  });

  it("fails when more than 1% of rows are malformed (layout drift), and writes nothing", async () => {
    const lines = Array.from({ length: 98 }, () => PLAIN_TSB);
    lines.push(MALFORMED, MALFORMED, TYPED);
    const net = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", lines.join("\n")) });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    await expect(runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY })).rejects.toThrow(
      /2 of 101 rows malformed/,
    );
    expect(mem.comms.size).toBe(0);
  });

  it("fails an empty chunk rather than reporting success with zero rows", async () => {
    const net = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", "") });
    const mem = memoryStore();
    mem.setState(fullyParsedState(TUESDAY));
    await expect(runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, store: mem.store, isEnabled: on, now: () => TUESDAY })).rejects.toThrow(/zero rows read/);
  });
});

describe("the production store (dbWarrantyStore)", () => {
  const dialect = new MySqlDialect();
  const texts = () => db.executed.map((q) => dialect.sqlToQuery(q as SQL).sql.replace(/\s+/g, " ").trim());

  it("writes only natural-key upserts, so a re-run or two runners never duplicate a row", async () => {
    db.executed.length = 0;
    db.stateValue = JSON.stringify(fullyParsedState(TUESDAY));
    const net = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", CURRENT_TEXT) });
    const o = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, isEnabled: on, now: () => TUESDAY });
    expect(o.status === "completed" && o.commsKept).toBe(3);

    const writes = texts().filter((t) => !t.startsWith("SELECT"));
    expect(writes.map((t) => t.split(" (")[0])).toEqual([
      "INSERT INTO nhtsa_mfr_warranty_comms",
      "INSERT INTO nhtsa_mfr_warranty_products",
      "INSERT INTO shop_settings", // chunk reference
      "INSERT INTO shop_settings", // lastSuccessAt
    ]);
    for (const w of writes) expect(w).toMatch(/ ON DUPLICATE KEY UPDATE /);
    expect(writes[0]).toMatch(/\(nhtsa_id, document_id, mfr_campaign_id, communication_type, match_signal, matched_phrase, mfr_date, added_date, components, summary, source_chunk, last_seen_at\)/);
    for (const t of texts()) expect(t).not.toMatch(/\b(?:DELETE|REPLACE|TRUNCATE|DROP)\b|UPDATE nhtsa/i);
  });

  it("reads a corrupt state row as nothing parsed, which forces the safe full pass", async () => {
    db.executed.length = 0;
    db.stateValue = "{not json";
    const net = fakeNet(everyChunk());
    const o = await runNhtsaWarrantyIngest({ fetchImpl: net.fetchImpl, isEnabled: on, now: () => TUESDAY });
    expect(o.status === "completed" && o.fullPass).toBe(true);
    expect(o.status === "completed" && o.chunks).toHaveLength(7);
  });
});

/* ── January: NHTSA renames the open chunk ─────────────────────── */

describe("January rename of the open chunk", () => {
  const DEC_30 = new Date("2026-12-30T15:00:00Z"); // Wednesday, 10:00 ET
  const JAN_12 = new Date("2027-01-12T15:00:00Z"); // Tuesday, 10:00 ET

  async function decemberThenJanuary(januaryFiles: Record<string, Buffer>) {
    const mem = memoryStore();
    mem.setState(fullyParsedState(DEC_30));
    const december = fakeNet({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", CURRENT_TEXT) });
    await runNhtsaWarrantyIngest({ fetchImpl: december.fetchImpl, store: mem.store, isEnabled: on, now: () => DEC_30 });
    expect(mem.getState().chunks["2025-2026"]).toBeDefined();
    const o = await runNhtsaWarrantyIngest({ fetchImpl: fakeNet(januaryFiles).fetchImpl, store: mem.store, isEnabled: on, now: () => JAN_12 });
    return { mem, o };
  }

  it("once NHTSA serves 2025-2027, last year's name loses its pass, so rows NHTSA dropped stop counting as current", async () => {
    // GM_SPECIAL_COVERAGE and VW_ENROLLMENT are gone from the renamed file.
    const renamed = [TYPED, NEWSLETTER, PLAIN_TSB].join("\n") + "\n";
    const { mem, o } = await decemberThenJanuary({ "2025-2027": buildZip("TSBS_RECEIVED_2025-2027.txt", renamed) });
    expect(o.status === "completed" && o.chunks).toEqual([expect.objectContaining({ range: "2025-2027", status: "parsed" })]);
    expect(mem.comms.get(11000001)).toMatchObject({ chunk: "2025-2027" }); // still listed: moved to the new name
    expect(mem.comms.get(11013460)).toMatchObject({ chunk: "2025-2026" }); // dropped: its row stays under the old name
    const names = Object.keys(mem.getState().chunks);
    expect(names).toContain("2025-2027");
    expect(names).not.toContain("2025-2026"); // the read builds its current passes from these names
    expect(names).toEqual(expect.arrayContaining(allClosed(JAN_12))); // a daily run keeps the closed chunks' passes
  });

  it("while NHTSA still serves 2025-2026 in January, that name keeps its pass (control)", async () => {
    const { mem, o } = await decemberThenJanuary({ "2025-2026": buildZip("TSBS_RECEIVED_2025-2026.txt", CURRENT_TEXT) });
    expect(o.status === "completed" && o.chunks).toEqual([{ range: "2025-2026", status: "skipped_unchanged" }]);
    expect(Object.keys(mem.getState().chunks)).toContain("2025-2026");
  });
});
