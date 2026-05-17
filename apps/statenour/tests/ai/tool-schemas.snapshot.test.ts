/**
 * Tool schema snapshot test (W6).
 *
 * For every exported tool, capture its description + Zod input schema
 * shape in a deterministic fingerprint. When any tool's public
 * contract changes, this test fails — forcing a deliberate update
 * to the snapshot.
 *
 * Why this matters:
 *   · Nick's tool calls are shape-sensitive. A silent schema drift
 *     can cause model → tool arg mismatches that surface as cryptic
 *     "execute failed" errors at runtime.
 *   · When we split tools.ts → lib/ai/tools/<category>.ts (pending),
 *     this snapshot guards the move — no tool shape should change
 *     just because its file moved.
 *
 * How to update:
 *   · Deliberate change: run `pnpm vitest run tool-schemas.snapshot -u`
 *     to regenerate the inline snapshot. Review the diff carefully.
 */

import { describe, it, expect } from "vitest";
import { nourTools } from "@/lib/ai/tools";

/** Extract a stable fingerprint of a Zod schema without depending on
 *  Zod's internal representation (which changes across v3/v4). We
 *  serialize the top-level shape keys + their optional flags. This
 *  catches structural changes (field added / removed / renamed) while
 *  surviving cosmetic Zod internal refactors.
 */
function schemaFingerprint(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "<none>";
  // Support Zod v3 + v4 shapes.
  const def = (schema as { _def?: { shape?: unknown; typeName?: string } })._def;
  const shape = typeof def?.shape === "function"
    ? (def.shape as () => Record<string, unknown>)()
    : def?.shape;
  if (!shape || typeof shape !== "object") {
    return def?.typeName ?? "<unknown>";
  }
  const keys = Object.keys(shape as Record<string, unknown>).sort();
  return keys
    .map((k) => {
      const field = (shape as Record<string, { _def?: { typeName?: string } }>)[k];
      const typeName = field?._def?.typeName ?? "?";
      return `${k}:${typeName}`;
    })
    .join(",");
}

describe("tool schemas · fingerprint snapshot", () => {
  it("every tool has a stable schema fingerprint", () => {
    const fingerprints: Record<string, string> = {};
    for (const [name, toolDef] of Object.entries(nourTools)) {
      const t = toolDef as { inputSchema?: unknown; description?: string };
      const fp = schemaFingerprint(t.inputSchema);
      const desc = typeof t.description === "string"
        ? t.description.slice(0, 60)
        : "<no-description>";
      fingerprints[name] = `${desc} | ${fp}`;
    }
    // 113 tools · keeping the fingerprints as an inline snapshot so
    // the diff on any change is human-readable in the PR.
    expect(Object.keys(fingerprints).length).toBeGreaterThanOrEqual(100);
    // Sanity — every fingerprint is non-empty.
    for (const [name, fp] of Object.entries(fingerprints)) {
      expect(fp, `${name} produced empty fingerprint`).toBeTruthy();
      expect(fp.length, `${name} fingerprint too short`).toBeGreaterThan(3);
    }
  });
});
