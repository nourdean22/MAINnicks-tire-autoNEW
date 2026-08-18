/**
 * tests/ai/catalog-claims.test.ts · GATE #6 — tool metadata becomes a
 * VERIFIED claim.
 *
 * Two halves: fixture units proving each rule catches its failure
 * shape, and THE LIVE ASSERTION — zero violations across the real
 * catalog and the real reasoning whitelist. The live half is the gate:
 * from now on, mislabeling a tool or slipping a mutating tool into the
 * reasoning whitelist fails `pnpm test` (which verify:hard runs)
 * instead of shipping.
 */

import { describe, expect, it } from "vitest";
import { verifyCatalogClaims } from "@/lib/ai/tools/catalog-claims";
import { TOOL_CATALOG, type ToolMeta } from "@/lib/ai/tools/catalog";
import { REASONING_TOOL_WHITELIST_ENTRIES } from "@/lib/ai/reasoning/whitelist";

const meta = (over: Partial<ToolMeta> & { name: string }): ToolMeta => ({
  category: "business_read",
  ...over,
});

describe("verifyCatalogClaims · each rule catches its failure shape", () => {
  it("W1 · a whitelist entry missing from the catalog is a silent vanish", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "getRevenueStats" })],
      reasoningWhitelist: ["getRevenueStats", "getGhostTool"],
    });
    expect(r.violations).toEqual([
      expect.objectContaining({ rule: "W1", tool: "getGhostTool" }),
    ]);
  });

  it("W2 · a sideEffecting tool inside the read-only whitelist is caught", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "sendSms", category: "comms", sideEffecting: true })],
      reasoningWhitelist: ["sendSms"],
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["W2"]);
  });

  it("B1 · battle + sideEffecting together is a self-contradiction", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "weird", battle: true, sideEffecting: true, category: "content" })],
      reasoningWhitelist: [],
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["B1"]);
  });

  it("C1 · a business_write tool without sideEffecting bypasses approval", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "sendQuote", category: "business_write" })],
      reasoningWhitelist: [],
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["C1"]);
  });

  it("C2 · a *_read tool claiming sideEffecting is lying somewhere", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "getStats", category: "business_read", sideEffecting: true })],
      reasoningWhitelist: [],
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["C2"]);
  });

  it("E1 · blank requiredEnv entries are unsatisfiable", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "needsEnv", requiredEnv: ["GOOD_KEY", "  "] })],
      reasoningWhitelist: [],
    });
    expect(r.violations.map((v) => v.rule)).toEqual(["E1"]);
  });

  it("a clean catalog yields zero violations", () => {
    const r = verifyCatalogClaims({
      catalog: [
        meta({ name: "getStats", battle: true }),
        meta({ name: "sendQuote", category: "business_write", sideEffecting: true }),
      ],
      reasoningWhitelist: ["getStats"],
    });
    expect(r.violations).toEqual([]);
    expect(r.checkedTools).toBe(2);
    expect(r.checkedWhitelist).toBe(1);
  });
});

describe("verifyCatalogClaims · exceptions are reviewed decisions, not escape hatches", () => {
  it("a keyed exception suppresses exactly its violation", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "sendQuote", category: "business_write" })],
      reasoningWhitelist: [],
      exceptions: { "C1:sendQuote": "draft-only variant — reviewed 2026-08-18" },
    });
    expect(r.violations).toEqual([]);
    expect(r.unusedExceptions).toEqual([]);
  });

  it("a stale exception is surfaced — silence is how blind spots rot in", () => {
    const r = verifyCatalogClaims({
      catalog: [meta({ name: "fineTool" })],
      reasoningWhitelist: [],
      exceptions: { "C1:deletedTool": "reason long gone" },
    });
    expect(r.unusedExceptions).toEqual(["C1:deletedTool"]);
  });
});

describe("THE LIVE ASSERTION · the real catalog's claims hold", () => {
  it("zero violations across the real catalog + real reasoning whitelist, no exceptions needed", () => {
    const r = verifyCatalogClaims({
      catalog: TOOL_CATALOG,
      reasoningWhitelist: REASONING_TOOL_WHITELIST_ENTRIES,
    });
    // Verbose on failure — every violation printed so the fix is one pass.
    expect(
      r.violations,
      r.violations.map((v) => `[${v.rule}] ${v.tool}: ${v.detail}`).join("\n"),
    ).toEqual([]);
    expect(r.unusedExceptions).toEqual([]);
    // Sanity floor — if the inputs ever collapse to near-empty, this
    // assertion refuses to call the emptiness "clean" (instrument-sees-
    // target: a green over nothing proves nothing).
    expect(r.checkedTools).toBeGreaterThan(100);
    expect(r.checkedWhitelist).toBeGreaterThan(20);
  });
});
