/**
 * Every feature-flag key must fit audit_log.entity_id (0152).
 *
 * featureFlags.toggle audits with entityId = the flag key. entity_id was varchar(36) and
 * web_experiment_home_hero_subline_2026_09 is 40 characters, so under strict mode its toggle audit insert was
 * rejected and logAdminAction swallowed the miss: that flag could be flipped with no who/when on record, and the
 * Settings tab's "last changed by" could never show it. The width is read from schema.ts, so a longer key added
 * later fails here instead of silently skipping its audit row.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Real schema and definitions: another file's mock must not leak in (AGENTS.md section 3).
vi.unmock("../drizzle/schema");
vi.unmock("./services/featureFlags");

import { auditLog } from "../drizzle/schema";
import { FLAG_DEFINITIONS } from "./services/featureFlags";

const declaredWidth = (auditLog.entityId as unknown as { length: number }).length;

/** The keys that would be rejected at this width. */
const tooLong = (keys: readonly string[], width: number) => keys.filter((k) => k.length > width);

describe("audit_log.entity_id holds every flag key", () => {
  it("every FLAG_DEFINITIONS key fits the declared column width", () => {
    const keys = FLAG_DEFINITIONS.map((f) => f.key as string);
    expect(keys.length).toBeGreaterThan(70); // the scan located its subject
    expect(tooLong(keys, declaredWidth)).toEqual([]);
  });

  it("positive control: the check itself fails for a key one character over the width, and passes at the width", () => {
    expect(tooLong(["a".repeat(declaredWidth + 1)], declaredWidth)).toHaveLength(1);
    expect(tooLong(["a".repeat(101)], 100)).toHaveLength(1);
    expect(tooLong(["a".repeat(declaredWidth)], declaredWidth)).toEqual([]);
    // The known offender: 40 characters does not fit the old 36.
    expect("web_experiment_home_hero_subline_2026_09".length).toBe(40);
    expect(tooLong(["web_experiment_home_hero_subline_2026_09"], 36)).toHaveLength(1);
  });

  it("the migration file, the journal and the Run Migrations list all carry the width schema.ts declares", () => {
    const here = path.resolve(__dirname, "..");
    const sql = readFileSync(path.join(here, "drizzle/0152_audit_log_entity_id_100.sql"), "utf8");
    const stmt = `ALTER TABLE audit_log MODIFY COLUMN entity_id VARCHAR(${declaredWidth}) NULL`;
    expect(sql).toContain(stmt);
    const journal = JSON.parse(readFileSync(path.join(here, "drizzle/meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some((e) => e.tag === "0152_audit_log_entity_id_100")).toBe(true);
    const runner = readFileSync(path.join(here, "server/routers/nick/intelligence.ts"), "utf8");
    expect(runner).toContain(`\`${stmt}\``);
  });
});
