/**
 * repair-tool-call · 2026-07-12
 *
 * Some chat models occasionally emit tool calls under a name that isn't in
 * the active tool set — e.g. dotted "namespace" forms like `memory.remember`
 * or `person.update` instead of the real camelCase tools (`pinMemory`, …).
 * In AI SDK v6 that does NOT crash the stream (the call becomes a graceful
 * tool-error part), but the turn wastes a 7-8s step and the operator sees a
 * phantom "[memory.remember]" card followed by "I don't have that capability".
 *
 * This builds an `experimental_repairToolCall` that remaps a hallucinated name
 * onto a REAL tool. If it can't map confidently it returns null and the SDK
 * keeps its existing graceful tool-error behaviour (no regression).
 *
 * 2026-09-16 · the line above used to read "but only ever to a tool that
 * actually exists in the LIVE SET", which was both the design and its ceiling:
 * every path required the target to be `in toolSet`, so a tool the pruner had
 * simply dropped could never be recovered — the larger half of the measured
 * failures. Step 3 now routes that case through `invokeTool` (attached to every
 * turn by prepare-tools.ts), which enforces read/write authority itself. The
 * invariant that survives is narrower and truer: **a repair never targets a
 * name that is not in the catalog**, because that is a hallucination rather
 * than a pruned tool.
 */

import { NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from "ai";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

/**
 * Every tool that EXISTS, as opposed to every tool attached this turn. The
 * difference between those two sets is the whole point of step 3 below.
 */
const CATALOG_NAMES: ReadonlySet<string> = new Set(
  TOOL_CATALOG.map((t) => (t as { name: string }).name),
);

/**
 * The recovery lane is attached to EVERY turn — `prepare-tools.ts:184-194`
 * re-adds `searchTools`/`invokeTool` unconditionally after pruning, respecting
 * only the operator blocklist. That is what makes step 3 able to fire at all;
 * without it a repair could never reach a tool the pruner had dropped.
 */
const RECOVERY_TOOL = "invokeTool";

/** Curated dotted/underscored phantom → real tool, with optional arg remap. */
interface Alias {
  tool: string;
  mapArgs?: (a: Record<string, unknown>) => Record<string, unknown>;
}

const ALIASES: Record<string, Alias> = {
  "memory.remember": {
    tool: "pinMemory",
    mapArgs: (a) => ({ content: a?.content ?? a?.text ?? a?.key ?? "", label: a?.label ?? a?.category }),
  },
  "memory.pin": { tool: "pinMemory" },
  // No person-profile write tool exists — the closest faithful action is to
  // pin the note into the brain so it surfaces in future prompts.
  "person.update": {
    tool: "pinMemory",
    mapArgs: (a) => ({
      content:
        typeof a?.note === "string"
          ? a.note
          : typeof a?.content === "string"
            ? a.content
            : JSON.stringify(a ?? {}).slice(0, 280),
    }),
  },
  "task.create": { tool: "createTask" },
  "task.add": { tool: "createTask" },
  "task.complete": { tool: "completeTask" },
  "task.done": { tool: "completeTask" },
};

const dotToCamel = (n: string): string =>
  n.replace(/[.\-_ ]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());

function safeParse(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Build the repair function for a specific active tool set. Only remaps to a
 * tool that EXISTS in `toolSet`; otherwise returns null (SDK graceful path).
 */
export function buildRepairToolCall(
  toolSet: ToolSet,
  /** Injectable for tests. Defaults to the real catalog. */
  knownTools: ReadonlySet<string> = CATALOG_NAMES,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, error }) => {
    // Only handle "no such tool" — argument-validation errors are a different
    // failure mode we deliberately leave to the SDK.
    if (!NoSuchToolError.isInstance(error)) return null;

    const name = toolCall.toolName;
    const args = safeParse(toolCall.input ?? "{}");

    // 1) explicit alias (only if the target tool is actually available)
    const alias = ALIASES[name.toLowerCase()];
    if (alias && alias.tool in toolSet) {
      const mapped = alias.mapArgs ? alias.mapArgs(args) : args;
      return { ...toolCall, toolName: alias.tool, input: JSON.stringify(mapped) };
    }

    // 2) generic dotted/underscored → camelCase, if that lands on a real tool
    const camel = dotToCamel(name);
    if (camel !== name && camel in toolSet) {
      return { ...toolCall, toolName: camel, input: JSON.stringify(args) };
    }

    // 3) 2026-09-16 · the tool EXISTS but the pruner dropped it this turn.
    //
    // Steps 1 and 2 both require the target to be `in toolSet`, so neither can
    // rescue a pruned-out tool — and that is the larger half of the measured
    // failures. Prod recorded `arsenal.webSearch`, `person.update` and
    // `getRepoMap` under "Model tried to call unavailable tool" while
    // `searchWebVerified` and `githubRecentCommits` were being cut from the
    // budget 52 and 53 times respectively. The capability was there; the turn
    // just wasn't holding it.
    //
    // WHY THIS IS HONEST AND NOT AN AUTONOMY EXPANSION. The current dead end
    // teaches the model to say "I don't have that capability", which is FALSE —
    // the tool exists and was merely unloaded. Routing through `invokeTool`
    // gets the truth instead, because `invokeTool` answers for itself: it runs
    // read-safe tools and REFUSES mutations with "…must load through the normal
    // path so approval gates apply". That gate is not re-implemented here on
    // purpose — a second copy could drift from the first, and the first is the
    // one the operator's approval flow depends on. A write tool routed here is
    // refused by name, which is strictly more useful than a phantom card.
    //
    // A name that is NOT in the catalog is a HALLUCINATION, not a pruned tool,
    // and must fall through — repairing it would invent a capability.
    const target = alias?.tool ?? (camel !== name && knownTools.has(camel) ? camel : name);
    if (knownTools.has(target) && !(target in toolSet) && RECOVERY_TOOL in toolSet) {
      return {
        ...toolCall,
        toolName: RECOVERY_TOOL,
        input: JSON.stringify({ name: target, args: alias?.mapArgs ? alias.mapArgs(args) : args }),
      };
    }

    // 4) unmappable — let the SDK emit its graceful tool-error part.
    return null;
  };
}
