/**
 * W6 PR 2 (2026-11-01) · the intent surface's compose step (docs/design/ui-v3/W6-INTENT-SURFACE.md §4A).
 * Nick picks reads, the server runs them, the registry draws them. The trust boundary is the tool set:
 * only tools that are read-only AND registered reach the model; at most INTENT_CARD_CAP calls run; a
 * repeated call runs once; a failed read comes back as a failure part, never dropped and never a zero.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { composeIntent, surfaceToolNames, INTENT_CARD_CAP } from "@/lib/intent/compose";
import { TOOL_CONFIG } from "@/components/chat/tool-result-registry";
import { READ_ONLY_TOOLS } from "@/lib/ai/tools/read-only-tools";

type Exec = (input: unknown) => unknown;
type FakeTool = { description?: string; inputSchema?: unknown; execute?: Exec };

/** Stands in for generateText: makes the scripted calls through the tools it was HANDED, the way the SDK does. */
function fakeGenerate(calls: Array<{ name: string; input?: unknown }>, seen: { tools?: string[]; handed?: Record<string, FakeTool> } = {}) {
  return async (opts: { tools: Record<string, FakeTool> }) => {
    seen.tools = Object.keys(opts.tools).sort();
    seen.handed = opts.tools;
    // Like the SDK: every call of the step starts before any is awaited (Promise.all), so a cap or a
    // dedupe that only counts after the await lets every call through.
    const runs = calls.map((c, i) => {
      const t = opts.tools[c.name];
      if (!t?.execute) return null; // the SDK cannot call a tool it was not given
      return Promise.resolve()
        .then(() => t.execute!(c.input ?? {}))
        .then(
          (output) => ({ type: "tool-result", toolCallId: `c${i}`, toolName: c.name, input: c.input ?? {}, output }),
          (error) => ({ type: "tool-error", toolCallId: `c${i}`, toolName: c.name, input: c.input ?? {}, error }),
        );
    });
    const content = (await Promise.all(runs)).filter(Boolean);
    return { steps: [{ content }] };
  };
}

function toolSet(names: string[], impl?: (name: string) => Exec) {
  const ran: string[] = [];
  const tools: Record<string, FakeTool> = {};
  for (const n of names) {
    tools[n] = {
      description: n,
      inputSchema: { schemaOf: n },
      execute: async (input) => {
        // A real read takes a tick: the cap and the dedupe must hold while earlier calls are still running.
        await new Promise((r) => setTimeout(r, 1));
        ran.push(n);
        return impl ? impl(n)(input) : { ok: true, tool: n };
      },
    };
  }
  return { tools, ran };
}

describe("intent surface · the tool set is the allowlist", () => {
  it("surface tools are exactly the read-only tools that have a card", () => {
    const expected = Object.keys(TOOL_CONFIG).filter((n) => READ_ONLY_TOOLS.has(n)).sort();
    expect(surfaceToolNames()).toEqual(expected);
    expect(surfaceToolNames()).toContain("getFleetTruth");
    expect(surfaceToolNames().length).toBeGreaterThan(0);
  });

  it("a write tool and an unregistered read never reach the model", async () => {
    const seen: { tools?: string[] } = {};
    const { tools, ran } = toolSet(["getFleetTruth", "createTask", "getAgendaItems"]);
    const out = await composeIntent({
      intent: "is everything running",
      tools,
      generate: fakeGenerate([{ name: "createTask" }, { name: "getAgendaItems" }, { name: "getFleetTruth" }], seen),
    });
    expect(seen.tools).toEqual(["getFleetTruth"]);
    expect(ran).toEqual(["getFleetTruth"]);
    expect(out.parts.map((p) => p.type)).toEqual(["tool-getFleetTruth"]);
  });
});

describe("intent surface · what the model is handed", () => {
  it("each surface tool keeps its description and input schema (the model needs both to pick and to call)", async () => {
    const seen: { handed?: Record<string, FakeTool> } = {};
    const { tools } = toolSet(["getFleetTruth"]);
    await composeIntent({ intent: "fleet", tools, generate: fakeGenerate([], seen) });
    expect(seen.handed?.getFleetTruth?.description).toBe("getFleetTruth");
    expect(seen.handed?.getFleetTruth?.inputSchema).toEqual({ schemaOf: "getFleetTruth" });
  });

  it("the SDK's per-call options (toolCallId, abortSignal) reach the real execute", async () => {
    const got: unknown[][] = [];
    const tools = { getFleetTruth: { description: "f", execute: async (...args: unknown[]) => (got.push(args), { ok: true }) } };
    const seen: { handed?: Record<string, FakeTool> } = {};
    await composeIntent({ intent: "fleet", tools, generate: fakeGenerate([], seen) });
    const opts = { toolCallId: "c9", abortSignal: new AbortController().signal };
    await (seen.handed!.getFleetTruth.execute as (i: unknown, o: unknown) => Promise<unknown>)({}, opts);
    expect(got[0][1]).toBe(opts);
  });
});

describe("intent surface · cap, dedupe, failures", () => {
  const names = surfaceToolNames().slice(0, 8);

  it(`runs at most ${INTENT_CARD_CAP} reads and counts the rest as refused`, async () => {
    expect(names.length).toBeGreaterThan(INTENT_CARD_CAP);
    const { tools, ran } = toolSet(names);
    const out = await composeIntent({ intent: "everything", tools, generate: fakeGenerate(names.map((name) => ({ name }))) });
    expect(ran).toHaveLength(INTENT_CARD_CAP);
    expect(out.parts).toHaveLength(INTENT_CARD_CAP);
    expect(out.refused).toBe(names.length - INTENT_CARD_CAP);
  });

  it("the same call twice runs once and draws once", async () => {
    const { tools, ran } = toolSet(["getFleetTruth"]);
    const out = await composeIntent({
      intent: "fleet",
      tools,
      generate: fakeGenerate([{ name: "getFleetTruth", input: {} }, { name: "getFleetTruth", input: {} }]),
    });
    expect(ran).toEqual(["getFleetTruth"]);
    expect(out.parts).toHaveLength(1);
    expect(out.refused).toBe(1);
  });

  it("the same tool with different args is two cards", async () => {
    const { tools } = toolSet(["searchMemories"]);
    const out = await composeIntent({
      intent: "brakes and tires",
      tools,
      generate: fakeGenerate([{ name: "searchMemories", input: { query: "brakes" } }, { name: "searchMemories", input: { query: "tires" } }]),
    });
    expect(out.parts).toHaveLength(2);
  });

  it("a read that throws comes back as a failure part with its words, never dropped", async () => {
    const { tools } = toolSet(["getFleetTruth", "dailyPulse"], (n) => () => {
      if (n === "dailyPulse") throw new Error("pulse read timed out after 8s");
      return { ok: true };
    });
    const out = await composeIntent({
      intent: "my day",
      tools,
      generate: fakeGenerate([{ name: "getFleetTruth" }, { name: "dailyPulse" }]),
    });
    const failed = out.parts.find((p) => p.type === "tool-dailyPulse");
    expect(failed?.state).toBe("output-error");
    expect(failed?.errorText).toContain("pulse read timed out");
    expect(out.failed).toBe(1);
    expect(out.parts.find((p) => p.type === "tool-getFleetTruth")?.state).toBe("output-available");
  });

  it("a read the nourTools wrapper turned into an error result counts as failed, and keeps its words", async () => {
    // lib/ai/tools.ts wrapToolsWithEmptyHandling: a throw becomes { error, reflection }; a timeout { error, timedOut }.
    const { tools } = toolSet(["dailyPulse", "getFleetTruth", "toolHealth"], (n) => () =>
      n === "dailyPulse"
        ? { error: "pulse read failed: connection reset", reflection: { tool: n, guidance: "retry once" } }
        : n === "toolHealth"
          ? { error: "toolHealth exceeded its 8s budget and was abandoned.", timedOut: true }
          : { ok: true },
    );
    const out = await composeIntent({
      intent: "my day",
      tools,
      generate: fakeGenerate([{ name: "dailyPulse" }, { name: "getFleetTruth" }, { name: "toolHealth" }]),
    });
    expect(out.failed).toBe(2);
    const pulse = out.parts.find((p) => p.type === "tool-dailyPulse");
    expect(pulse?.state).toBe("output-available");
    expect(JSON.stringify(pulse?.output)).toContain("connection reset");
  });

  it("a call to a name that is not on the surface (an inherited key, an invented tool) is skipped and counted", async () => {
    const { tools } = toolSet(["getFleetTruth"]);
    const generate = async () => ({
      steps: [
        {
          content: [
            { type: "tool-result", toolName: "constructor", output: { ok: true } },
            { type: "tool-result", toolName: "getMadeUpThing", output: { ok: true } },
            { type: "tool-result", toolName: "getFleetTruth", output: { ok: true } },
          ],
        },
      ],
    });
    const out = await composeIntent({ intent: "fleet", tools, generate });
    expect(out.parts.map((p) => p.type)).toEqual(["tool-getFleetTruth"]);
    expect(out.skipped).toBe(2);
  });

  it("the model answering with no read is an empty screen, not an error", async () => {
    const { tools } = toolSet(["getFleetTruth"]);
    const out = await composeIntent({ intent: "hello", tools, generate: fakeGenerate([]) });
    expect(out.parts).toEqual([]);
    expect(out.failed).toBe(0);
  });

  it("an empty intent is refused before any model call", async () => {
    const generate = vi.fn();
    await expect(composeIntent({ intent: "   ", tools: {}, generate })).rejects.toThrow(/intent/i);
    expect(generate).not.toHaveBeenCalled();
  });
});
