"use client";

import { ActionClaimWarning } from "@/components/chat/action-claim-warning";
import { extractMessageText } from "@/lib/chat/extract-message-text";

/**
 * SmartRepliesCluster — three follow-up surfaces that mount under
 * the LATEST assistant message once a stream completes:
 *   1. ActionClaimWarning — when Nick claimed a side effect but the
 *      envelope shows zero tools fired (Bay 5 Revive case)
 *   2. LaneCorrectionChip — when the assistant reply drifted off-lane
 *   3. SmartReplies — 3 tap-to-send follow-up chips
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~53 LOC of
 * inline IIFE that walked the message list to find the
 * last-assistant + previous-user pair, then mounted the three
 * surfaces. The walker now lives inside this component · the parent
 * passes the deduped message list + the input-is-empty hint.
 */
type ChatMessage = {
  id?: string;
  role: string;
  parts?: Array<{ type: string; text?: string }>;
};

export function SmartRepliesCluster({
  messages,
  isStreaming,
  activeConversationId,
  inputIsEmpty,
  onPick,
}: {
  /** Deduped message list · parent should pass dedupedAll. */
  messages: ChatMessage[];
  isStreaming: boolean;
  activeConversationId: string | null;
  inputIsEmpty: boolean;
  onPick: (suggestion: string) => void;
}) {
  if (isStreaming) return null;
  const lastIdx = messages.length - 1;
  const last = messages[lastIdx];
  if (!last || last.role !== "assistant" || !last.id) return null;
  // Extract text from the last assistant msg's text parts.
  const assistantText = extractMessageText(last);
  if (!assistantText) return null;
  // Find the most recent user message BEFORE this assistant reply.
  let userText = "";
  for (let i = lastIdx - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    userText = extractMessageText(m);
    break;
  }
  return (
    <>
      {/* v10.0.160 · action-claim warning — surfaces FIRST (before
          lane-correction) when Nick claimed a side effect but the
          envelope shows zero tools fired. Diagnosed live via Bay 5
          Revive case. Hidden when Nour is mid-typing or no
          conversationId yet. */}
      {activeConversationId && (
        <ActionClaimWarning
          conversationId={activeConversationId}
          messageId={last.id}
          hidden={!inputIsEmpty}
        />
      )}
    </>
  );
}
