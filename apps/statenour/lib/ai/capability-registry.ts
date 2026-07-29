/**
 * Capability registry (WP-14, 2026-07-28 blueprint batch).
 *
 * The unified read-side over the four tool-registration surfaces
 * (catalog · tool-families · reasoning whitelist · typed renderers) —
 * derived, not a rewrite: the catalog stays the metadata source of
 * truth; this module COMPOSES it into enforcement-grade answers.
 *
 * First consumer: read-mode hard enforcement (closes blueprint WP-1).
 * `actionPermission: "read"` was ADVISORY at the tool layer — a prompt
 * contract plus suppression of force-added action tools, with nothing
 * stripping mutating tools the pruner happened to select. Now
 * `stripMutatingTools` runs LAST in prepare-tools, after every force.
 *
 * Classification is FAIL-CLOSED, three independent tripwires — any one
 * marks a tool mutating:
 *   1. catalog `sideEffecting: true`
 *   2. catalog category in WRITE_CATEGORIES
 *   3. name starts with a mutating verb at a camelCase boundary
 *      (createTask trips on `create`+`T`; a hypothetical markdownExport
 *      does NOT trip `mark` because the boundary requires an uppercase
 *      follow — the false-positive class is designed out, not hoped away)
 * Plus the hardest tripwire: a tool with NO catalog entry is mutating by
 * definition — unknown ≠ safe.
 */

import { TOOL_CATALOG, type ToolMeta } from "@/lib/ai/tools/catalog";

/** Categories whose tools mutate state or reach outward by design. */
export const WRITE_CATEGORIES: ReadonlySet<string> = new Set([
  "personal_write",
  "business_write",
  "comms",
]);

// Mutating verb prefixes, matched only at a camelCase/underscore/digit
// boundary so read tools with overlapping spellings never trip.
// Exported for the boundary tests.
export const MUTATING_PREFIX =
  /^(create|update|delete|remove|send|set|add|publish|execute|queue|schedule|run|write|book|pay|mark|toggle|sync|import|approve|reject|dismiss|complete|cancel|assign|move|archive|restore|remember|forget|record|log|start|stop|activate|deactivate|trigger|post|reply|draft|generate|upload|save|apply|merge|resolve)(?=[A-Z0-9_])/;

let index: Map<string, ToolMeta> | null = null;
function catalogIndex(): Map<string, ToolMeta> {
  if (!index) {
    index = new Map();
    for (const meta of TOOL_CATALOG) index.set(meta.name, meta);
  }
  return index;
}

export interface ToolClassification {
  readSafe: boolean;
  /** Which tripwire fired (first match) — telemetry + tests. */
  reason:
    | "read_safe"
    | "side_effecting_flag"
    | "write_category"
    | "mutating_name"
    | "not_in_catalog";
}

export function classifyTool(name: string): ToolClassification {
  const meta = catalogIndex().get(name);
  if (!meta) return { readSafe: false, reason: "not_in_catalog" };
  if (meta.sideEffecting === true)
    return { readSafe: false, reason: "side_effecting_flag" };
  if (WRITE_CATEGORIES.has(meta.category))
    return { readSafe: false, reason: "write_category" };
  if (MUTATING_PREFIX.test(name))
    return { readSafe: false, reason: "mutating_name" };
  return { readSafe: true, reason: "read_safe" };
}

export function isReadSafeTool(name: string): boolean {
  return classifyTool(name).readSafe;
}

/**
 * Remove every non-read-safe tool from a tools record. Returns the
 * filtered record plus the stripped names for telemetry — a read-mode
 * turn should LOG what it refused, not silently shrink.
 */
export function stripMutatingTools<T extends Record<string, unknown>>(
  tools: T,
): { tools: T; stripped: string[] } {
  const stripped: string[] = [];
  const filtered: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (isReadSafeTool(name)) filtered[name] = tool;
    else stripped.push(name);
  }
  return { tools: filtered as T, stripped };
}
