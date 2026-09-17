/**
 * What `ChatMessage.parts` actually contains — pinned, because the schema
 * comment claimed six variants for months while the writer produced two.
 *
 * MEASURED IN PRODUCTION 2026-09-17: of 5,278 chat_messages, 5,175 have an
 * array-valued `parts`, and the only part types present anywhere are `text`
 * (5,171) and `file` (31). Zero `reasoning`, `tool-call`, `tool-result` or
 * `source` — ever.
 *
 * THE SHAPE OF THE DEFECT. Not a missing reader — a missing WRITER, with three
 * consumers already built for what is never produced:
 *   · `extractParts` handles all six correctly;
 *   · `build-model-messages.ts` whitelists and PAIRS tool-call/tool-result in
 *     replayed history, hardened by a real 2026-07-04 poison-pill incident;
 *   · `chat-message-list.tsx` renders ToolResultCard from LIVE streaming parts,
 *     so tool cards appear during a turn and vanish on reload.
 *
 * This file therefore pins BOTH halves: that the extractor still accepts all
 * six (so nobody "simplifies" it away and closes the path for good), and that
 * the producer emits only the two it really emits. The second assertion is
 * deliberately written to FAIL the day someone adds a writer — at which point
 * the schema comment must be updated in the same change. A doc that can rot
 * silently is what created this.
 */
import { describe, it, expect } from "vitest";
import { extractParts } from "@/lib/ai/chat/message-fields";
import { buildMessageParts } from "@/lib/services/chat/message-parts";

describe("extractParts · the CONSUMER supports all six variants", () => {
  it("round-trips every documented part type", () => {
    // If this narrows, the persistence path is closed off permanently and the
    // three consumers above become unfixable without re-adding it.
    const out = extractParts([
      { type: "text", text: "hello" },
      { type: "file", url: "https://x/y.png", mediaType: "image/png" },
      { type: "reasoning", text: "thinking" },
      { type: "tool-call", toolName: "getTasks", toolCallId: "c1", args: { a: 1 } },
      { type: "tool-result", toolName: "getTasks", toolCallId: "c1", result: { ok: true } },
      { type: "source", url: "https://src", title: "Src" },
    ]);
    expect(out?.map((p) => p.type)).toEqual([
      "text",
      "file",
      "reasoning",
      "tool-call",
      "tool-result",
      "source",
    ]);
  });

  it("POSITIVE CONTROL: it rejects junk rather than passing everything through", () => {
    // Without this, an extractor that echoed its input would satisfy the test
    // above while proving nothing about the type handling.
    expect(extractParts([{ type: "nonsense", text: "x" }])).toEqual(null);
    expect(extractParts([{ type: "tool-call" }])).toEqual(null); // no toolName
  });
});

describe("buildMessageParts · the PRODUCER emits only text and reasoning", () => {
  it("emits a text part", async () => {
    const { partsArray } = await buildMessageParts("hello");
    expect(partsArray?.map((p) => p.type)).toEqual(["text"]);
  });

  it("emits reasoning only when there is non-whitespace reasoning text", async () => {
    expect((await buildMessageParts("hi", "   ")).partsArray?.map((p) => p.type)).toEqual(["text"]);
    expect((await buildMessageParts("hi", "because")).partsArray?.map((p) => p.type)).toEqual([
      "text",
      "reasoning",
    ]);
  });

  it("PINS THE GAP: it has no parameter for tool or source parts at all", async () => {
    // The producer's own signature is the proof — it takes (text, reasoning,
    // alwaysIncludeText) and nothing else, so no caller CAN supply a tool part.
    // `length` counts parameters before the first default, hence 2.
    expect(buildMessageParts.length).toBe(2);

    // And nothing it returns is ever a tool/source part, whatever it is given.
    const { partsArray } = await buildMessageParts("a turn that called tools", "reasoned");
    const types = new Set(partsArray?.map((p) => p.type));
    for (const absent of ["tool-call", "tool-result", "source"]) {
      expect(
        types.has(absent as never),
        `buildMessageParts now emits "${absent}" — GOOD, but prisma/schema.prisma's ` +
          `parts comment and this test both describe the old two-variant reality ` +
          `and must be updated in the same change.`,
      ).toBe(false);
    }
  });
});
