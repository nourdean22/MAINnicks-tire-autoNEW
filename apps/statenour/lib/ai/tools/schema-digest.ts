/**
 * lib/ai/tools/schema-digest.ts — deep tool-contract pin (2026-08-03).
 *
 * Replaces the fingerprint in tests/ai/tool-schemas.snapshot.test.ts,
 * which did not do what its own header claimed. That header said "when
 * any tool's public contract changes, this test fails". It did not:
 *
 *   1. It built a `fingerprints` object and then asserted only that
 *      there were >=100 of them and each was non-empty. Nothing was
 *      ever compared against a committed baseline, so every schema in
 *      the app could change and the test stayed green.
 *   2. Under zod v4 the fingerprint had also silently degraded. It read
 *      `field._def.typeName`, which v4 removed — measured, every field
 *      resolved to `"?"`. What remained was the sorted key names, so a
 *      field flipping string -> number, required -> optional, or an
 *      enum losing a member were all invisible even in principle.
 *
 * This uses zod v4's native `z.toJSONSchema()` to capture the FULL
 * contract — nested objects, enum members, optionality, constraints —
 * and stores it verbatim rather than hashed. Verbatim is the point: a
 * model calling a tool with the wrong argument shape fails at runtime
 * with a cryptic "execute failed", so the reviewer needs to see WHAT
 * changed in the PR diff, not merely that something did.
 *
 * RELATIONSHIP TO lib/agent-bridge/surface-digest.ts — they are not
 * duplicates and should not be merged:
 *   · surface-digest pins what is PUBLISHED over MCP (a subset) plus
 *     its risk metadata and description hashes. It answers a SECURITY
 *     question: did the externally-reachable surface change?
 *   · this pins the input contract of EVERY tool, verbatim. It answers
 *     a CORRECTNESS question: did a tool's argument shape drift out
 *     from under the model?
 */

import { z } from "zod";
import { nourTools } from "@/lib/ai/tools";

export interface ToolSchemaEntry {
  name: string;
  /** Full description text — it is part of the model-facing contract. */
  description: string;
  /**
   * JSON Schema for the tool's inputs, or a recorded reason it could
   * not be produced. Never silently omitted: a tool missing from the
   * pin would be a hole the diff cannot see.
   */
  inputSchema: unknown;
}

/** Recursively sort object keys so key order can never fake a diff. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(obj)
      .sort()
      .map((k) => [k, sortDeep(obj[k])]),
  );
}

function toJsonSchema(input: unknown): unknown {
  if (input === undefined || input === null) return { __note: "no input schema" };

  // Zod schema (v4 exposes _def; the AI SDK stores the zod object here).
  if (typeof input === "object" && "_def" in (input as object)) {
    try {
      // `unrepresentable: "any"` keeps types with no JSON-Schema analogue
      // (bigint, transforms, custom) from throwing and blowing away the
      // whole pin over one tool.
      return sortDeep(
        z.toJSONSchema(input as z.ZodType, { unrepresentable: "any", io: "input" }),
      );
    } catch (err) {
      // Recorded, never dropped — an unconvertible schema is itself a
      // fact worth pinning, and a change in that fact is worth seeing.
      return { __unconvertible: err instanceof Error ? err.message : String(err) };
    }
  }

  // Already a plain JSON-schema-ish object.
  return sortDeep(input);
}

/** Compute the current deep contract for every registered tool. */
export function computeToolSchemas(): ToolSchemaEntry[] {
  return Object.entries(nourTools)
    .map(([name, def]): ToolSchemaEntry => {
      const t = def as { inputSchema?: unknown; description?: unknown };
      return {
        name,
        description: typeof t.description === "string" ? t.description : "",
        inputSchema: toJsonSchema(t.inputSchema),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SchemaDiff {
  added: string[];
  removed: string[];
  /** name -> which parts changed ("description" and/or "inputSchema"). */
  changed: Record<string, string[]>;
}

export function diffToolSchemas(
  pinned: readonly ToolSchemaEntry[],
  current: readonly ToolSchemaEntry[],
): SchemaDiff {
  const index = (xs: readonly ToolSchemaEntry[]) => new Map(xs.map((e) => [e.name, e]));
  const [p, c] = [index(pinned), index(current)];

  const changed: Record<string, string[]> = {};
  for (const [name, cur] of c) {
    const prev = p.get(name);
    if (!prev) continue;
    const fields: string[] = [];
    if (prev.description !== cur.description) fields.push("description");
    if (JSON.stringify(prev.inputSchema) !== JSON.stringify(cur.inputSchema)) {
      fields.push("inputSchema");
    }
    if (fields.length) changed[name] = fields;
  }

  return {
    added: [...c.keys()].filter((n) => !p.has(n)).sort(),
    removed: [...p.keys()].filter((n) => !c.has(n)).sort(),
    changed,
  };
}
