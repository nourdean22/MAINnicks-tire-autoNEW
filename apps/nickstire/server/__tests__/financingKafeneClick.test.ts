/**
 * Kafene "Apply" clicks (2026-10-18). Kafene was added to shared/financing.ts, but the click
 * tracker's zod enums and the financing_clicks.provider ENUM did not know it, so every Kafene
 * click was rejected server-side.
 *
 * Pins:
 *   1. every FINANCING_PROVIDERS id passes both procedures' input validation and is a member of
 *      the schema ENUM, so the next provider cannot repeat this;
 *   2. until drizzle/0147 is applied in prod, STRICT_TRANS_TABLES rejects a 'kafene' row: the
 *      click still resolves for the customer and the warn names the provider;
 *   3. 0147 APPENDS 'kafene' (append-only, like 0146), the journal lists it, and the admin
 *      Run-Migrations list re-asserts it (migrationListGuards.test.ts pins that copy to schema.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  logLines: [] as string[],
  insertValues: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  createLogger: (module: string) => {
    const rec = (level: string) => (msg: string, ...args: unknown[]) => {
      h.logLines.push(`${level} ${module} ${msg} ${JSON.stringify(args)}`);
    };
    return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
  },
}));
vi.mock("../services/activityLedger", () => ({
  withActivityLedger: (opts: { next: () => unknown }) => opts.next(),
}));
vi.mock("../sheets-sync", () => ({ syncFinancingToSheet: vi.fn(async () => true) }));
vi.mock("../db", () => ({ getDb: h.getDb }));

import { financingRouter } from "../routers/financing";
import { financingClicks } from "../../drizzle/schema";
import { FINANCING_PROVIDERS } from "../../shared/financing";

const caller = () => financingRouter.createCaller({} as TrpcContext);
type Parser = { safeParse: (v: unknown) => { success: boolean } };
const inputOf = (name: "trackApplication" | "logApplication") =>
  (financingRouter._def.procedures[name] as unknown as { _def: { inputs: Parser[] } })._def.inputs[0];

const BEFORE = ["acima", "snap", "koalafi", "american-first"] as const;
const SQL_PATH = join(__dirname, "../../drizzle/0147_financing_clicks_kafene.sql");

beforeEach(() => {
  h.logLines.length = 0;
  h.insertValues.mockReset();
  h.getDb.mockReset().mockResolvedValue({ insert: () => ({ values: h.insertValues }) });
});

describe("every payment-programs provider can be clicked and logged", () => {
  it("each FINANCING_PROVIDERS id passes trackApplication and logApplication validation", () => {
    for (const { id } of FINANCING_PROVIDERS) {
      expect(inputOf("trackApplication").safeParse({ provider: id }).success, `trackApplication rejects ${id}`).toBe(true);
      expect(
        inputOf("logApplication").safeParse({ provider: id, customerName: "A", customerPhone: "1" }).success,
        `logApplication rejects ${id}`,
      ).toBe(true);
    }
  });

  it("negative control: an unknown provider is still rejected", () => {
    expect(inputOf("trackApplication").safeParse({ provider: "paypal" }).success).toBe(false);
  });

  it("each FINANCING_PROVIDERS id is a member of the financing_clicks.provider ENUM", () => {
    const members = financingClicks.provider.enumValues as readonly string[];
    for (const { id } of FINANCING_PROVIDERS) expect(members, `schema ENUM lacks ${id}`).toContain(id);
  });

  it("the schema ENUM is the old list with 'kafene' appended (never reordered)", () => {
    expect([...financingClicks.provider.enumValues]).toEqual([...BEFORE, "kafene"]);
  });
});

describe("a Kafene click before 0147 is applied", () => {
  it("resolves for the customer with Kafene's link when the row is rejected, and the warn names the provider", async () => {
    h.insertValues.mockRejectedValue(new Error("Data truncated for column 'provider' at row 1"));
    const res = await caller().trackApplication({ provider: "kafene", sourcePage: "/financing" });
    expect(res).toMatchObject({ success: true, provider: "Kafene", applyUrl: "https://gokafene.com/nKVEWWv" });
    expect(h.insertValues).toHaveBeenCalledTimes(1); // positive control: the insert was attempted
    const warn = h.logLines.find((l) => l.startsWith("warn") && l.includes("persist failed"));
    expect(warn).toBeDefined();
    expect(warn).toContain('"provider":"kafene"');
  });

  it("a stored click still resolves the same way (the happy path is unchanged)", async () => {
    h.insertValues.mockResolvedValue(undefined);
    const res = await caller().trackApplication({ provider: "kafene", sourcePage: "/financing" });
    expect(res).toMatchObject({ success: true, provider: "Kafene" });
    expect(h.insertValues.mock.calls[0][0]).toMatchObject({ provider: "kafene", sourcePage: "/financing" });
  });
});

describe("0147 · 'kafene' is appended, never inserted", () => {
  // A missing file is a finding for the first `it`, not a crash that hides every other pin.
  const sql = existsSync(SQL_PATH) ? readFileSync(SQL_PATH, "utf8") : "";
  const m = /ALTER TABLE financing_clicks\s+MODIFY COLUMN provider ENUM\(([^)]*)\)\s+NOT NULL;/i.exec(sql);

  it("alters financing_clicks.provider to the previous list + 'kafene', NOT NULL as in 0080", () => {
    expect(m, "0147 alters financing_clicks.provider").not.toBeNull();
    const list = m![1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(list).toEqual([...BEFORE, "kafene"]);
  });

  it("the header names its own migration number and the journal lists it", () => {
    expect(sql.split("\n")[0]).toMatch(/^-- 0147 /);
    const journal = JSON.parse(readFileSync(join(__dirname, "../../drizzle/meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((e) => e.tag)).toContain("0147_financing_clicks_kafene");
  });

  it("the admin Run-Migrations list re-asserts the same ENUM (one tap applies it)", () => {
    const src = readFileSync(join(__dirname, "../routers/nick/intelligence.ts"), "utf8");
    expect(src).toContain(
      "ALTER TABLE financing_clicks MODIFY COLUMN provider ENUM('acima','snap','koalafi','american-first','kafene') NOT NULL",
    );
  });
});
