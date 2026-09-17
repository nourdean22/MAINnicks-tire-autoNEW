/**
 * A tool that EXISTS but wasn't loaded this turn is not a missing capability.
 *
 * WHAT PROD SHOWED. Six tools failed with "Model tried to call unavailable
 * tool" — `arsenal.webSearch`, `person.update`, `memory.remember`, `getGoals`,
 * `getRepoMap`. Two naming conventions coexist (the catalog is camelCase, the
 * action blocks are dotted like `task.create`) and the model mixes them. But
 * the larger half is simpler: the tool is real and the pruner dropped it.
 * Measured the same day, `searchWebVerified` was cut from the budget 52 times
 * and `githubRecentCommits` 53 — while `arsenal.webSearch` and `getRepoMap`
 * were dying as "unavailable".
 *
 * Steps 1 and 2 of the repair both require the target to be `in toolSet`, so
 * neither could ever rescue that case. Step 3 routes it through `invokeTool`,
 * which `prepare-tools.ts:184-194` attaches to EVERY turn.
 *
 * THE BOUNDARY THIS FILE GUARDS, and it cuts both ways:
 *   · a REAL but unloaded tool is rescued
 *   · a HALLUCINATED name is NOT — repairing it would invent a capability
 *   · read/write authority is NOT re-decided here. `invokeTool` refuses
 *     mutations itself, and a second copy of that gate could drift from the
 *     one the operator's approval flow actually depends on.
 */
import { describe, it, expect } from "vitest";
import { NoSuchToolError, type ToolSet } from "ai";
import { buildRepairToolCall } from "@/lib/ai/chat/repair-tool-call";

/** Names the fake "catalog" knows about, so tests never depend on real data. */
const KNOWN = new Set(["pinMemory", "createTask", "getRepoMap", "arsenalWebSearch", "searchWebVerified"]);

function toolSetOf(...names: string[]): ToolSet {
  const out: Record<string, unknown> = {};
  for (const n of names) out[n] = {};
  return out as ToolSet;
}

function call(toolName: string, input: Record<string, unknown> = {}) {
  return {
    toolCallId: "tc-1",
    toolName,
    input: JSON.stringify(input),
    type: "tool-call" as const,
  };
}

async function repair(
  toolSet: ToolSet,
  toolName: string,
  input: Record<string, unknown> = {},
  error: Error = new NoSuchToolError({ toolName, availableTools: Object.keys(toolSet) }),
) {
  const fn = buildRepairToolCall(toolSet, KNOWN);
  return (await fn({
    toolCall: call(toolName, input),
    error,
    tools: toolSet,
    inputSchema: (() => ({})) as never,
    messages: [],
    system: undefined,
  } as never)) as { toolName: string; input: string } | null;
}

describe("repair-tool-call · existing behaviour is preserved", () => {
  it("POSITIVE CONTROL: a non-NoSuchTool error is never repaired", async () => {
    // Without this, a repair that fired on EVERY error would satisfy the
    // rescue tests below while quietly swallowing argument-validation errors.
    const out = await repair(
      toolSetOf("invokeTool", "pinMemory"),
      "pinMemory",
      {},
      new Error("Type validation failed"),
    );
    expect(out).toBeNull();
  });

  it("maps a dotted alias onto the real tool when that tool IS loaded", async () => {
    const out = await repair(toolSetOf("pinMemory", "invokeTool"), "memory.remember", { content: "x" });
    expect(out?.toolName).toBe("pinMemory");
    expect(JSON.parse(out!.input)).toMatchObject({ content: "x" });
  });

  it("camelCases a dotted name when that lands on a loaded tool", async () => {
    const out = await repair(toolSetOf("arsenalWebSearch", "invokeTool"), "arsenal.web.search", { q: "tires" });
    expect(out?.toolName).toBe("arsenalWebSearch");
  });
});

describe("repair-tool-call · a pruned-out tool is rescued, a hallucinated one is not", () => {
  it("routes a REAL but unloaded tool through invokeTool", async () => {
    // getRepoMap exists in the catalog and died as "unavailable" in prod.
    const out = await repair(toolSetOf("invokeTool"), "getRepoMap", { depth: 2 });
    expect(out?.toolName).toBe("invokeTool");
    expect(JSON.parse(out!.input)).toEqual({ name: "getRepoMap", args: { depth: 2 } });
  });

  it("routes a DOTTED name whose camelCase form is real but unloaded", async () => {
    // `arsenal.webSearch` is the exact string from the prod failure list.
    const out = await repair(toolSetOf("invokeTool"), "arsenal.webSearch", { query: "monro prices" });
    expect(out?.toolName).toBe("invokeTool");
    expect(JSON.parse(out!.input)).toEqual({
      name: "arsenalWebSearch",
      args: { query: "monro prices" },
    });
  });

  it("carries the alias ARG REMAP through the recovery lane", async () => {
    // `person.update` maps onto pinMemory with a reshaped payload. Routing the
    // raw args would hand invokeTool a shape pinMemory rejects — the repair
    // would "succeed" into a second failure.
    const out = await repair(toolSetOf("invokeTool"), "person.update", { note: "Dania prefers texts" });
    expect(out?.toolName).toBe("invokeTool");
    expect(JSON.parse(out!.input)).toEqual({
      name: "pinMemory",
      args: { content: "Dania prefers texts" },
    });
  });

  it("REFUSES to repair a name that is not in the catalog", async () => {
    // `getGoals` was in the prod failure list and does NOT exist. Rescuing it
    // would conjure a capability out of a typo — the SDK's graceful tool-error
    // is the correct answer.
    const out = await repair(toolSetOf("invokeTool"), "getGoals");
    expect(out).toBeNull();
  });

  it("does nothing when the recovery lane itself is absent", async () => {
    // The operator can disable invokeTool (prepare-tools respects
    // disabledTools). Emitting a call to a tool that is not in the set would
    // turn one graceful error into two.
    const out = await repair(toolSetOf("pinMemory"), "getRepoMap");
    expect(out).toBeNull();
  });

  it("prefers a LOADED tool over the recovery lane", async () => {
    // Step 2 must win when the real tool is right there: a direct call is one
    // step, the detour is two, and the detour cannot run write tools.
    const out = await repair(toolSetOf("createTask", "invokeTool"), "task.create", { title: "x" });
    expect(out?.toolName).toBe("createTask");
  });
});

describe("repair-tool-call · authority is invokeTool's to decide, not this file's", () => {
  it("routes a WRITE tool too, and does not pre-judge it", async () => {
    // Deliberate. `invokeTool` answers with "…must load through the normal
    // path so approval gates apply", naming the tool. The status quo instead
    // teaches the model to say "I don't have that capability" — which is FALSE
    // and is exactly the fabrication the L1-L6 stack exists to prevent.
    //
    // The write does NOT happen: invokeTool checks isReadSafeTool itself, plus
    // the circuit breaker and the operator's disabledTools. Re-deciding any of
    // that here would create a second gate free to drift from the real one.
    const out = await repair(toolSetOf("invokeTool"), "createTask", { title: "x" });
    expect(out?.toolName).toBe("invokeTool");
    expect(JSON.parse(out!.input)).toEqual({ name: "createTask", args: { title: "x" } });
  });

  it("never targets the recovery lane with itself", async () => {
    // invokeTool and searchTools are always loaded, so they can never be the
    // "real but unloaded" case — but assert it, because a recursive repair
    // would be an infinite step loop rather than a bad answer.
    const out = await repair(toolSetOf("invokeTool", "searchTools"), "invokeTool");
    expect(out).toBeNull();
  });
});
