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
 * This builds an `experimental_repairToolCall` that remaps a hallucinated
 * name onto a REAL tool — but only ever to a tool that actually exists in the
 * live set. If it can't map confidently, it returns null and the SDK keeps
 * its existing graceful tool-error behaviour (no regression).
 */

import { NoSuchToolError, type ToolCallRepairFunction, type ToolSet } from "ai";

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
export function buildRepairToolCall(toolSet: ToolSet): ToolCallRepairFunction<ToolSet> {
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

    // 3) unmappable — let the SDK emit its graceful tool-error part.
    return null;
  };
}
