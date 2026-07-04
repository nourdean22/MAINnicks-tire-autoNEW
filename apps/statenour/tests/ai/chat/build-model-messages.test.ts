/**
 * Regression · buildModelMessages must NOT replay assistant reasoning
 * parts (2026-07-04 prod incident, surface api/ai/chat).
 *
 * Live failure: AI_APICallError "Invalid Responses API request",
 * code invalid_prompt — the Responses API's input union rejected a
 * replayed assistant reasoning part ("expected string, received
 * array" on one branch; type "reasoning"/"reasoning_text" with
 * "summary: expected array, received undefined" on the other).
 * isRetryable:false, no stream-path fallback → every subsequent turn
 * of the conversation failed identically (poison-pill history).
 *
 * Root cause: the v10.0.529.58 item_reference sanitizer whitelist
 * included "reasoning", so reasoning parts persisted from earlier
 * assistant turns (reasoning-capable models, e.g. ollama gpt-oss)
 * were replayed on every request. This suite pins the fix: replayed
 * history must come out of buildModelMessages with ZERO reasoning
 * parts, and a reasoning-only assistant turn must collapse to the
 * existing empty-text shape instead of an empty content array.
 *
 * Note: buildModelMessages runs once per request, BEFORE streamText
 * (route.ts ~line 900) — it only sees request history. Same-turn
 * multi-step reasoning never passes through here, so stripping is
 * safe for reasoning-capable providers.
 */
import { describe, it, expect } from "vitest";
import { buildModelMessages } from "@/app/api/ai/chat/build-model-messages";

const silentLog = { error: () => {} };

/**
 * Drive the sanitizer through the compression branch so the exact
 * model-message content shapes below hit the whitelist unmodified
 * (the non-compressed branch runs convertToModelMessages first,
 * which has its own UIMessage-shape opinions — the sanitizer walks
 * whatever comes out either way).
 */
function sanitize(messages: Array<{ role: string; content: unknown }>) {
  return buildModelMessages({
    compression: { compressed: true, messages },
    messages: [],
    log: silentLog,
  });
}

function collectPartTypes(messages: unknown[]): string[] {
  const types: string[] = [];
  for (const msg of messages as Array<{ content?: unknown }>) {
    if (!Array.isArray(msg?.content)) continue;
    for (const part of msg.content as Array<{ type?: string }>) {
      if (typeof part?.type === "string") types.push(part.type);
    }
  }
  return types;
}

describe("buildModelMessages · replayed reasoning parts (2026-07-04 Responses API 400)", () => {
  it("strips reasoning parts from a replayed assistant turn, keeping the text", async () => {
    const out = await sanitize([
      { role: "user", content: [{ type: "text", text: "wtf" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "chain of thought from gpt-oss" },
          { type: "text", text: "Here is the actual reply." },
        ],
      },
      { role: "user", content: [{ type: "text", text: "?" }] },
    ]);

    expect(collectPartTypes(out)).not.toContain("reasoning");
    const assistant = (out as Array<{ role?: string; content?: unknown }>).find(
      (m) => m.role === "assistant",
    );
    expect(assistant?.content).toEqual([
      { type: "text", text: "Here is the actual reply." },
    ]);
  });

  it("collapses a reasoning-ONLY assistant turn to the empty-text shape", async () => {
    const out = await sanitize([
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "pure reasoning, no reply text" }],
      },
    ]);

    const assistant = (out as Array<{ role?: string; content?: unknown }>)[0];
    // Same collapse the item_reference path uses: never an empty
    // content array (providers 400 on empty turns), never reasoning.
    expect(assistant.content).toEqual([{ type: "text", text: "" }]);
  });

  it("still strips item_reference parts (original v10.0.529.58 behavior intact)", async () => {
    const out = await sanitize([
      {
        role: "assistant",
        content: [
          { type: "item_reference", id: "msg_abc123" },
          { type: "text", text: "tool continuation reply" },
        ],
      },
    ]);

    const types = collectPartTypes(out);
    expect(types).not.toContain("item_reference");
    expect(types).toContain("text");
  });

  it("keeps text/image/file/tool-call/tool-result parts untouched", async () => {
    const content = [
      { type: "text", text: "look" },
      { type: "image", image: "data:image/png;base64,AAAA", mediaType: "image/png" },
      { type: "file", data: "data:application/pdf;base64,BBBB", mediaType: "application/pdf" },
      { type: "tool-call", toolCallId: "t1", toolName: "getRevenue", input: {} },
      { type: "tool-result", toolCallId: "t1", toolName: "getRevenue", output: { ok: true } },
    ];
    const out = await sanitize([{ role: "assistant", content }]);
    expect((out as Array<{ content?: unknown }>)[0].content).toEqual(content);
  });
});
