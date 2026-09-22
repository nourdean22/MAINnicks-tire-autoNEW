/**
 * tests/eval/tool-replay.test.ts · the stubbed tool replay's contract.
 *
 * The one property everything else rests on: NOTHING IS EXECUTED. A stubbed
 * tool map must keep the production description and schema (what the model
 * chooses on), replace every `execute` with a recorder, and the original
 * `execute` must never fire — asserted with a spy, not assumed from intent.
 * The rest is the judge-facing trace and the orchestration over injected deps.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_TOOL_STEPS,
  REPLAY_STUB_NOTE,
  TRACE_CAP_CHARS,
  renderToolTrace,
  replayWithTools,
  stubTools,
  type ToolReplayDeps,
} from "./tool-replay";
import type { RecordedToolCall, Scenario } from "./types";

const SCENARIO: Scenario = {
  id: "tagged",
  name: "Tool-dependent",
  description: "Needs a real tool action.",
  category: "multi-turn",
  input: {
    messages: [
      { role: "user", content: "find me three podcasts on pricing" },
      { role: "assistant", content: "Web search is unavailable right now." },
      { role: "user", content: "try again" },
    ],
  },
  judgeCriteria: [{ id: "retries", description: "actually retries through another path", weight: 4 }],
  tags: ["repair-mined", "requires-tools"],
};

describe("stubTools", () => {
  it("POSITIVE CONTROL + the invariant: the recorder fires, the original execute NEVER does", async () => {
    const realExecute = vi.fn(async () => ({ created: true, id: "t1" }));
    const tools = {
      createTask: { description: "Create a task", inputSchema: { kind: "zod" }, execute: realExecute },
    };
    const calls: RecordedToolCall[] = [];
    const stubbed = stubTools(tools, (c) => calls.push(c));

    const out = await (stubbed.createTask.execute as (a: unknown) => Promise<unknown>)({ title: "call supplier" });

    expect(realExecute).not.toHaveBeenCalled();
    expect(calls).toEqual([{ name: "createTask", args: { title: "call supplier" } }]);
    expect(out).toEqual({ ok: true, replay: true, results: [], note: REPLAY_STUB_NOTE });
  });

  it("keeps the production description and schema — the model must choose on exactly what production offers", () => {
    const tools = { search: { description: "Search the web", inputSchema: { kind: "zod", shape: "query" }, execute: async () => "x" } };
    const stubbed = stubTools(tools, () => {});
    expect(stubbed.search.description).toBe("Search the web");
    expect(stubbed.search.inputSchema).toEqual({ kind: "zod", shape: "query" });
    expect(stubbed.search.execute).not.toBe(tools.search.execute);
  });

  it("passes a tool without execute through untouched, and never invents one", () => {
    const providerSide = { description: "client-executed", inputSchema: {} };
    const stubbed = stubTools({ providerSide }, () => {});
    expect(stubbed.providerSide).toBe(providerSide);
    expect("execute" in stubbed.providerSide).toBe(false);
  });

  it("stubs every tool in the map, not just the first", async () => {
    const a = vi.fn(async () => "a");
    const b = vi.fn(async () => "b");
    const calls: RecordedToolCall[] = [];
    const stubbed = stubTools({ a: { execute: a }, b: { execute: b } }, (c) => calls.push(c));
    await (stubbed.a.execute as () => Promise<unknown>)();
    await (stubbed.b.execute as () => Promise<unknown>)();
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(calls.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("renderToolTrace", () => {
  it("is empty when nothing was called — the judge sees only the reply", () => {
    expect(renderToolTrace([])).toBe("");
  });

  it("names each call with its args, labelled as a stubbed replay", () => {
    const trace = renderToolTrace([
      { name: "searchTools", args: { query: "podcasts pricing" } },
      { name: "invokeTool", args: { name: "arsenalWebSearch", input: { q: "pricing podcasts" } } },
    ]);
    expect(trace).toMatch(/^## Tool activity this turn \(replay · executions STUBBED, calls recorded\)/);
    expect(trace).toContain('- searchTools({"query":"podcasts pricing"})');
    expect(trace).toContain('- invokeTool({"name":"arsenalWebSearch"');
  });

  it("truncates huge args per line and caps the whole block under the judge's preview", () => {
    const calls = Array.from({ length: 40 }, (_, i) => ({ name: `tool${i}`, args: { blob: "x".repeat(500) } }));
    const trace = renderToolTrace(calls);
    expect(trace.length).toBeLessThanOrEqual(TRACE_CAP_CHARS);
    expect(trace).toContain("…");
  });

  it("survives unserialisable args", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(renderToolTrace([{ name: "weird", args: circular }])).toContain("- weird([unserialisable args])");
  });
});

describe("replayWithTools", () => {
  function deps(over: Partial<ToolReplayDeps> = {}) {
    const realExecute = vi.fn(async () => ({ live: "data" }));
    const generate = vi.fn(async (args: Parameters<ToolReplayDeps["generate"]>[0]) => {
      // Simulate the SDK: it calls the (stubbed) tool once, then returns text.
      const t = args.tools.searchTools as { execute: (a: unknown) => Promise<unknown> };
      await t.execute({ query: "podcasts" });
      return {
        text: "  I retried through searchTools and found nothing in this environment.  ",
        steps: [{ toolCalls: [{ toolName: "searchTools", input: { query: "podcasts" } }] }],
      };
    });
    const d: ToolReplayDeps = {
      loadModel: async () => ({ id: "fake-model" }),
      loadTools: async () => ({ searchTools: { description: "d", inputSchema: {}, execute: realExecute } }),
      generate,
      ...over,
    };
    return { d, realExecute, generate };
  }

  it("hands the model the STUBBED map, records the call, and returns the trimmed text", async () => {
    const { d, realExecute, generate } = deps();
    const out = await replayWithTools(SCENARIO, "SYSTEM", d);
    expect(out.error).toBeNull();
    expect(out.response).toBe("I retried through searchTools and found nothing in this environment.");
    expect(out.toolCalls).toEqual([{ name: "searchTools", args: { query: "podcasts" } }]);
    expect(realExecute).not.toHaveBeenCalled();
    const sent = generate.mock.calls[0]?.[0];
    expect(sent?.system).toBe("SYSTEM");
    expect(sent?.maxSteps).toBe(MAX_TOOL_STEPS);
    expect(sent?.messages).toEqual(SCENARIO.input.messages);
  });

  it("merges the SDK's own record when it saw a call the recorder did not (emitted, never executed)", async () => {
    const { d } = deps({
      generate: async () => ({
        text: "done",
        steps: [{ toolCalls: [{ toolName: "createTask", input: { title: "x" } }, { toolName: "searchTools", args: { query: "legacy-field" } }] }],
      }),
    });
    const out = await replayWithTools(SCENARIO, "SYSTEM", d);
    expect(out.toolCalls).toEqual([
      { name: "createTask", args: { title: "x" } },
      { name: "searchTools", args: { query: "legacy-field" } },
    ]);
  });

  it("a thrown generate is an error result with whatever was recorded before it, never a throw into the runner", async () => {
    const { d } = deps({
      generate: async () => {
        throw new Error("no provider configured for reason");
      },
    });
    const out = await replayWithTools(SCENARIO, "SYSTEM", d);
    expect(out).toEqual({ response: "", toolCalls: [], error: "no provider configured for reason" });
  });
});
