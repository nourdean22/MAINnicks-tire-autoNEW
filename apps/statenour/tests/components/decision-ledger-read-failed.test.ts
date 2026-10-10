/**
 * /intelligence/ledger: a failed read is not an empty queue (audit 2026-10-10
 * · 02-F13).
 *
 * THE DEFECT. The page read `payload?.status === "success" ? rows : []`, so a
 * 500 (apiHandler's `{ ok: false, error }` envelope) rendered "No pending
 * Opportunities · All opportunities have been processed." about a queue it
 * never read.
 *
 * The page loads in an effect, which a static render never runs (vitest is
 * node-only here), and a Next page file may not export helpers (Next rejects
 * unknown page exports at build). So this test lifts `readLedger` out of the
 * page source, transpiles it with the repo's own TypeScript, and runs the real
 * function. If the helper is renamed or removed, the slice is empty and the
 * subject check below fails loudly rather than passing vacuously.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

type Read = { opportunities: unknown[] } | { error: string };

function loadReadLedger(): (httpOk: boolean, body: unknown) => Read {
  const src = readFileSync("app/(mastery)/intelligence/ledger/page.tsx", "utf8");
  const start = src.indexOf("function readLedger(");
  const end = src.indexOf("\n}\n", start);
  if (start < 0 || end < 0) throw new Error("readLedger not found in the ledger page: the test has no subject");
  const js = ts.transpileModule(src.slice(start, end + 2), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(`${js}\nreturn readLedger;`)() as (httpOk: boolean, body: unknown) => Read;
}

const readLedger = loadReadLedger();
const row = { id: "o1", status: "pending" };

describe("readLedger · unknown is not an empty queue", () => {
  it("an apiHandler error envelope is an error with its reason", () => {
    expect(readLedger(false, { ok: false, error: "Unexpected server error." })).toEqual({
      error: "Unexpected server error.",
    });
  });

  it("a 200 without status 'success' is an error, not zero rows", () => {
    expect("error" in readLedger(true, { ok: true, data: { status: "partial" } })).toBe(true);
  });

  it("an unparseable body (null) is an error", () => {
    expect("error" in readLedger(false, null)).toBe(true);
  });

  it("POSITIVE CONTROL: the enveloped success shape yields the rows", () => {
    expect(readLedger(true, { ok: true, data: { status: "success", opportunities: [row] } })).toEqual({
      opportunities: [row],
    });
  });

  it("POSITIVE CONTROL: a successful read with no rows is a real empty list", () => {
    expect(readLedger(true, { ok: true, data: { status: "success", opportunities: [] } })).toEqual({
      opportunities: [],
    });
  });
});
