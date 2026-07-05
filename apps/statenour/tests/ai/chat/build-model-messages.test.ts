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

  it("DROPS a reasoning-ONLY assistant turn entirely (hollow turns never replay)", async () => {
    const out = await sanitize([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [{ type: "reasoning", text: "pure reasoning, no reply text" }],
      },
    ]);

    // 2026-07-04 audit: the old collapse-to-empty-text substitute was
    // itself a poison shape — an empty text item in a Responses `input`
    // union is a classic invalid_union trigger. Hollow turns get dropped.
    expect((out as unknown[]).length).toBe(1);
    expect((out as Array<{ role?: string }>)[0].role).toBe("user");
  });

  it("DROPS the hydrated empty-text assistant turn (the live poison shape)", async () => {
    // use-conversations.ts hydration fabricates {type:'text',text:''} for
    // assistant rows persisted with content:"" (tool-call-only turns) —
    // the exact shape replayed on every turn of the poisoned conversation.
    const out = await sanitize([
      { role: "user", content: [{ type: "text", text: "wtf" }] },
      { role: "assistant", content: [{ type: "text", text: "" }] },
      { role: "user", content: [{ type: "text", text: "?" }] },
    ]);

    const roles = (out as Array<{ role?: string }>).map((m) => m.role);
    expect(roles).toEqual(["user", "user"]);
  });

  it("DROPS a compressed-path assistant turn with empty STRING content (2026-07-05 audit)", async () => {
    // conversation-compress.ts maps recent tool-only/empty turns via
    // extractText, which returns "" — STRING content (not an array). That
    // bypassed pass 3's hollow scrub (which only walked arrays) and reached
    // streamText; some providers 400 on empty assistant content. The string
    // branch now gets the same hollow protection as the array branch.
    const out = await sanitize([
      { role: "user", content: "wtf" },
      { role: "assistant", content: "" },
      { role: "user", content: "?" },
    ]);
    const roles = (out as Array<{ role?: string }>).map((m) => m.role);
    expect(roles).toEqual(["user", "user"]);
  });

  it("DROPS a whitespace-only STRING assistant turn but KEEPS real string content", async () => {
    const out = await sanitize([
      { role: "user", content: "hi" },
      { role: "assistant", content: "   \n  " }, // whitespace-only → hollow
      { role: "assistant", content: "real reply" }, // real → survives
    ]);
    const kept = (out as Array<{ role?: string; content?: unknown }>);
    expect(kept.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(kept[1].content).toBe("real reply");
  });

  it("strips ORPHANED tool-calls (no matching tool-result) but keeps paired ones", async () => {
    // A stream that died mid-tool-call persists the call with no result;
    // replaying it 400s strict endpoints. Paired call/result must survive.
    const out = await sanitize([
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "orphan-1", toolName: "bookSlot", input: {} },
          { type: "text", text: "let me check that" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "paired-1", toolName: "getRevenue", input: {} },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "paired-1", toolName: "getRevenue", output: { ok: true } },
          { type: "tool-result", toolCallId: "orphan-2", toolName: "ghost", output: {} },
        ],
      },
    ]);

    const ids = (out as Array<{ content?: Array<{ type?: string; toolCallId?: string }> }>)
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((p) => p.type === "tool-call" || p.type === "tool-result")
      .map((p) => p.toolCallId);
    expect(ids.sort()).toEqual(["paired-1", "paired-1"]);
    // The first assistant turn keeps its text after losing the orphan call.
    const first = (out as Array<{ content?: unknown }>)[0];
    expect(first.content).toEqual([{ type: "text", text: "let me check that" }]);
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
