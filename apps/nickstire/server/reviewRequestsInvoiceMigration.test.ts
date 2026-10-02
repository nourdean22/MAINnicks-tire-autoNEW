/**
 * Migration 0139 (review_requests invoice source) and drizzle/schema.ts describe the same
 * table. 0139 was applied and recorded in production on 2026-10-02 (reconcile-migrations
 * --strict exit 0) and `invoiceId` was declared in schema.ts only after that. If either side
 * drifts — a renamed column, a dropped UNIQUE, bookingId made NOT NULL again — the invoice
 * review lane writes rows the schema cannot read, or a projection-less
 * select().from(reviewRequests) names a column the database lacks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { describe, expect, it } from "vitest";
import { reviewRequests } from "../drizzle/schema";

const ROOT = join(import.meta.dirname, "..");
const sql = readFileSync(join(ROOT, "drizzle", "0139_review_requests_invoice_source.sql"), "utf8");
const executable = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
const config = getTableConfig(reviewRequests);
const column = (name: string) => config.columns.find((c) => c.name === name);

describe("0139 review_requests invoice source ↔ schema.ts", () => {
  it("0139 adds a nullable invoiceId with a UNIQUE index and makes bookingId nullable", () => {
    expect(executable).toMatch(/ADD COLUMN IF NOT EXISTS `invoiceId` int NULL/);
    expect(executable).toMatch(/CREATE UNIQUE INDEX `uq_review_requests_invoice` ON `review_requests` \(`invoiceId`\)/);
    expect(executable).toMatch(/MODIFY COLUMN `bookingId` int NULL/);
  });

  it("schema.ts declares invoiceId as a nullable int", () => {
    const invoiceId = column("invoiceId");
    expect(invoiceId, "invoiceId must be declared").toBeDefined();
    expect(invoiceId?.getSQLType()).toBe("int");
    expect(invoiceId?.notNull).toBe(false);
  });

  it("schema.ts carries the same UNIQUE index name, on invoiceId only", () => {
    const idx = config.indexes.find((i) => i.config.name === "uq_review_requests_invoice");
    expect(idx, "uq_review_requests_invoice must be declared").toBeDefined();
    expect(idx?.config.unique).toBe(true);
    expect(idx?.config.columns.map((c) => ("name" in c ? c.name : String(c)))).toEqual(["invoiceId"]);
  });

  it("schema.ts keeps bookingId nullable (an invoice-sourced row has no booking)", () => {
    expect(column("bookingId")?.notNull).toBe(false);
  });
});
