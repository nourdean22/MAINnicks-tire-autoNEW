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
 *
 * 2026-09-18 · this file repaired only hallucinated NAMES, and declined
 * argument failures on the stated grounds that they were "a different failure
 * mode we deliberately leave to the SDK". `scripts/tool-input-failure-census.ts`
 * measured the split for the first time and it is the other way round: among
 * failures from tools still called in the last 14 days, ARGUMENT leads 11 to 1.
 * Worse, the three prod examples this header cites as motivation for the
 * 2026-09-16 change — `arsenal.webSearch`, `person.update`, `getRepoMap` — are
 * now 68, 68 and 37 days cold, so the name lane was itself tuned on evidence
 * that has since expired. The name repair stays (it is cheap and correct); step
 * 0 adds the argument lane, which is where the live traffic actually is.
 */

import {
  InvalidToolInputError,
  NoSuchToolError,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { salvageToolInput, type InputValidator } from "@/lib/ai/chat/salvage-tool-input";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/repair-tool-call");

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

/**
 * A validator backed by the tool's OWN zod schema, so a salvaged argument set
 * is only returned when it will actually parse.
 *
 * Returns undefined when the tool exposes nothing with `safeParse` — then
 * `salvageToolInput` falls back to "first parseable object" and the SDK
 * re-validates it, which is the same outcome the operator gets today if it is
 * wrong. Never throws: a schema whose `safeParse` blows up counts as a failed
 * candidate, not a failed turn.
 */
function validatorFor(toolSet: ToolSet, name: string): InputValidator | undefined {
  const entry = (toolSet as Record<string, { inputSchema?: unknown } | undefined>)[name];
  const schema = entry?.inputSchema as
    | { safeParse?: (v: unknown) => { success: boolean } }
    | undefined;
  if (typeof schema?.safeParse !== "function") return undefined;
  return (value: unknown) => {
    try {
      return schema.safeParse!(value).success;
    } catch {
      return false;
    }
  };
}

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
    // 0) 2026-09-18 · ARGUMENT failures. This branch used to read "argument-
    // validation errors are a different failure mode we deliberately leave to
    // the SDK" — a design note written without a measurement, and backwards.
    // `scripts/tool-input-failure-census.ts` split every recorded tool failure
    // by class AND by whether the tool is still in use: LIVE argument 11, LIVE
    // name 1. The class this file declined is the only one still happening,
    // and all 11 are one shape — several tool calls glued into one arguments
    // string, which `JSON.parse` then rejects whole. Rationale and the three
    // no-regression guards live in `salvage-tool-input.ts`.
    if (InvalidToolInputError.isInstance(error)) {
      // A tool the set does not hold cannot be argument-repaired; that is a
      // NAME problem wearing an argument error, and steps 1-3 own it.
      if (!(toolCall.toolName in toolSet)) return null;
      const salvaged = salvageToolInput(
        toolCall.input ?? "",
        validatorFor(toolSet, toolCall.toolName),
      );
      if (!salvaged) return null;
      // A SUCCESSFUL salvage is otherwise INVISIBLE. The repaired call simply
      // works, so it leaves no tool-error part, nothing reaches
      // `tool-telemetry-walk.ts`, and `failCount` just stops growing. That
      // makes the only available proof an ABSENCE — indistinguishable from the
      // absence you get when no one used the chat that week. This line is the
      // known positive: one structured event per firing, so the fix can be
      // shown to have worked rather than merely not observed to have failed.
      log.info("tool_input_salvaged", {
        tool: toolCall.toolName,
        candidates: salvaged.candidates,
        chosenIndex: salvaged.index,
      });
      return { ...toolCall, input: salvaged.input };
    }

    // Everything below repairs a hallucinated tool NAME.
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
