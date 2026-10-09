/**
 * `invoices.invoiceDate` is the stored shop-local day, never a UTC instant to convert.
 *
 * ALG tickets arrive date-only and are stored at that day's 00:00:00 (shopDriverMirror
 * `new Date(ri.date)` on a UTC server); timed tickets are stored as the shop's wall clock. The
 * readers that agree (revenue_range, lot_brief, shopSales, customerStatsRead and every
 * `DATE(invoiceDate)`) compare it with the shop's date as stored. Five readers converted it
 * FROM UTC instead (revenue_today, both cars_today invoice reads, the scheduler's weekday
 * volume check, and kpi-snapshot's week bounds), which moved every date-only ticket onto the
 * day before: today's revenue
 * counted only timed tickets and the volume check saw a near-empty today (found 2026-10-09;
 * Codex had found the same shift in lot_brief on #2931).
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

function findUtcConversions(files: Array<{ file: string; text: string }>): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) {
    for (const re of [UTC_CONVERSION, UTC_BOUND]) {
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split("\n").length;
        hits.push(`${file}:${line}`);
      }
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
    ];
    expect(findUtcConversions(planted)).toEqual(["a.ts:1", "b.ts:1", "c.ts:1", "e.ts:1"]);
  });
});
