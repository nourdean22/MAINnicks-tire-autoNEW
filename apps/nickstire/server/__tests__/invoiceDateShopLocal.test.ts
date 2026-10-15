/**
 * `invoices.invoiceDate` is read as the stored shop day, never as a UTC instant to convert.
 *
 * What ShopDriver rows hold (SELECT-only read of production, 2026-10-15): timed tickets store the
 * ticket time as UTC digits (stored hours cluster at 13-22 UTC, none at 9-11); date-only tickets sit
 * at 00:00:00, at 04:00:00 (local midnight in UTC) or at the noon default. The mirror stores
 * `new Date(ri.date)` on a UTC server and rewrites invoiceDate on every sync of an existing row
 * (shopDriverMirror.ts:952). Rows written by the app itself carry the shop wall clock.
 *
 * The readers that agree (revenue_range, lot_brief, shopSales, customerStatsRead and every
 * `DATE(invoiceDate)`) compare the stored digits with the shop's date. That is safe for timed
 * tickets because business hours never cross UTC midnight: UTC digits and wall-clock digits land on
 * the same day. Five readers converted the column FROM UTC instead (revenue_today, both cars_today
 * invoice reads, the scheduler's weekday volume check, and kpi-snapshot's week bounds), which moved
 * date-only tickets stored at 00:00:00 onto the day before: today's revenue counted only timed
 * tickets and the volume check saw a near-empty today (found 2026-10-09; Codex had found the same
 * shift in lot_brief on #2931).
 *
 * A source scan because the defect is a shape any new reader can reintroduce.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = path.resolve(__dirname, "..");

/** `CONVERT_TZ(invoiceDate` with an optional table alias, across whitespace. */
const UTC_CONVERSION = /CONVERT_TZ\(\s*(?:`?\w+`?\.)?`?invoice_?[dD]ate`?\s*,/g;
/** The same shift from the other side: `invoiceDate >= CONVERT_TZ(<shop bound>, ...)`. */
const UTC_BOUND = /(?:`?\w+`?\.)?`?invoice_?[dD]ate`?\s*(?:>=|<=|<|>|=)\s*CONVERT_TZ\(/g;

function serverSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(full).isDirectory()) serverSources(full, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/** A same-file helper handed the column by name: `et("invoiceDate")`. */
const HELPER_CALL = /\b(\w+)\(\s*["'`]invoice_?[dD]ate["'`]\s*\)/g;

/** The helper's definition up to the end of its statement, or null when it is not defined here. */
function helperBody(text: string, name: string): string | null {
  const def = new RegExp(`(?:const|let|var|function)\\s+${name}\\b`).exec(text);
  if (!def) return null;
  const rest = text.slice(def.index);
  const end = rest.search(/;\s*\n/);
  return end === -1 ? rest.slice(0, 600) : rest.slice(0, end);
}

function findUtcConversions(files: Array<{ file: string; text: string }>): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) {
    const at = (index: number | undefined) => `${file}:${text.slice(0, index).split("\n").length}`;
    for (const re of [UTC_CONVERSION, UTC_BOUND]) {
      for (const m of text.matchAll(re)) hits.push(at(m.index));
    }
    // opportunityQueue read `${et("invoiceDate")}` through a CONVERT_TZ helper, a shape the two
    // literal patterns cannot see (found 2026-10-09 by review, after the five readers above).
    for (const m of text.matchAll(HELPER_CALL)) {
      if (helperBody(text, m[1]!)?.includes("CONVERT_TZ(")) hits.push(at(m.index));
    }
  }
  return hits;
}

describe("invoiceDate is read as the stored shop-local day", () => {
  it("no server reader converts invoiceDate from UTC", () => {
    const files = serverSources(SERVER).map((f) => ({ file: path.relative(SERVER, f), text: readFileSync(f, "utf8") }));
    // The instrument saw the tree: the server has hundreds of sources and the readers that agree.
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.file === path.join("routes", "nour-os-query.ts"))).toBe(true);
    expect(findUtcConversions(files)).toEqual([]);
  });

  it("the scan catches the shapes that were in the tree, with and without an alias", () => {
    const planted = [
      { file: "a.ts", text: "WHERE DATE(CONVERT_TZ(invoiceDate, '+00:00', 'America/New_York')) = x" },
      { file: "b.ts", text: "SELECT DATE(CONVERT_TZ(i.invoiceDate,\n '+00:00', 'America/New_York'))" },
      { file: "c.ts", text: "CONVERT_TZ( `invoiceDate` , '+00:00', 'America/New_York')" },
      { file: "d.ts", text: "CONVERT_TZ(createdAt, '+00:00', 'America/New_York') -- a UTC instant is fine" },
      { file: "e.ts", text: "AND invoiceDate >= CONVERT_TZ(${weekStart}, 'America/New_York', '+00:00')" },
      { file: "f.ts", text: "AND createdAt >= CONVERT_TZ(${weekStart}, 'America/New_York', '+00:00')" },
      {
        file: "g.ts",
        text: "const et = (col: string) =>\n  sql.raw(`DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', 'America/New_York'))`);\nSELECT ${et(\"invoiceDate\")} AS at",
      },
      {
        file: "h.ts",
        text: "const raw = (col: string) => sql.raw(`DATE_FORMAT(${col}, '%Y')`);\nconst et = (col: string) =>\n  sql.raw(`CONVERT_TZ(${col}, '+00:00', 'America/New_York')`);\nSELECT ${raw(\"invoiceDate\")}, ${et(\"createdAt\")}",
      },
      { file: "i.ts", text: "function et(c: string) { return `CONVERT_TZ(${c}, '+00:00', 'America/New_York')`; }\n\nx(et('invoiceDate'))" },
    ];
    expect(findUtcConversions(planted)).toEqual(["a.ts:1", "b.ts:1", "c.ts:1", "e.ts:1", "g.ts:3", "i.ts:3"]);
  });
});

/** A writer that stores the UTC clock into a shop-day column: `invoiceDate: new Date()`. */
// approvalDate becomes invoiceDate (snapFinanceSync), so it is a shop-day write too.
const UTC_CLOCK_WRITE = /\b(?:invoiceDate|estimateDate|approvalDate)\s*[:=][^;,\n]*\bnew Date\(\s*\)/g;

function findUtcClockWrites(files: Array<{ file: string; text: string }>): string[] {
  return files.flatMap(({ file, text }) =>
    [...text.matchAll(UTC_CLOCK_WRITE)].map((m) => `${file}:${text.slice(0, m.index).split("\n").length}`),
  );
}

describe("shop-day columns are written as the shop's wall clock", () => {
  // A new Date() stores the UTC clock, so an evening row lands on the next shop day. Writers use
  // shopWallClock() (server/lib/timezoneAssert.ts) so the stored value reads as the shop's local time.
  it("no server writer stores new Date() into invoiceDate or estimateDate", () => {
    const files = serverSources(SERVER).map((f) => ({ file: path.relative(SERVER, f), text: readFileSync(f, "utf8") }));
    expect(files.length).toBeGreaterThan(200);
    expect(findUtcClockWrites(files)).toEqual([]);
  });

  it("the scan catches a planted UTC-clock writer and passes the wall-clock form", () => {
    const planted = [
      { file: "w.ts", text: "await db.insert(invoices).values({ invoiceDate: new Date(), paymentStatus: 'paid' })" },
      { file: "x.ts", text: "values({ invoiceDate: shopWallClock(), estimateDate: input.when })" },
      { file: "y.ts", text: "values({\n  estimateDate: new Date() })" },
      { file: "z.ts", text: "estimateDate: dateCell ? new Date(dateCell) : new Date()," },
      { file: "v.ts", text: "const estimateDate = Number.isNaN(p.getTime()) ? new Date() : p;" },
    ];
    expect(findUtcClockWrites(planted)).toEqual(["w.ts:1", "y.ts:2", "z.ts:1", "v.ts:1"]);
  });
});

/**
 * An invoice insert whose object literal does not name invoiceDate. The column's database default is the
 * UTC clock, so such a row lands on the UTC day (the ShopDriver inserts did this until 2026-10-14).
 */
const INVOICE_INSERT = /\.insert\(\s*(?:invoices|invoicesTable)\s*\)\s*\.values\(\s*\{/g;

/** The object literal opened at `open`, matched by brace depth (a `})` inside a template string is not its end). */
function literalAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open, open + 1000);
}

function findInvoiceInsertsWithoutDate(files: Array<{ file: string; text: string }>): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) {
    for (const m of text.matchAll(INVOICE_INSERT)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      if (!/\binvoiceDate\b/.test(literalAt(text, open))) hits.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
    }
  }
  return hits;
}

describe("every invoice insert names its date", () => {
  it("no server insert into invoices leaves invoiceDate to the UTC database default", () => {
    const files = serverSources(SERVER).map((f) => ({ file: path.relative(SERVER, f), text: readFileSync(f, "utf8") }));
    expect(findInvoiceInsertsWithoutDate(files)).toEqual([]);
  });

  it("the scan catches a planted insert that omits the date, and passes one that names it", () => {
    const planted = [
      { file: "a.ts", text: "await d.insert(invoices).values({\n  invoiceNumber,\n  totalAmount: 1,\n});" },
      { file: "b.ts", text: "await d.insert(invoices).values({ invoiceNumber, invoiceDate: shopWallClock() });" },
    ];
    expect(findInvoiceInsertsWithoutDate(planted)).toEqual(["a.ts:1"]);
  });
});
