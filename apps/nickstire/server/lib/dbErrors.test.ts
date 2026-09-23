/**
 * isDuplicateKeyError · one definition of "the unique index rejected this" (2026-09-22)
 *
 * WHY. Four call sites carried their own copy — proposals.ts, shopDriverMirror.ts
 * (twice), promiseLedger.ts — each a slightly different regex. The proposals copy
 * tested /duplicate/i, which also matches "Duplicate column name" (a DDL error)
 * and any message that happens to contain the word, so a genuine failure could
 * be re-read as "someone else already did this". All four import the shared
 * helper now; this suite pins what it answers and, comment-stripped, that they
 * actually call it.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DrizzleQueryError } from "drizzle-orm";
import { isDuplicateKeyError } from "./dbErrors";
import { isMissingTableError } from "../db";

// This file needs the REAL db module (serial mode shares one mock registry).
vi.unmock("../db");

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("isDuplicateKeyError", () => {
  it("recognises the driver code, the errno and the message text", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY", message: "x" })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062, message: "x" })).toBe(true);
    expect(isDuplicateKeyError(new Error("Duplicate entry '+12165550142' for key 'uq_promise_source'"))).toBe(true);
    expect(isDuplicateKeyError(new Error("ER_DUP_ENTRY: something"))).toBe(true);
  });

  it("does NOT mistake other errors for a duplicate key — including the one the old /duplicate/i copy matched", () => {
    expect(isDuplicateKeyError(new Error("Duplicate column name 'phone2'"))).toBe(false);
    expect(isDuplicateKeyError(new Error("ER_NO_SUCH_TABLE: estimates"))).toBe(false);
    expect(isDuplicateKeyError(new Error("Connection lost: The server closed the connection."))).toBe(false);
    expect(isDuplicateKeyError({ code: "ECONNRESET" })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError(undefined)).toBe(false);
    expect(isDuplicateKeyError("plain string, no key")).toBe(false);
  });

  it("the four call sites use it and carry no private copy (comment-stripped)", () => {
    const files = ["../services/proposals.ts", "../services/shopDriverMirror.ts", "../services/promiseLedger.ts"];
    for (const f of files) {
      const src = stripComments(readFileSync(resolve(__dirname, f), "utf8"));
      expect(src, f).toContain("isDuplicateKeyError(");
      expect(src, f).not.toMatch(/\/Duplicate entry\|ER_DUP_ENTRY\/i/);
      expect(src, f).not.toMatch(/\/duplicate\/i\.test/);
      expect(src, f).not.toMatch(/function isDuplicateKeyError/);
    }
    // shopDriverMirror had TWO copies; both must be gone.
    const mirror = stripComments(readFileSync(resolve(__dirname, "../services/shopDriverMirror.ts"), "utf8"));
    expect(mirror.match(/isDuplicateKeyError\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

/**
 * drizzle-orm (0.45) wraps EVERY driver error, builder queries and
 * db.execute(sql…) alike, in a DrizzleQueryError. Its message is only
 * "Failed query: <sql>\nparams: <params>"; the driver's code, errno and text
 * sit on `.cause`. Both recognisers used to read the top level only, so in
 * production they never saw a real driver error (2026-09-23, task 14).
 * The positive controls below use drizzle's own class, not a look-alike.
 */
function driverError(code: string, errno: number, message: string) {
  return Object.assign(new Error(message), { code, errno, sqlMessage: message });
}
const wrap = (cause: unknown, params: unknown[] = [1]) => new DrizzleQueryError("select `id` from `t` where `x` = ?", params, cause as Error);
const noSuchTable = () => driverError("ER_NO_SUCH_TABLE", 1146, "Table 'nickstire.candidates' doesn't exist");
const dupEntry = () => driverError("ER_DUP_ENTRY", 1062, "Duplicate entry 'voice-call_x' for key 'uq_promise_source'");
const timeout = () => Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });

describe("isMissingTableError sees through drizzle's wrapper", () => {
  it("recognises a drizzle-wrapped 1146 — the shape every real query produces", () => {
    const wrapped = wrap(noSuchTable());
    expect((wrapped as { code?: unknown }).code).toBeUndefined(); // the wrapper carries no code
    expect(isMissingTableError(wrapped)).toBe(true);
  });

  it("still recognises a bare driver error by code, errno or its own text", () => {
    expect(isMissingTableError({ code: "ER_NO_SUCH_TABLE" })).toBe(true);
    expect(isMissingTableError({ errno: 1146 })).toBe(true);
    expect(isMissingTableError(new Error("Table 'nickstire.candidates' doesn't exist"))).toBe(true);
  });

  it("does NOT fire on anything else — those must keep throwing", () => {
    expect(isMissingTableError(wrap(driverError("ER_BAD_FIELD_ERROR", 1054, "Unknown column 'intent' in 'field list'")))).toBe(false);
    expect(isMissingTableError(wrap(timeout()))).toBe(false);
    // The old local copies regexed the wrapper text for "1146": a failed query
    // whose params held a phone ending in 1146 read as "table missing" and
    // silently degraded to an empty result.
    expect(isMissingTableError(wrap(timeout(), ["2165551146"]))).toBe(false);
    expect(isMissingTableError(new Error("Unknown database 'nickstire'"))).toBe(false);
    expect(isMissingTableError(driverError("ER_BAD_TABLE_ERROR", 1051, "Unknown table 'nickstire.t'"))).toBe(false);
    expect(isMissingTableError(new Error("plain failure"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
  });
});

describe("isDuplicateKeyError sees through drizzle's wrapper", () => {
  it("recognises a drizzle-wrapped ER_DUP_ENTRY (promiseLedger's race dedupe depends on it)", () => {
    expect(isDuplicateKeyError(wrap(dupEntry()))).toBe(true);
  });

  it("does NOT read a 1062 in the wrapper's params as a duplicate", () => {
    expect(isDuplicateKeyError(wrap(timeout(), [1062]))).toBe(false);
    expect(isDuplicateKeyError(wrap(noSuchTable()))).toBe(false);
  });
});

describe("one definition: no private copy of isMissingTableError remains (comment-stripped)", () => {
  it("the four services that carried their own copy import the shared one", () => {
    for (const f of ["../services/opportunityQueue.ts", "../services/promiseLedger.ts", "../services/smsResponseJobs.ts", "../services/vapiCallArchive.ts", "../db.ts"]) {
      const src = stripComments(readFileSync(resolve(__dirname, f), "utf8"));
      expect(src, f).not.toMatch(/function isMissingTableError/);
      expect(src, f).toContain("isMissingTableError");
    }
  });
});
