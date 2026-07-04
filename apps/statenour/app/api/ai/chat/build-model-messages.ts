/**
 * buildModelMessages · chat-route extract (2026-05-31)
 *
 * Lifted VERBATIM from app/api/ai/chat/route.ts (the model-message
 * preparation block, original lines 1496-1600). Runs after prompt
 * assembly and BEFORE the streamText config is built. Pure transform —
 * no stream coupling, no closures over caller state. Owns:
 *
 *   1. Compression branch · when the conversation hit the compression
 *      threshold, use the precomputed compact messages; otherwise run
 *      AI-SDK convertToModelMessages with a hand-rolled fallback mapper
 *      (v10.0.185 media-type resolution for image/file parts) that
 *      kicks in if convertToModelMessages throws.
 *   2. item_reference sanitizer (v10.0.529.58) · walk the converted
 *      messages and strip any content part whose .type isn't in the
 *      chat-completions-safe whitelist (text/image/file/tool-call/
 *      tool-result). Drops the item_reference parts that
 *      Venice/Ollama/OpenAI chat-completions endpoints 400 on. Fully-
 *      filtered messages collapse to a single empty text part so the
 *      provider doesn't reject an empty turn.
 *      2026-07-04 · the whitelist also defends the OpenAI Responses
 *      API against replayed reasoning items: "reasoning" was removed
 *      after a prod invalid_prompt 400 (invalid_union: "expected
 *      string, received array" / reasoning item "summary: expected
 *      array, received undefined") poisoned a conversation — persisted
 *      assistant reasoning parts replayed on every turn are converted
 *      by the Responses API into strict `reasoning` input items the
 *      stored shape can't satisfy. History replay never needs the
 *      chain-of-thought; same-turn multi-step reasoning does not pass
 *      through here (this runs once, before streamText).
 *
 * Returns the sanitized model-message array. The caller casts it to the
 * AI-SDK `messages` param shape at the streamText call site (unchanged).
 */

import { convertToModelMessages } from "ai";
import { resolveMediaType } from "@/lib/ai/chat/message-fields";
import { sanitizeError } from "@/lib/utils/sanitize-error";

interface ChatLogger {
  error(event: string, ctx?: Record<string, unknown>): void;
}

export interface BuildModelMessagesInput {
  /**
   * Compression result from the parallel prefetch step. When
   * `compressed` is true, `messages` already holds the compact
   * { role, content } summary array and convertToModelMessages is
   * skipped.
   */
  compression: { compressed: boolean; messages: unknown[] };
  /** The raw UIMessage array from the request body (gate-validated). */
  messages: Array<Record<string, unknown>>;
  log: ChatLogger;
}

export async function buildModelMessages(
  input: BuildModelMessagesInput,
): Promise<unknown[]> {
  const { compression, messages, log } = input;

  // Use compressed messages if the conversation hit the compression
  // threshold. For short conversations this is the original message
  // array unchanged.
  const modelMessages = compression.compressed
    ? compression.messages
    : await convertToModelMessages(
        messages as unknown as Parameters<typeof convertToModelMessages>[0],
      ).catch((err) => {
        log.error("convert_to_model_messages_failed", { err: sanitizeError(err) });
        return messages.map((m: any) => {
          const parts = m.parts || [];
          const hasImages = parts.some((p: any) => p?.type === "image" || p?.type === "file");
          if (hasImages) {
            const content: any[] = [];
            for (const part of parts) {
              if (part?.type === "text" && part?.text) {
                content.push({ type: "text", text: part.text });
                continue;
              }
              // AI SDK v6 UIMessage shape — { type: "file", mediaType, url }.
              // `url` is a data-URL (data:image/png;base64,...) or http(s).
              // Images and other files both use the same part type in v6.
              if (part?.type === "file") {
                // v10.0.185 · always resolve mediaType (never undef).
                // Pre-fix this branch let `mediaType: undefined`
                // through to streamText, triggering the AI SDK's
                // "'file part media type ' functionality not
                // supported" error every time. resolveMediaType()
                // tries part.mediaType → part.mimeType → data-URL
                // prefix → "application/octet-stream" as last resort.
                const url: string | undefined = part.url;
                const media = resolveMediaType(part, url);
                if (url && media.startsWith("image/")) {
                  content.push({ type: "image", image: url, mediaType: media });
                } else if (url) {
                  content.push({ type: "file", data: url, mediaType: media });
                } else if (part.data) {
                  // v4/v5 legacy shape — kept for any queued messages
                  // that predate the v6 upgrade.
                  content.push({ type: "file", data: part.data, mediaType: media });
                }
                continue;
              }
              // v4/v5 "image" part type — still seen in older persisted
              // conversations. Translate to v6 content shape.
              if (part?.type === "image" && part?.image) {
                content.push({
                  type: "image",
                  image: part.image,
                  mediaType: resolveMediaType(part, part.image),
                });
              }
            }
            return { role: m.role as "user" | "assistant", content };
          }
          return {
            role: m.role as "user" | "assistant",
            content:
              typeof m.content === "string"
                ? m.content
                : Array.isArray(parts)
                  ? parts.filter((p: any) => p?.type === "text").map((p: any) => p.text).join(" ")
                  : JSON.stringify(m.content ?? parts ?? ""),
          };
        });
      });

  // v10.0.529.58 · ITEM_REFERENCE SANITIZER · 43 failed assistant
  // replies in 24h with 'input[N]: unknown input item type:
  // "item_reference"' against Ollama Cloud's /v1/chat/completions.
  // Root cause: AI SDK v6's convertToModelMessages emits item_reference
  // parts for tool-call continuations in multi-step flows · OpenAI's
  // Responses API accepts these · Chat Completions endpoints (Venice ·
  // Ollama · OpenAI chat-compat) reject them as unknown types.
  // Fix: walk modelMessages · strip part objects whose .type is not
  // in the chat-completions-safe whitelist. Preserves text · image ·
  // file · tool-call · tool-result · drops item_reference (and any
  // future unknown types). Idempotent · adds <1ms per turn.
  // 2026-07-04 · "reasoning" REMOVED from the whitelist. Replayed
  // assistant reasoning parts (persisted by reasoning-capable models,
  // e.g. ollama gpt-oss) 400 the OpenAI Responses API on every
  // subsequent turn: invalid_prompt / invalid_union — "expected
  // string, received array" and reasoning item "summary: expected
  // array, received undefined". isRetryable:false → poison-pill
  // conversation. Stripping is safe: this function only sees request
  // history (runs once, pre-streamText), so same-turn multi-step
  // reasoning is unaffected.
  const CHAT_COMPLETIONS_SAFE_TYPES = new Set([
    "text",
    "image",
    "file",
    "tool-call",
    "tool-result",
  ]);
  const sanitizedModelMessages = (() => {
    const src = modelMessages as Array<{ role?: string; content?: unknown }>;
    if (!Array.isArray(src)) return modelMessages;
    return src.map((msg) => {
      if (!msg || typeof msg !== "object") return msg;
      const content = msg.content;
      if (!Array.isArray(content)) return msg;
      const filtered = content.filter((part: unknown) => {
        if (!part || typeof part !== "object") return true;
        const t = (part as { type?: string }).type;
        return typeof t !== "string" || CHAT_COMPLETIONS_SAFE_TYPES.has(t);
      });
      if (filtered.length === content.length) return msg;
      // Drop messages whose content array got fully filtered out · they
      // were 100% stripped types (item_reference, or reasoning-only
      // assistant turns) and have no body left to send. Otherwise the
      // provider would 400 on an empty user/assistant turn.
      if (filtered.length === 0) {
        return { ...msg, content: [{ type: "text", text: "" }] };
      }
      return { ...msg, content: filtered };
    });
  })();

  return sanitizedModelMessages as unknown[];
}
