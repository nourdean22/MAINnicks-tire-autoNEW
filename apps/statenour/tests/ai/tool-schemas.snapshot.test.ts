/**
 * tests/ai/tool-schemas.snapshot.test.ts — deep tool-contract pin.
 *
 * REWRITTEN 2026-08-03. The previous version's header promised "when
 * any tool's public contract changes, this test fails" and did not
 * deliver it: it computed fingerprints into a local object, then
 * asserted only that >=100 existed and each was non-empty. No baseline
 * was ever compared, so every schema in the app could change and this
 * stayed green. The fingerprint had also silently rotted under zod v4,
 * which removed `_def.typeName` — measured, every field rendered as
 * "?", leaving only sorted key names.
 *
 * Now it pins the FULL JSON Schema of every tool, verbatim, and diffs
 * it. Verbatim rather than hashed because a wrong argument shape
 * surfaces at runtime as a cryptic "execute failed", so the reviewer
 * needs to see what changed, not just that something did.
 *
 * How to update (deliberate, never a test side-effect):
 *   pnpm snapshot:tool-schemas
 * Then READ the diff. A widened enum, a newly-optional field, or an
 * edited description all change how the model calls the tool.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeToolSchemas,
  diffToolSchemas,
  type ToolSchemaEntry,
} from "@/lib/ai/tools/schema-digest";

const SNAPSHOT = new URL("./tool-schemas.snapshot.json", import.meta.url);
const UPDATING = process.env.UPDATE_TOOL_SCHEMAS === "1";

const current = computeToolSchemas();

if (UPDATING) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`, "utf8");
}

describe("tool contracts match their committed pin", () => {
  it("has a committed snapshot", () => {
    // Fail closed: deleting the pin must not read as "nothing changed".
    expect(
      existsSync(SNAPSHOT),
      "tool-schemas.snapshot.json is missing — run `pnpm snapshot:tool-schemas` and REVIEW the diff",
    ).toBe(true);
  });

  it("covers every registered tool (the diff is not passing by vacuity)", () => {
    // The old test asserted only this kind of shape and called it a
    // snapshot. Kept as a floor, but it is no longer the whole test.
    expect(current.length).toBeGreaterThanOrEqual(100);
    expect(new Set(current.map((t) => t.name)).size).toBe(current.length);
  });

  it("every tool's input schema was actually convertible", () => {
    // A tool whose schema could not be converted is pinned with an
    // __unconvertible marker rather than dropped. If that count grows,
    // the pin is quietly going blind in places.
    const blind = current.filter(
      (t) =>
        typeof t.inputSchema === "object" &&
        t.inputSchema !== null &&
        "__unconvertible" in (t.inputSchema as object),
    );
    expect(blind.map((t) => t.name)).toEqual([]);
  });

  it("no tool contract changed without review", () => {
    const pinned = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as ToolSchemaEntry[];
    const diff = diffToolSchemas(pinned, current);

    const report = [
      diff.added.length ? `ADDED: ${diff.added.join(", ")}` : "",
      diff.removed.length ? `REMOVED: ${diff.removed.join(", ")}` : "",
      ...Object.entries(diff.changed).map(([name, fields]) => `CHANGED ${name}: ${fields.join(", ")}`),
    ]
      .filter(Boolean)
      .join("\n");

    expect(
      report,
      `Tool contract drift. If every line below is intended, run \`pnpm snapshot:tool-schemas\` and review the JSON diff:\n${report}\n`,
    ).toBe("");
  });
});

describe("the pin captures DEEP schema semantics, not just key names", () => {
  /**
   * The regression guard for what actually broke. The old fingerprint
   * survived any change that preserved key names, because zod v4 made
   * every field type render as "?". These assert the JSON Schema
   * carries the semantics the fingerprint had lost.
   */
  const withObjectSchema = current.find((t) => {
    const s = t.inputSchema as { properties?: Record<string, unknown> } | null;
    return s && typeof s === "object" && s.properties && Object.keys(s.properties).length > 0;
  });

  it("finds at least one tool with a real property map", () => {
    expect(withObjectSchema, "no tool produced an object schema with properties").toBeDefined();
  });

  it("records field TYPES, which the old fingerprint rendered as '?'", () => {
    const props = (withObjectSchema!.inputSchema as { properties: Record<string, { type?: string }> })
      .properties;
    const typed = Object.values(props).filter((p) => typeof p?.type === "string");
    expect(typed.length).toBeGreaterThan(0);
  });

  it("records which fields are REQUIRED, so optional<->required flips are visible", () => {
    const anyRequired = current.some((t) => {
      const s = t.inputSchema as { required?: unknown[] } | null;
      return s && typeof s === "object" && Array.isArray(s.required) && s.required.length > 0;
    });
    expect(anyRequired).toBe(true);
  });

  it("records descriptions, which are part of the model-facing contract", () => {
    expect(current.some((t) => t.description.length > 0)).toBe(true);
  });
});
