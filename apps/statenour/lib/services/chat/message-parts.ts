/**
 * lib/services/chat/message-parts.ts — persist-turn decomposition slice
 * (2026-07-25). buildMessageParts moved VERBATIM from
 * persist-assistant-turn.ts (it was an in-file helper shared by the
 * initial persist, the fabrication-rewrite patch, and the deferred
 * action-verifier patch — now importable by all three modules).
 */

import type { MessagePart } from "@/lib/ai/chat/message-fields";

/**
 * Build the `parts` tree + flattened `searchableContent` for a persisted
 * assistant ChatMessage. Shared by the initial persist (text part guarded
 * on non-empty) and the fabrication-rewrite patch (text part always
 * present, since the rewrite banner makes it non-empty). The optional
 * `reasoningText` adds a `reasoning` part only when it has non-whitespace
 * content — identical to both original call sites.
 *
 * `alwaysIncludeText` flips the only behavioral difference between the two
 * sites: the initial persist pushed the text part only when cleanedText
 * was non-empty; the rewrite patch pushed it unconditionally. Default is
 * the guarded (initial-persist) behavior.
 */
export async function buildMessageParts(
  cleanedText: string,
  reasoningText?: string,
  alwaysIncludeText = false,
): Promise<{ partsArray: MessagePart[] | null; searchableContent: string | null }> {
  const { extractParts, buildSearchableContent } = await import("@/lib/ai/chat/message-fields");
  const assistantParts: Array<Record<string, unknown>> = [];
  if (alwaysIncludeText || (cleanedText && cleanedText.length > 0)) {
    assistantParts.push({ type: "text", text: cleanedText });
  }
  if (reasoningText && reasoningText.trim().length > 0) {
    assistantParts.push({ type: "reasoning", text: reasoningText });
  }
  const partsArray = extractParts(assistantParts, cleanedText);
  const searchableContent = buildSearchableContent(partsArray, cleanedText);
  return { partsArray, searchableContent };
}
