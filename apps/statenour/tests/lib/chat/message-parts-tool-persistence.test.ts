/**
 * B1 (job 2026-11-01-chat-humanizer-w6): a saved reply keeps its tool cards.
 *
 * Measured 2026-11-01: 0 of 123 saved replies in 7 days carried a tool part while 94 of 124 turns
 * used tools (docs/research/chat-upgrades-2026-11-01.md section 2.4). The cards rendered live and
 * vanished on reload because buildMessageParts had no way to receive them.
 *
 * Each test runs the whole path a reply takes: the stream's onFinish steps, the producer, a JSON
 * round trip (what a Json column hands back) and the load-side check in readConversation.
 */
import { describe, it, expect } from "vitest";
import {
  buildMessageParts,
  capToolOutput,
  keepStoredToolParts,
  sanitizeStoredParts,
  toolPartsFromSteps,
  TOOL_OUTPUT_CAP_BYTES,
} from "@/lib/services/chat/message-parts";

/** A two-step turn in the AI SDK v6 onFinish shape: one read that returned, one that threw. */
const twoToolTurn = {
  steps: [
    {
      toolCalls: [{ type: "tool-call", toolCallId: "c1", toolName: "getTasks", input: { status: "open" } }],
      toolResults: [
        { type: "tool-result", toolCallId: "c1", toolName: "getTasks", input: { status: "open" }, output: { tasks: [{ id: "t1", title: "Order tires", updatedAt: new Date("2026-11-01T12:00:00Z") }] } },
      ],
      content: [],
    },
    {
      toolCalls: [{ type: "tool-call", toolCallId: "c2", toolName: "queryNickstire", input: { q: "invoices today" } }],
      toolResults: [],
      content: [{ type: "tool-error", toolCallId: "c2", toolName: "queryNickstire", error: new Error("upstream 502") }],
    },
  ],
};

/** What a Json column gives back: JSON in, JSON out. */
const throughDb = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("B1 · a tool turn survives save and reload", () => {
  it("persists both tool calls with their states and reads them back", async () => {
    const { partsArray } = await buildMessageParts("You have one open task.", undefined, false, toolPartsFromSteps(twoToolTurn));
    const loaded = (await sanitizeStoredParts(throughDb(partsArray))) as Array<Record<string, unknown>>;

    const tools = loaded.filter((p) => String(p.type).startsWith("tool-"));
    expect(tools.map((p) => [p.type, p.toolCallId, p.state])).toEqual([
      ["tool-getTasks", "c1", "output-available"],
      ["tool-queryNickstire", "c2", "output-error"],
    ]);
    expect(tools[0].input).toEqual({ status: "open" });
    expect(tools[1].errorText).toBe("upstream 502");
    // The text still comes after the cards, as it streamed.
    expect(loaded.at(-1)).toEqual({ type: "text", text: "You have one open task." });
  });

  it("stores a tool result as JSON values (a Prisma Date becomes an ISO string)", () => {
    const [read] = toolPartsFromSteps(twoToolTurn) as Array<{ output: { tasks: Array<{ updatedAt: unknown }> } }>;
    expect(read.output.tasks[0].updatedAt).toBe("2026-11-01T12:00:00.000Z");
  });

  it("skips a call the SDK refused because the step offered no tools (it never ran)", () => {
    const refused = {
      steps: [
        {
          toolCalls: [{ toolCallId: "c9", toolName: "getTasks", input: {} }],
          toolResults: [],
          content: [{ type: "tool-error", toolCallId: "c9", toolName: "getTasks", error: { availableTools: [] } }],
        },
      ],
    };
    expect(toolPartsFromSteps(refused)).toEqual([]);
  });

  it("a call with no recorded result is saved as failed, never as forever-running", () => {
    const callOnly = { steps: [{ toolCalls: [{ toolCallId: "c3", toolName: "createTask", input: { title: "x" } }], toolResults: [], content: [] }] };
    const [part] = toolPartsFromSteps(callOnly) as Array<Record<string, unknown>>;
    expect(part.state).toBe("output-error");
    expect(part.errorText).toMatch(/no result/i);
  });

  it("POSITIVE CONTROL: a turn with no steps (an alternate lane) stores text only, as before", async () => {
    const { partsArray } = await buildMessageParts("hi", undefined, false, toolPartsFromSteps({}));
    expect(partsArray?.map((p) => p.type)).toEqual(["text"]);
  });
});

describe("B1 · an oversize tool output is capped", () => {
  it("keeps the output under the cap, keeps its shape and marks it truncated", () => {
    const rows = Array.from({ length: 400 }, (_, i) => ({ id: i, note: "x".repeat(120) }));
    const capped = capToolOutput({ rows, total: 400 }) as { rows: unknown[]; total: number; truncated?: boolean };
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(TOOL_OUTPUT_CAP_BYTES);
    expect(Array.isArray(capped.rows)).toBe(true);
    expect(capped.total).toBe(400);
    expect(capped.truncated).toBe(true);
  });

  it("leaves a small output untouched (no truncated flag)", () => {
    expect(capToolOutput({ ok: true, count: 2 })).toEqual({ ok: true, count: 2 });
  });

  it("a value that cannot be shrunk by shape falls back to a summary", () => {
    // 2,000 keys: no row or string to cut, so only a summary fits.
    const wide = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`key${i}`, i]));
    const capped = capToolOutput(wide) as { truncated: boolean; summary: string };
    expect(capped.truncated).toBe(true);
    expect(typeof capped.summary).toBe("string");
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(TOOL_OUTPUT_CAP_BYTES);
  });

  it("a long string output is cut by code point, never leaving half an emoji", () => {
    const capped = capToolOutput("🚗".repeat(TOOL_OUTPUT_CAP_BYTES)) as string;
    expect(new TextEncoder().encode(JSON.stringify(capped)).length).toBeLessThanOrEqual(TOOL_OUTPUT_CAP_BYTES);
    expect(capped.isWellFormed()).toBe(true);
  });
});

describe("B1 · a corrupt stored part loads as text only", () => {
  it("drops the bad tool part and keeps the message's text", async () => {
    const stored = [
      { type: "tool-getTasks", toolCallId: "c1", state: "not-a-state", output: {} },
      { type: "tool-getTasks", state: "output-available", output: {} }, // no toolCallId
      { type: "text", text: "Here is what I found." },
    ];
    expect(await sanitizeStoredParts(stored)).toEqual([{ type: "text", text: "Here is what I found." }]);
  });

  it("passes a non-array value through untouched (legacy rows)", async () => {
    expect(await sanitizeStoredParts(null)).toBe(null);
  });
});

describe("B1 · a later patch of the row keeps the cards", () => {
  it("the L2 banner and action-receipt rewrites carry the stored tool parts forward", async () => {
    const { partsArray: first } = await buildMessageParts("I added it.", undefined, false, toolPartsFromSteps(twoToolTurn));
    const kept = keepStoredToolParts(throughDb(first));
    const { partsArray: patched } = await buildMessageParts("[verifier] I added it.", undefined, true, kept);
    expect(patched?.map((p) => p.type)).toEqual(["tool-getTasks", "tool-queryNickstire", "text"]);
    // keepStoredToolParts keeps tool parts only: the old, unbannered text must not ride along.
    expect(patched?.some((p) => (p as { text?: string }).text === "I added it.")).toBe(false);
    expect(patched?.at(-1)).toEqual({ type: "text", text: "[verifier] I added it." });
  });
});

describe("B1 · the next turn replays a reloaded tool turn cleanly", () => {
  it("stored parts convert to paired tool-call / tool-result history with no conversion error", async () => {
    const { buildModelMessages } = await import("@/app/api/ai/chat/build-model-messages");
    const { partsArray } = await buildMessageParts("You have one open task.", undefined, false, toolPartsFromSteps(twoToolTurn));
    const reloaded = await sanitizeStoredParts(throughDb(partsArray));
    const errors: string[] = [];
    const out = (await buildModelMessages({
      compression: { compressed: false, messages: [] },
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "what's open?" }] },
        { id: "a1", role: "assistant", parts: reloaded as never },
        { id: "u2", role: "user", parts: [{ type: "text", text: "thanks" }] },
      ],
      log: { error: (event: string) => errors.push(event) },
    })) as Array<{ role: string; content: Array<{ type: string; toolCallId?: string }> | string }>;

    expect(errors).toEqual([]);
    const ids = (type: string) =>
      out.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === type).map((p) => p.toolCallId);
    expect(ids("tool-call")).toEqual(["c1", "c2"]);
    expect(ids("tool-result")).toEqual(["c1", "c2"]);
  });
});

describe("B1 · error text a card can show", () => {
  it("an error with nothing readable in it says the tool failed, never 'null' or '{}'", () => {
    const turn = (error: unknown) => ({ steps: [{ toolCalls: [{ toolCallId: "e1", toolName: "getTasks", input: {} }], toolResults: [], content: [{ type: "tool-error", toolCallId: "e1", toolName: "getTasks", error }] }] });
    for (const error of [{}, Object.create(null), { toJSON: () => null }]) {
      const [part] = toolPartsFromSteps(turn(error)) as Array<{ errorText: string }>;
      expect(part.errorText).toBe("Tool failed.");
    }
    const [coded] = toolPartsFromSteps(turn({ code: "E_TIMEOUT" })) as Array<{ errorText: string }>;
    expect(coded.errorText).toBe('{"code":"E_TIMEOUT"}');
  });
});

describe("B1 · a stored tool part never carries a value Postgres jsonb rejects", () => {
  // jsonb refuses a lone surrogate (\ud83d) and \u0000; one would fail the row insert and lose the
  // whole reply. lib/ai/tools/brain.ts builds excerpts with .slice(0, 600), which can split an emoji.
  const broken = "ok \ud83d then \u0000 end";
  it("repairs lone surrogates and drops NUL, in values and keys, in output, input and errorText", () => {
    const turn = {
      steps: [
        {
          toolCalls: [{ toolCallId: "s1", toolName: "searchMemories", input: { q: broken } }, { toolCallId: "s2", toolName: "getTasks", input: {} }],
          toolResults: [{ toolCallId: "s1", toolName: "searchMemories", input: { q: broken }, output: { excerpt: broken, [`k${broken}`]: [broken] } }],
          content: [{ type: "tool-error", toolCallId: "s2", toolName: "getTasks", error: new Error(broken) }],
        },
      ],
    };
    const parts = toolPartsFromSteps(turn);
    // Every key and string value in what would be written, checked as characters, not as escapes.
    const strings: string[] = [];
    JSON.stringify(parts, (key, v) => {
      if (key) strings.push(key);
      if (typeof v === "string") strings.push(v);
      return v;
    });
    expect(strings.length).toBeGreaterThan(5); // positive control: the walk saw the values
    const bad = strings.filter((s) => !s.isWellFormed() || s.includes(String.fromCharCode(0)));
    expect(bad).toEqual([]);
    expect(parts.flatMap((p) => Object.keys((p as { output?: object }).output ?? {}))).toEqual(["excerpt", "kok � then  end"]);
  });
});
