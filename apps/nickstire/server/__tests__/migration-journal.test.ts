/**
 * Migration-journal drift guard (2026-07-11).
 *
 * scripts/db-migrate.ts applies ONLY what drizzle/meta/_journal.json
 * lists — a .sql file that isn't journaled is silently invisible to
 * every fresh environment. That drift reached 34/90 files (including
 * sms_preferences_optout, the durable TCPA opt-out table) before the
 * 2026-07-11 reconciliation. This test makes the failure loud forever.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");

function journalTags(): string[] {
  const j = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
  return j.entries.map((e: { tag: string }) => e.tag);
}

function sqlFiles(): string[] {
  return readdirSync(join(ROOT, "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4));
}

describe("drizzle migration journal", () => {
  it("journals every drizzle/*.sql file (no invisible migrations)", () => {
    const tags = new Set(journalTags());
    const missing = sqlFiles().filter((f) => !tags.has(f));
    expect(missing, `unjournaled migrations (fresh envs will SKIP these — add to _journal.json): ${missing.join(", ")}`).toEqual([]);
  });

  it("has no journal entries pointing at deleted files", () => {
    const files = new Set(sqlFiles());
    const phantom = journalTags().filter((t) => !files.has(t));
    expect(phantom, `journal entries with no .sql file: ${phantom.join(", ")}`).toEqual([]);
  });

  it("keeps idx strictly sequential (drizzle-kit reads it to name the next migration)", () => {
    const j = JSON.parse(readFileSync(join(ROOT, "drizzle", "meta", "_journal.json"), "utf8"));
    const idxs = j.entries.map((e: { idx: number }) => e.idx);
    expect(idxs).toEqual(idxs.map((_: number, i: number) => i));
  });
});
