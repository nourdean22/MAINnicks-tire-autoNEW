/**
 * tests/eval/tool-replay.ts · tool-capable replay with STUBBED execution.
 *
 * WHY. Eight repair-mined scenarios carry a dominant criterion that IS a tool
 * action ("actually attempts the lookup again through searchTools/invokeTool",
 * "performs the action through a real tool call this turn"). The live runner
 * replays through `aiChat`, which has no tool support, so they are tagged
 * `requires-tools` and skipped (#2487). This module is the runner they were
 * waiting for — with one deliberate limit:
 *
 * NOTHING IS EXECUTED. Every tool in `nourTools` keeps its production
 * description and input schema, so the model sees exactly what production
 * offers and chooses exactly as it would — but every `execute` is replaced by
 * a recorder that returns a neutral "replay environment, result not available"
 * payload. `createTask` creates nothing; `arsenalWebSearch` searches nothing;
 * no prod row moves, no external call is made, no telemetry row is written
 * (this path never touches `prepareTools`, whose `tool.surfaced` write would
 * pollute the production instruments with eval turns). What the judge gets is
 * the reply PLUS a rendered trace of the calls Nick made, which is precisely
 * the dimension those criteria test: did Nick reach for a tool, which one, and
 * did he retry through another path.
 *
 * WHAT IT CANNOT MEASURE, said plainly: whether the real tool would have
 * succeeded, and how Nick handles a real result. A stubbed result is empty by
 * construction, so "recovers gracefully from an empty result" is scored, "uses
 * the data well" is not. Reports from this path say `toolReplay: true`.
 *
 * Dependency-injected (`replayWithTools`) so the contract is unit-testable
 * without a model; `callNickWithTools` binds the live deps and is what the
 * runner calls under `--live --tools`. Operator-driven — it spends provider
 * credits like the rest of `eval:live`.
 */
import type { RecordedToolCall, Scenario } from "./types";

/** What every stubbed tool returns. Neutral and honest; never "success with data". */
export const REPLAY_STUB_NOTE =
  "replay environment — this tool's live result is not available; treat the result as empty and say so if it matters";

/** Tool-call rounds the model may take before the reply is forced. */
export const MAX_TOOL_STEPS = 4;

/** The rendered trace is prepended to the reply the judge sees; keep it inside the judge's preview cap. */
export const TRACE_CAP_CHARS = 900;

type ToolLike = { execute?: (...args: unknown[]) => unknown } & Record<string, unknown>;

/**
 * Same tool map, every `execute` replaced by a recorder. Tools without an
 * `execute` (client-side / provider-executed) pass through untouched. The
 * description and input schema — what the model actually chooses on — are the
 * production ones, unchanged.
 */
export function stubTools<T extends Record<string, ToolLike>>(
  tools: T,
  record: (call: RecordedToolCall) => void,
): T {
  const out: Record<string, ToolLike> = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (typeof tool.execute !== "function") {
      out[name] = tool;
      continue;
    }
    out[name] = {
      ...tool,
      execute: async (args: unknown) => {
        record({ name, args });
        return { ok: true, replay: true, results: [], note: REPLAY_STUB_NOTE };
      },
    };
  }
  return out as T;
}

/** The judge-facing rendering of what Nick called. Empty string when nothing was called. */
export function renderToolTrace(calls: ReadonlyArray<RecordedToolCall>): string {
  if (calls.length === 0) return "";
  const lines = calls.map((c) => {
    let args = "";
    try {
      args = JSON.stringify(c.args) ?? "";
    } catch {
      args = "[unserialisable args]";
    }
    if (args.length > 160) args = `${args.slice(0, 157)}…`;
    return `- ${c.name}(${args})`;
  });
  const body = `## Tool activity this turn (replay · executions STUBBED, calls recorded)\n${lines.join("\n")}`;
  return body.length > TRACE_CAP_CHARS ? `${body.slice(0, TRACE_CAP_CHARS - 1)}…` : body;
}

export interface ToolReplayResult {
  response: string;
  toolCalls: RecordedToolCall[];
  error: string | null;
}

/** One step of an AI SDK generateText result, reduced to what the replay reads. */
export interface ReplayStep {
  toolCalls?: ReadonlyArray<{ toolName: string; input?: unknown; args?: unknown }>;
}

export interface ToolReplayDeps {
  loadModel: () => Promise<unknown>;
  loadTools: () => Promise<Record<string, ToolLike>>;
  generate: (args: {
    model: unknown;
    system: string;
    messages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
    tools: Record<string, ToolLike>;
    maxSteps: number;
  }) => Promise<{ text: string; steps?: ReadonlyArray<ReplayStep> }>;
}

/**
 * Pure orchestration over injected deps. The recorder is the source of truth
 * for what was called (it fires from inside the stubbed `execute`); the SDK's
 * `steps[].toolCalls` is read as a cross-check and merged so a call the model
 * emitted but the SDK declined to execute (schema mismatch) still appears.
 */
export async function replayWithTools(
  scenario: Scenario,
  systemPrompt: string,
  deps: ToolReplayDeps,
): Promise<ToolReplayResult> {
  const recorded: RecordedToolCall[] = [];
  try {
    const [model, tools] = await Promise.all([deps.loadModel(), deps.loadTools()]);
    const stubbed = stubTools(tools, (c) => recorded.push(c));
    const result = await deps.generate({
      model,
      system: systemPrompt,
      messages: scenario.input.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: stubbed,
      maxSteps: MAX_TOOL_STEPS,
    });
    // Cross-check against the SDK's own record of emitted calls: anything it
    // saw that the recorder did not (never executed) is still a call Nick made.
    const fromSteps: RecordedToolCall[] = [];
    for (const step of result.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        fromSteps.push({ name: call.toolName, args: call.input ?? call.args ?? null });
      }
    }
    const toolCalls =
      fromSteps.length > recorded.length ? fromSteps : recorded.length > 0 ? recorded : fromSteps;
    return { response: (result.text ?? "").trim(), toolCalls, error: null };
  } catch (err) {
    return {
      response: "",
      toolCalls: recorded,
      error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240),
    };
  }
}

/** Live binding: production model resolver, production tool map, the AI SDK. */
export async function callNickWithTools(scenario: Scenario, systemPrompt: string): Promise<ToolReplayResult> {
  return replayWithTools(scenario, systemPrompt, {
    loadModel: async () => {
      const { getModel } = await import("@/lib/ai/provider");
      return getModel("reason");
    },
    loadTools: async () => {
      const { nourTools } = await import("@/lib/ai/tools");
      return nourTools as unknown as Record<string, ToolLike>;
    },
    generate: async ({ model, system, messages, tools, maxSteps }) => {
      const { generateText, stepCountIs } = await import("ai");
      const result = await generateText({
        model: model as Parameters<typeof generateText>[0]["model"],
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        tools: tools as Parameters<typeof generateText>[0]["tools"],
        stopWhen: stepCountIs(maxSteps),
      });
      return { text: result.text, steps: result.steps as ReadonlyArray<ReplayStep> };
    },
  });
}
