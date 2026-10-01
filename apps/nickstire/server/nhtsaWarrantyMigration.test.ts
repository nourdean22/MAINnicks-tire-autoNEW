/**
 * Q-50 phase 2a · migration 0138 matches ADR-0021 §5 and schema.ts, and db-migrate.ts
 * can find it. The store's natural-key upserts are pinned in
 * services/nhtsaWarrantyIngest.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { nhtsaMfrWarrantyComms, nhtsaMfrWarrantyProducts } from "../drizzle/schema";

const ROOT = join(import.meta.dirname, "..");
const sql = readFileSync(join(ROOT, "drizzle", "0138_nhtsa_mfr_warranty.sql"), "utf8");
const executable = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const journal = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

function tableBlock(name: string): string {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\);`).exec(executable);
  if (!m) throw new Error(`no CREATE TABLE for ${name}`);
  return m[1];
}
const columnsOf = (block: string) =>
  [...block.matchAll(/^\s{2}([a-z_]+)\s+(?:BIGINT|VARCHAR|TEXT|DATE|TIMESTAMP|SMALLINT)\b/gm)].map((m) => m[1]).sort();

describe("0138 nhtsa_mfr_warranty migration", () => {
  it("is additive and idempotent", () => {
    expect(executable.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    expect(executable).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER|DELETE|UPDATE|INSERT)\b/i);
  });

  it("uses VARCHAR, never ENUM, and never the reserved word SIGNAL as a bare column", () => {
    expect(executable).not.toMatch(/\bENUM\s*\(/i);
    expect(executable).toMatch(/match_signal\s+VARCHAR\(32\)/);
    expect(executable).not.toMatch(/^\s+signal\s/m);
  });

  it("declares exactly the columns schema.ts maps, for both tables", () => {
    expect(columnsOf(tableBlock("nhtsa_mfr_warranty_comms"))).toEqual(getTableConfig(nhtsaMfrWarrantyComms).columns.map((c) => c.name).sort());
    expect(columnsOf(tableBlock("nhtsa_mfr_warranty_products"))).toEqual(getTableConfig(nhtsaMfrWarrantyProducts).columns.map((c) => c.name).sort());
  });

  it("keys products on (communication, make, model, year) and indexes the year/make/model read", () => {
    expect(tableBlock("nhtsa_mfr_warranty_products")).toMatch(/PRIMARY KEY \(nhtsa_id, make_norm, model_norm, model_year\)/);
    expect(tableBlock("nhtsa_mfr_warranty_products")).toMatch(/KEY idx_nhtsa_products_ymm \(make_norm, model_year, model_norm\)/);
    expect(tableBlock("nhtsa_mfr_warranty_comms")).toMatch(/nhtsa_id\s+BIGINT\s+NOT NULL PRIMARY KEY/);
  });

  it("is registered right after 0137 in the journal, so db-migrate.ts applies it in order", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags.indexOf("0138_nhtsa_mfr_warranty")).toBe(tags.indexOf("0137_bridge_outbox") + 1);
  });
});
