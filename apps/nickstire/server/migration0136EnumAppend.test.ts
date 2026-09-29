/**
 * Q-21 review P1-4 · 0136 must APPEND 'heldout' to each status ENUM.
 *
 * The first cut inserted it mid-list. That breaks the repo's append-only enum
 * rule (0082, 0097): existing members change ordinal, so TiDB rewrites all
 * three tables instead of a metadata-only change — and if TiDB refuses it
 * (error 8200, tolerated by migration-tolerance.ts), 0136 is recorded as
 * applied while the enums are unchanged, and every 'heldout' write is then
 * rejected under STRICT_TRANS_TABLES.
 *
 * Each list must equal the pre-0136 list + 'heldout' at the end, in both the
 * SQL and schema.ts (which drizzle uses to type the writes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reviewRequests, smsCampaignSends, winbackSends } from "../drizzle/schema";

const sql = readFileSync(join(__dirname, "../drizzle/0136_contact_experiment_assignments.sql"), "utf8");

// The live lists before 0136 (schema.ts at d192ccc95^).
const BEFORE = {
  winback_sends: ["pending", "sent", "failed"],
  sms_campaign_sends: ["pending", "sent", "failed"],
  review_requests: ["pending", "sent", "clicked", "failed", "skipped"],
} as const;

function sqlEnum(table: string): string[] {
  const m = new RegExp(`ALTER TABLE ${table}\\s+MODIFY COLUMN status ENUM\\(([^)]*)\\)`, "i").exec(sql);
  expect(m, `0136 alters ${table}.status`).not.toBeNull();
  return m![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

describe("0136 · 'heldout' is appended, never inserted", () => {
  it.each(Object.entries(BEFORE))("%s: SQL list = previous list + 'heldout'", (table, before) => {
    expect(sqlEnum(table)).toEqual([...before, "heldout"]);
  });

  it("schema.ts matches the SQL for all three tables", () => {
    expect(winbackSends.status.enumValues).toEqual(sqlEnum("winback_sends"));
    expect(smsCampaignSends.status.enumValues).toEqual(sqlEnum("sms_campaign_sends"));
    expect(reviewRequests.status.enumValues).toEqual(sqlEnum("review_requests"));
  });

  it("the header names its own migration number", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- 0136 /);
  });
});
