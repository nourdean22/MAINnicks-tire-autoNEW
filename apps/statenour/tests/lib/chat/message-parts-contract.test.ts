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
import {
  buildMessageParts,
  PRODUCIBLE_PART_TYPES,
} from "@/lib/services/chat/message-parts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("PINS THE GAP: there is no parameter for tool or source parts", async () => {
    // The producer's signature is the proof: (text, reasoning, alwaysIncludeText)
    // and nothing else, so no caller CAN supply a tool part today.
    //
    // ⚠ WHAT THIS DOES **NOT** GUARANTEE, stated plainly because the first
    // version of this test promised it and was wrong: adding an optional fourth
    // `parts` argument leaves `.length` at 2 and this call supplies no tool
    // input, so a new writer would NOT fail here. A canary cannot exercise
    // behaviour that does not exist yet. The real drift guard is the
    // doc-vs-constant assertion below, which a new writer cannot satisfy
    // without also updating the schema comment.
    expect(buildMessageParts.length).toBe(2);

    const { partsArray } = await buildMessageParts("a turn that called tools", "reasoned");
    const types = new Set(partsArray?.map((p) => p.type));
    for (const absent of ["tool-call", "tool-result", "source"]) {
      expect(types.has(absent as never)).toBe(false);
    }
  });

  it("emits nothing outside PRODUCIBLE_PART_TYPES", async () => {
    const produced = new Set<string>();
    for (const [text, reasoning] of [
      ["hello", undefined],
      ["hello", "because"],
      ["", "because"],
    ] as Array<[string, string | undefined]>) {
      const { partsArray } = await buildMessageParts(text, reasoning, true);
      for (const p of partsArray ?? []) produced.add(p.type);
    }
    for (const t of produced) {
      expect(
        (PRODUCIBLE_PART_TYPES as readonly string[]).includes(t),
        `buildMessageParts emitted "${t}", which PRODUCIBLE_PART_TYPES does not list`,
      ).toBe(true);
    }
  });
});

/**
 * THE DRIFT GUARD THAT ACTUALLY BINDS.
 *
 * A behaviour canary cannot fire for a writer that does not exist yet — review
 * was right that the earlier `buildMessageParts.length` check promised exactly
 * that and could not deliver it. What CAN be enforced is that the schema
 * comment and the producer agree about which variants have a writer. Someone
 * adding tool-call persistence has to extend `PRODUCIBLE_PART_TYPES` for their
 * own code to be coherent, and this test then fails until the schema comment
 * is updated in the same change.
 *
 * It is a DOC-vs-CODE guard, not a behaviour canary, and it says so rather than
 * claiming more than it does — which is the whole failure mode this file exists
 * to document.
 */
describe("schema comment and producer agree on what has a writer", () => {
  // Strip CR without writing an escape sequence — a `\r` literal is exactly
  // what a shell heredoc mangles, and on a CRLF checkout an unnormalised read
  // makes every line-oriented assertion below line-ending dependent.
  const CR = String.fromCharCode(13);
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8").split(CR).join("");

  const block = (() => {
    const i = schema.indexOf("WHAT HAS A WRITER");
    const j = schema.indexOf("WHAT HAS NO WRITER AT ALL", i);
    expect(i, "the parts comment lost its 'WHAT HAS A WRITER' section").toBeGreaterThan(-1);
    expect(j, "the parts comment lost its 'WHAT HAS NO WRITER AT ALL' section").toBeGreaterThan(i);
    return { has: schema.slice(i, j), hasNot: schema.slice(j, j + 400) };
  })();

  it("every PRODUCIBLE type is listed as having a writer", () => {
    for (const t of PRODUCIBLE_PART_TYPES) {
      expect(
        block.has.includes(t),
        `PRODUCIBLE_PART_TYPES lists "${t}" but the schema comment does not say it has a writer`,
      ).toBe(true);
    }
  });

  it("nothing listed as writer-less is actually producible", () => {
    for (const t of ["tool-call", "tool-result", "source"]) {
      expect(
        (PRODUCIBLE_PART_TYPES as readonly string[]).includes(t),
        `the schema comment says "${t}" has no writer, but PRODUCIBLE_PART_TYPES lists it — ` +
          `update prisma/schema.prisma in the same change`,
      ).toBe(false);
      expect(block.hasNot.includes(t)).toBe(true);
    }
  });
});
