/**
 * The tool failure that is actually still happening is an ARGUMENT failure.
 *
 * WHAT PROD SHOWED. `scripts/tool-input-failure-census.ts` classified every
 * string in `tool_telemetry.lastErrors` and then split each class by whether
 * the tool had been called in the last 14 days — because `lastErrors` never
 * ages out, and ranking without that split had just crowned `createTask`
 * errors that `lib/ai/tools/tasks.ts:160-162` records as fixed on 2026-09-03.
 * With the split: **LIVE argument 11, LIVE name 1**, and all 11 are one shape,
 * several tool calls glued into a single arguments string.
 *
 * The two payloads below are verbatim from that census, not invented.
 *
 * WHAT THIS FILE GUARDS, and it has to cut both ways:
 *   · concatenated calls ARE salvaged, first-intent-wins
 *   · a clean single object is NOT — that is a genuine type error and
 *     repairing it would mean guessing at intent
 *   · nothing is returned that fails the tool's own schema, when one is given
 *   · the NAME lane is untouched
 *
 * The quote-awareness test is a mutation canary, not decoration: with a
 * quote-blind scanner that one case returns ZERO candidates instead of two, so
 * it fails loudly if the string handling is ever "simplified" away.
 */
import { describe, it, expect, vi } from "vitest";
import { InvalidToolInputError, NoSuchToolError, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Spread the REAL logger and override only `info`. A hand-written stub would
 * silently drop whatever the logger gains next, and the call would then land as
 * `undefined` — which reads as "the salvage never fired" rather than "the mock
 * is incomplete". Same trap the tool-embeddings mocks in the sibling chat-mode
 * files document.
 */
// `vi.hoisted`, not a bare const: vi.mock factories are hoisted ABOVE
// module-scope declarations, so a plain `const logInfo = vi.fn()` is still in
// the temporal dead zone when the factory runs and the whole file fails to
// collect with "Cannot access 'logInfo' before initialization".
const { logInfo } = vi.hoisted(() => ({ logInfo: vi.fn() }));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    logger: {
      ...actual.logger,
      withSurface: (s: string) => ({ ...actual.logger.withSurface(s), info: logInfo }),
    },
  };
});

import { buildRepairToolCall } from "@/lib/ai/chat/repair-tool-call";
import { salvageToolInput, splitTopLevelJson } from "@/lib/ai/chat/salvage-tool-input";

/** Verbatim from tool_telemetry.lastErrors, searchMemories, last called 6d ago. */
const PROD_THREE_OBJECTS =
  '{"query":"master prompt identity patterns","limit":5}{}{"limit":5,"scope":"all","onlyActionable":true}';
const PROD_TWO_OBJECTS =
  '{"query":"master prompt identity patterns reframe rules","limit":10}' +
  '{"query":"operator system prompt bdnick brain wiring","limit":10}';

function inputErrorFor(toolName: string, toolInput: string) {
  return new InvalidToolInputError({
    toolName,
    toolInput,
    cause: new Error("JSON parsing failed"),
  });
}

function call(toolName: string, input: string) {
  return { toolCallId: "tc-1", toolName, input, type: "tool-call" as const };
}

describe("splitTopLevelJson", () => {
  it("splits concatenated objects", () => {
    expect(splitTopLevelJson(PROD_TWO_OBJECTS)).toHaveLength(2);
    expect(splitTopLevelJson(PROD_THREE_OBJECTS)).toHaveLength(3);
  });

  it("returns a clean single object unchanged, as one candidate", () => {
    const one = '{"query":"hello","limit":5}';
    expect(splitTopLevelJson(one)).toEqual([one]);
  });

  // MUTATION CANARY. A quote-blind scanner sees the `{` inside the string,
  // never returns to depth 0, and yields ZERO candidates. Balanced braces
  // inside a string would NOT catch that, which is why this case is unbalanced.
  it("ignores braces inside string literals (canary: quote-blind scan returns 0)", () => {
    const parts = splitTopLevelJson('{"q":"a { b"}{"q":"z"}');
    expect(parts).toEqual(['{"q":"a { b"}', '{"q":"z"}']);
  });

  it("ignores escaped quotes inside string literals", () => {
    const parts = splitTopLevelJson('{"q":"say \\"hi\\" {"}{"q":"z"}');
    expect(parts).toHaveLength(2);
    expect(JSON.parse(parts[0])).toEqual({ q: 'say "hi" {' });
  });

  it("finds nothing in a string with no complete JSON value", () => {
    expect(splitTopLevelJson("not json at all")).toEqual([]);
    expect(splitTopLevelJson('{"unterminated":')).toEqual([]);
  });
});

describe("salvageToolInput", () => {
  it("recovers the FIRST call from the real 2-object prod payload", () => {
    const out = salvageToolInput(PROD_TWO_OBJECTS);
    expect(out).not.toBeNull();
    expect(JSON.parse(out!.input)).toEqual({
      query: "master prompt identity patterns reframe rules",
      limit: 10,
    });
    expect(out!.index).toBe(0);
    expect(out!.candidates).toBe(2);
  });

  it("recovers the FIRST call from the real 3-object prod payload", () => {
    const out = salvageToolInput(PROD_THREE_OBJECTS);
    expect(JSON.parse(out!.input)).toEqual({
      query: "master prompt identity patterns",
      limit: 5,
    });
  });

  it("skips a candidate the tool's schema rejects and takes the next", () => {
    const schema = z.object({ query: z.string() });
    const out = salvageToolInput('{}{"query":"good"}', (v) => schema.safeParse(v).success);
    expect(JSON.parse(out!.input)).toEqual({ query: "good" });
    expect(out!.index).toBe(1);
  });

  // ── Canaries: every one of these MUST decline ──────────────────────────
  it("DECLINES a clean single object — that is a type error, not this defect", () => {
    expect(salvageToolInput('{"query":"hi","limit":"ten"}')).toBeNull();
  });

  it("DECLINES empty and non-JSON input", () => {
    expect(salvageToolInput("")).toBeNull();
    expect(salvageToolInput(undefined)).toBeNull();
    expect(salvageToolInput("not json at all")).toBeNull();
  });

  it("DECLINES when the validator rejects every candidate", () => {
    const out = salvageToolInput(PROD_TWO_OBJECTS, () => false);
    expect(out).toBeNull();
  });

  it("DECLINES top-level arrays and scalars — a tool input is an object", () => {
    expect(salvageToolInput('[1,2][3,4]')).toBeNull();
  });
});

describe("buildRepairToolCall · argument lane", () => {
  const searchMemories = {
    inputSchema: z.object({
      query: z.string(),
      limit: z.number().min(1).max(50).default(10),
    }),
  };
  const toolSet = { searchMemories } as unknown as ToolSet;
  const repair = buildRepairToolCall(toolSet, new Set(["searchMemories", "getRepoMap"]));

  it("repairs the real prod payload end to end", async () => {
    const out = await repair({
      toolCall: call("searchMemories", PROD_TWO_OBJECTS),
      error: inputErrorFor("searchMemories", PROD_TWO_OBJECTS),
      tools: toolSet,
      system: undefined,
      messages: [],
      inputSchema: () => ({}),
    } as never);
    expect(out).not.toBeNull();
    expect(out!.toolName).toBe("searchMemories");
    expect(JSON.parse(out!.input)).toEqual({
      query: "master prompt identity patterns reframe rules",
      limit: 10,
    });
  });

  it("EMITS a known positive when it fires — a successful salvage is otherwise invisible", async () => {
    // Without this line the only evidence a repair ever worked is that
    // failCount stopped growing, and an absence of failures is identical to an
    // absence of traffic. Assert the event, its name, and its fields.
    logInfo.mockClear();
    await repair({
      toolCall: call("searchMemories", PROD_TWO_OBJECTS),
      error: inputErrorFor("searchMemories", PROD_TWO_OBJECTS),
      tools: toolSet,
      system: undefined,
      messages: [],
      inputSchema: () => ({}),
    } as never);
    expect(logInfo).toHaveBeenCalledWith(
      "tool_input_salvaged",
      expect.objectContaining({ tool: "searchMemories", candidates: 2, chosenIndex: 0 }),
    );
  });

  it("STAYS SILENT when it declines — the event must mean a repair, not an attempt", async () => {
    logInfo.mockClear();
    const raw = '{"limit":5}'; // single malformed object -> declined
    await repair({
      toolCall: call("searchMemories", raw),
      error: inputErrorFor("searchMemories", raw),
      tools: toolSet,
      system: undefined,
      messages: [],
      inputSchema: () => ({}),
    } as never);
    expect(logInfo).not.toHaveBeenCalledWith("tool_input_salvaged", expect.anything());
  });

  it("DECLINES an argument error for a tool the set does not hold", async () => {
    const out = await repair({
      toolCall: call("getRepoMap", PROD_TWO_OBJECTS),
      error: inputErrorFor("getRepoMap", PROD_TWO_OBJECTS),
      tools: toolSet,
      system: undefined,
      messages: [],
      inputSchema: () => ({}),
    } as never);
    expect(out).toBeNull();
  });

  it("DECLINES a single malformed object rather than guessing", async () => {
    const raw = '{"limit":5}';
    const out = await repair({
      toolCall: call("searchMemories", raw),
      error: inputErrorFor("searchMemories", raw),
      tools: toolSet,
      system: undefined,
      messages: [],
      inputSchema: () => ({}),
    } as never);
    expect(out).toBeNull();
  });

  it("leaves the NAME lane working — a NoSuchToolError still routes by name", async () => {
    const withRecovery = {
      searchMemories,
      invokeTool: {},
    } as unknown as ToolSet;
    const r = buildRepairToolCall(withRecovery, new Set(["getRepoMap"]));
    const out = await r({
      toolCall: call("getRepoMap", "{}"),
      error: new NoSuchToolError({ toolName: "getRepoMap", availableTools: ["searchMemories"] }),
      tools: withRecovery,
      system: undefined,
      messages: [],
      inputSchema: () => ({}),
    } as never);
    expect(out!.toolName).toBe("invokeTool");
  });
});
