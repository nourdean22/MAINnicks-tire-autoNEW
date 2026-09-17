/**
 * lib/services/chat/message-parts.ts — persist-turn decomposition slice
 * (2026-07-25). buildMessageParts moved VERBATIM from
 * persist-assistant-turn.ts (it was an in-file helper shared by the
 * initial persist, the fabrication-rewrite patch, and the deferred
 * action-verifier patch — now importable by all three modules).
 */

import type { MessagePart } from "@/lib/ai/chat/message-fields";

/**
 * The part types this producer can emit — the ONE place that fact is stated.
 *
 * `extractParts` accepts six variants; this producer constructs three. The
 * difference is not documentation, it is the actual persistence boundary, and
 * `prisma/schema.prisma`'s `parts` comment must agree with this list.
 * `tests/lib/chat/message-parts-contract.test.ts` asserts that agreement, so a
 * writer added here without updating the schema comment fails the suite.
 *
 * `file` is included because `extractParts` converts an `image` part into one
 * and passes `file` parts through; this producer does not build them directly
 * but they reach `parts` through the same call.
 */
export const PRODUCIBLE_PART_TYPES = ["text", "file", "reasoning"] as const;

/**
 * Build the `parts` tree + flattened `searchableContent` for a persisted
 * assistant ChatMessage. Shared by the initial persist (text part guarded
 * on non-empty) and the fabrication-rewrite patch (text part always
 * present, since the rewrite banner makes it non-empty). The optional
 * `reasoningText` adds a `reasoning` part only when it has non-whitespace
 * content — identical to both original call sites.
 *
 * ⚠ THIS IS THE WHOLE PRODUCER, AND IT EMITS TWO VARIANTS. There is no
 * parameter for tool or source parts, so no caller can supply one. That is why
 * `ChatMessage.parts` has never contained a `tool-call`, `tool-result` or
 * `source` part — measured 2026-09-17 across 5,175 array-valued rows in
 * production: only `text` (5,171) and `file` (31) exist.
 *
 * It is a MISSING WRITER, not a missing reader. Three consumers are already
 * built for what never arrives: `extractParts` handles all six variants,
 * `app/api/ai/chat/build-model-messages.ts` whitelists AND PAIRS
 * tool-call/tool-result in replayed history (hardened by a real 2026-07-04
 * incident), and `chat-message-list.tsx` renders ToolResultCard from LIVE
 * streaming parts — so tool cards show during a turn and vanish on reload, and
 * a reloaded conversation replays the assistant's claims without the receipts.
 *
 * Closing it is a real change, not a one-liner: the result payload has to be
 * bounded (a raw search result on every row bloats the table AND every replayed
 * context) and two part shapes reconciled (persisted `{toolCallId, result}` vs
 * the UI's `{state, output}`). Pinned by
 * tests/lib/chat/message-parts-contract.test.ts, which fails if a writer is
 * added so the schema comment gets updated in the same change.
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
