/**
 * get-message-meta · v10.0.281 · typed accessor for runtime-injected
 * meta fields on a chat UIMessage.
 *
 * The /chat page reads telemetry fields (latencyMs, costCents,
 * provider, streamingState, errorDetails, etc.) that the AI SDK's
 * UIMessage type doesn't surface · they're populated server-side and
 * arrive as untyped extras. Inline access required:
 *   const meta = msg as unknown as MessageInfoCardData & { ... };
 *
 * Two escape-cast sites in app/(mastery)/chat/page.tsx (lines ~1571,
 * ~2252) had near-identical shapes. Centralized here so:
 *   · The unsafe cast lives at the function boundary, once
 *   · Both call sites become `const meta = getMessageMeta(msg);`
 *   · Future telemetry-shape changes only touch this file + the
 *     MessageInfoCardData definition it extends
 *
 * Pattern parallel to lib/chat/extract-message-text.ts.
 */
import type { MessageInfoCardData } from "@/components/chat/message-info-card";

export type ChatMessageMeta = MessageInfoCardData & {
  errorDetails?: {
    message?: string;
    provider?: string;
    retryable?: boolean;
  } | null;
};

/**
 * Returns the runtime meta fields on a chat message as a typed object.
 * The unsafe cast happens here (single cast from `unknown`) so call
 * sites stay clean.
 */
export function getMessageMeta(msg: unknown): ChatMessageMeta {
  return msg as ChatMessageMeta;
}
