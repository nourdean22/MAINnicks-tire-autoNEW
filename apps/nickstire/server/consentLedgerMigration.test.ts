import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const sql = readFileSync(join(ROOT, "drizzle", "0133_contact_consent_events.sql"), "utf8");
const schema = readFileSync(join(ROOT, "drizzle", "schema.ts"), "utf8");
const journal = JSON.parse(
  readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ tag: string }> };

describe("Q-43 consent ledger migration contract", () => {
  it("is additive and idempotent", () => {
    const executableSql = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executableSql).toMatch(/CREATE TABLE IF NOT EXISTS contact_consent_events/i);
    expect(executableSql).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER)\b/i);
  });

  it("uses subject-leading idempotency so email+phone evidence cannot collide", () => {
    expect(sql).toContain("subject_type, subject_key, source, evidence_ref, scope, action");
  });

  it("keeps consent values as VARCHAR rather than lossy ENUMs", () => {
    expect(sql).not.toMatch(/\bENUM\s*\(/i);
    expect(schema).toContain('mysqlTable("contact_consent_events"');
  });

  it("is registered as 0133 in the migration journal", () => {
    expect(journal.entries.some((entry) => entry.tag === "0133_contact_consent_events")).toBe(true);
  });
});
