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
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDuplicateKeyError } from "./dbErrors";

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
