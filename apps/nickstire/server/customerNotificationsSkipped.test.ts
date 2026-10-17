/**
 * Follow-up Cancel writes a status the table allows (2026-10-16).
 *
 * followUpsRouter.cancel has set `status: "skipped"` on customer_notifications
 * since wave-115, and no migration ever added 'skipped' to that ENUM. TiDB runs
 * STRICT_TRANS_TABLES, so production answered every Cancel tap with
 * `Data truncated for column 'status'` (Sentry NICKSTIRE-D, 8 events since
 * 2026-10-09). tsc never saw it because the router read the DB through the
 * untyped `db()` helper (an `any`), so the enum type never reached `.set()`.
 *
 * Three pins, so the class cannot return:
 *   1. every status literal the server writes to customer_notifications is a
 *      member of the schema ENUM (source scan over the real writers);
 *   2. drizzle/0146 APPENDS 'skipped' (append-only, like 0136) and schema.ts
 *      carries the same list; the admin Run-Migrations list re-asserts it and
 *      migrationListGuards.test.ts pins that copy to schema.ts;
 *   3. the router reads through dbTyped(), so the compiler owns this from now on.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { customerNotifications } from "../drizzle/schema";

const SERVER = join(__dirname);
const SQL_PATH = join(__dirname, "../drizzle/0146_customer_notifications_skipped.sql");

// The live list before 0146 (schema.ts at 5e77a7836).
const BEFORE = ["pending", "sent", "failed"] as const;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** Every `status: "<literal>"` inside an update/insert that targets customerNotifications. */
function statusLiteralsWritten(): Array<{ file: string; value: string }> {
  const hits: Array<{ file: string; value: string }> = [];
  for (const file of walk(SERVER)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("customerNotifications")) continue;
    const re = /\.(?:update|insert)\(customerNotifications\)[\s\S]{0,400}?status:\s*"([a-z_]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) hits.push({ file: file.replace(/\\/g, "/"), value: m[1] });
  }
  return hits;
}

describe("customer_notifications.status · every written value is a member of the ENUM", () => {
  const written = statusLiteralsWritten();

  it("canary: the scan sees the Cancel writer (an empty scan would pass vacuously)", () => {
    expect(written.some((h) => h.file.endsWith("routers/admin/followUps.ts") && h.value === "skipped")).toBe(true);
    expect(written.length).toBeGreaterThanOrEqual(3); // skipped + sent + failed
  });

  it("each literal is in customerNotifications.status.enumValues", () => {
    const allowed = new Set<string>(customerNotifications.status.enumValues);
    const bad = written.filter((h) => !allowed.has(h.value)).map((h) => `${h.file}: "${h.value}"`);
    expect(bad, "status written that the ENUM rejects (STRICT_TRANS_TABLES loses the row)").toEqual([]);
  });
});

describe("0146 · 'skipped' is appended, never inserted", () => {
  // A missing file is a finding for the first `it`, not a crash that hides every other pin.
  const sql = existsSync(SQL_PATH) ? readFileSync(SQL_PATH, "utf8") : "";
  const m = /ALTER TABLE customer_notifications\s+MODIFY COLUMN status ENUM\(([^)]*)\)/i.exec(sql);

  it("alters customer_notifications.status to previous list + 'skipped'", () => {
    expect(m, "0146 alters customer_notifications.status").not.toBeNull();
    const list = m![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(list).toEqual([...BEFORE, "skipped"]);
  });

  it("schema.ts matches the SQL", () => {
    expect(customerNotifications.status.enumValues).toEqual([...BEFORE, "skipped"]);
  });

  it("the header names its own migration number and the journal lists it", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- 0146 /);
    const journal = JSON.parse(readFileSync(join(__dirname, "../drizzle/meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((e) => e.tag)).toContain("0146_customer_notifications_skipped");
  });

  it("the admin Run-Migrations list re-asserts the same ENUM (one tap applies it)", () => {
    const src = readFileSync(join(__dirname, "routers/nick/intelligence.ts"), "utf8");
    expect(src).toContain(
      "ALTER TABLE customer_notifications MODIFY COLUMN status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending'",
    );
  });
});

describe("the type leak is closed", () => {
  it("followUps.ts reads the DB through dbTyped(), so .set() is checked against the ENUM", () => {
    const src = readFileSync(join(__dirname, "routers/admin/followUps.ts"), "utf8");
    expect(src).toMatch(/import \{ dbTyped \} from "\.\.\/\.\.\/lib\/db-helper"/);
    expect(src).not.toMatch(/\bawait db\(\)/);
  });
});
