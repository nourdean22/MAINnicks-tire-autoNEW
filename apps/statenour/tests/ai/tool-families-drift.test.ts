/**
 * TOOL_FAMILIES drift guard — 2026-07-11 review.
 *
 * assertToolFamiliesInSync() only console.warn'd, so the observability
 * registry drifted to 4 phantom entries (tools deleted Apr 28 still
 * listed on /system/tools) and ~50 undocumented tools. This test makes
 * ONE direction a hard failure:
 *
 *   · PHANTOM entries (registry key with no real tool) = FAIL — the
 *     admin surface must never describe tools that don't exist.
 *   · MISSING entries (real tool with no registry row) = tracked as a
 *     ratchet: the count must never grow past the recorded baseline.
 *     Backfilling descriptions is content work; new tools SHOULD ship
 *     with a registry row, and this ratchet enforces that from now on.
 */
import { describe, expect, it } from "vitest";
import { TOOL_FAMILIES } from "@/lib/ai/tool-families";
import { nourTools } from "@/lib/ai/tools";

describe("TOOL_FAMILIES <-> nourTools drift", () => {
  it("has ZERO phantom entries (registry rows for non-existent tools)", () => {
    const toolKeys = new Set(Object.keys(nourTools));
    const phantoms = Object.keys(TOOL_FAMILIES).filter((k) => !toolKeys.has(k));
    expect(phantoms).toEqual([]);
  });

  it("undocumented-tool count never grows past the baseline (ratchet)", () => {
    // Baseline 0 since the 2026-07-11 backfill (54 entries generated from
    // the live tool descriptions). Every NEW tool must ship with its
    // TOOL_FAMILIES row — do not bump this number.
    const BASELINE = 0;
    const regKeys = new Set(Object.keys(TOOL_FAMILIES));
    const undocumented = Object.keys(nourTools).filter((k) => !regKeys.has(k));
    expect(
      undocumented.length,
      `undocumented tools (add TOOL_FAMILIES rows): ${undocumented.slice(0, 10).join(", ")}…`,
    ).toBeLessThanOrEqual(BASELINE);
  });
});
