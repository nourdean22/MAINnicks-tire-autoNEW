/**
 * Q-12 phase 1b · migration 0137 (bridge_outbox) matches ADR-0019 §5.1 and
 * schema.ts, and db-migrate.ts can find it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { bridgeOutbox } from "../drizzle/schema";

const ROOT = join(import.meta.dirname, "..");
const sql = readFileSync(join(ROOT, "drizzle", "0137_bridge_outbox.sql"), "utf8");
const executable = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const journal = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

describe("0137 bridge_outbox migration", () => {
  it("is additive and idempotent", () => {
    expect(executable).toMatch(/CREATE TABLE IF NOT EXISTS bridge_outbox/i);
    expect(executable).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER|DELETE|UPDATE)\b/i);
  });

  it("keeps status a VARCHAR, never an ENUM (a lossy write would drop the failure handler's own row)", () => {
    expect(executable).not.toMatch(/\bENUM\s*\(/i);
    expect(executable).toMatch(/status\s+VARCHAR\(32\)/i);
  });

  it("dedupes on the idempotency key", () => {
    expect(executable).toMatch(/UNIQUE KEY uniq_bridge_outbox_key \(idempotency_key\)/);
  });

  it("declares exactly the columns schema.ts writes", () => {
    const sqlCols = [...executable.matchAll(/^\s{2}([a-z_]+)\s+(?:BIGINT|VARCHAR|JSON|TIMESTAMP|INT)\b/gm)].map((m) => m[1]).sort();
    const schemaCols = getTableConfig(bridgeOutbox).columns.map((c) => c.name).sort();
    expect(sqlCols).toEqual(schemaCols);
  });

  it("is registered after 0136 in the journal, so db-migrate.ts applies it in order", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0137_bridge_outbox");
    expect(tags.indexOf("0137_bridge_outbox")).toBe(tags.indexOf("0136_contact_experiment_assignments") + 1);
  });
});
