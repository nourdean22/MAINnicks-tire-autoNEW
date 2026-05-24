"use client";

/**
 * MessageFooter — memoized per-message footer for the /chat surface.
 *
 * Extracted from app/(mastery)/chat/page.tsx (v10.0.529.20) as the #5
 * /chat audit win — and the biggest remaining perf gain. Pre-extraction
 * the footer was an inline IIFE inside the messages-list `.map((msg))`
 * body, which means `getMessageMeta(msg)` + every child component
 * reconciled on EVERY streamed token for EVERY finished message in the
 * thread. With this component wrapped in `React.memo` + the parent
 * passing stable scalar props + `useCallback`'d handlers, only the
 * actively-streaming message's footer recomputes; finished-message
 * footers bail out via shallow equality.
 *
 * Parallels the v10.0.529.14 LoopRowItem extraction that produced the
 * comparable perf win on /tasks — same pattern: lift state owner to
 * parent, pass scalars + stable callbacks, memo at the boundary.
 *
 * What the footer renders (per message):
 *   · MessageStatusBadge       — when the turn is partial/errored/aborted
 *   · MessageBranchSwitcher    — when the assistant message has siblings
 *   · MessageEditControls      — assistant-message PATCH-only edit flow
 *   · MessageInfoCard          — Batch A telemetry dropdown (i glyph)
 *   · trace deep-link          — operator-only, only on the LATEST asst
 *
 * Visual + behavior contract: 100% IDENTICAL to the pre-extraction
 * inline IIFE. No aesthetic shifts, no UX shifts. Only owner identity
 * shifts (now lives in a memoized child instead of an inline closure).
 *
 * Memo correctness:
 *   · `msg` itself is passed through — the AI SDK keeps stable refs for
 *     finished messages, so shallow equality holds for them naturally.
 *     The currently-streaming message gets a fresh ref on each token,
 *     which is the SAME message we WANT to re-render.
 *   · All other props are primitives (boolean / string | null) OR
 *     useCallback'd refs from the parent. Inline arrows at the call
 *     site would defeat the memo — DON'T add any.
 */

import { memo } from "react";
import { MessageStatusBadge } from "@/components/chat/message-status-badge";
import { MessageBranchSwitcher } from "@/components/chat/message-branch-switcher";
import { MessageEditControls } from "@/components/chat/message-edit-controls";
import { MessageInfoCard } from "@/components/chat/message-info-card";
// 2026-05-23 · UI #1 · Lens-fire transparency · shows which strategic
// lenses Nick used for THIS reply · post-hoc re-runs the (pure)
// detector against the previous user message · same answer the chat
// path got at request time.
import { LensBadgeRow } from "@/components/chat/lens-badge-row";
import { getMessageMeta } from "@/lib/chat/get-message-meta";

/**
 * Structural minimum the footer needs from a chat message. Mirrors
 * the ChatMessageLike pattern used by useChatBranchSwap — keeps this
 * component generic over the underlying AI SDK message type so a
 * future SDK upgrade doesn't ripple here.
 */
interface FooterMessage {
  id: string;
  role: string;
  parts?: Array<{ type: string; text?: string } | { type: string; [k: string]: unknown }>;
}

export interface MessageFooterProps {
  /** The chat message. Finished messages have stable refs; the
   *  streaming message gets a new ref per token — both behaviors are
   *  exactly what the memo wants. */
  msg: FooterMessage;
  /** True when this message is currently being edited (assistant edit
   *  flow). Parent derives via `editingAssistantId === msg.id`. */
  editing: boolean;
  /** True when this is the most-recent message in the thread. Drives
   *  the operator-only trace deep-link. Derived once at the parent
   *  instead of churning via `messages[messages.length - 1]?.id`. */
  isLastMessage: boolean;
  /** Current X-Trace-Id captured from the latest turn's response
   *  header. Null until the first turn lands. */
  lastTraceId: string | null;
  /** Open the inline assistant-edit editor for `id`. */
  onStartEdit: (id: string) => void;
  /** Close the assistant-edit editor. */
  onCancelEdit: () => void;
  /** Fired after a successful PATCH — parent swaps message content +
   *  editedAt in its messages array. */
  onMessageSaved: (id: string, newContent: string, editedAt: string) => void;
  /** Fired when the user picks a prior version from the history
   *  drawer — parent PATCHes the old content back in. */
  onMessageReverted: (id: string, priorContent: string) => void;
  /** Fired by MessageBranchSwitcher when the user picks a sibling.
   *  Parent dispatches the `nick-swap-branch` window event. */
  onSwapBranch: (activeId: string, siblingId: string) => void;
}

function MessageFooterImpl({
  msg,
  editing,
  isLastMessage,
  lastTraceId,
  onStartEdit,
  onCancelEdit,
  onMessageSaved,
  onMessageReverted,
  onSwapBranch,
}: MessageFooterProps) {
  const meta = getMessageMeta(msg);
  const ss = meta.streamingState as "complete" | "partial" | "errored" | "aborted" | undefined;
  const isAssistant = msg.role === "assistant";
  // Show info card only on assistant messages with any Batch A
  // telemetry populated (legacy rows missing all fields hide the icon).
  const hasInfoData =
    isAssistant &&
    (meta.provider != null ||
      meta.latencyMs != null ||
      meta.costCents != null ||
      meta.promptTokens != null ||
      meta.completionTokens != null);

  return (
    <div className="flex items-center justify-end gap-2 mt-1.5">
      {ss && ss !== "complete" && (
        <MessageStatusBadge
          state={ss}
          messageId={msg.id}
          errorDetails={meta.errorDetails ?? null}
          className="!mt-0"
        />
      )}
      {/* v7.6 · C8 · Apr 29 · Branch switcher.
          Renders only when message has siblings.
          Polls /api/ai/chat/branches/{parent}.
          Click a sibling dot or use < > to swap
          the visible message in-place. */}
      {isAssistant && meta.parentMessageId && (
        <MessageBranchSwitcher
          parentMessageId={meta.parentMessageId}
          activeId={msg.id}
          onSelect={(siblingId) => onSwapBranch(msg.id, siblingId)}
        />
      )}
      {/* v7.6 · C9 · Apr 29 · Assistant-message edit.
          Pencil icon + "edited" badge with history
          drawer. PATCH-only — does not retrigger
          regen (that's the user-msg edit flow). */}
      {isAssistant && (
        <MessageEditControls
          message={{
            id: msg.id,
            content:
              msg.parts
                ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("") ?? "",
            editedAt: (meta as { editedAt?: string | Date | null }).editedAt ?? null,
          }}
          editing={editing}
          onStartEdit={() => onStartEdit(msg.id)}
          onCancel={onCancelEdit}
          onSaved={(newContent, editedAt) => onMessageSaved(msg.id, newContent, editedAt)}
          onRevertTo={(priorContent) => onMessageReverted(msg.id, priorContent)}
        />
      )}
      {hasInfoData && (
        <MessageInfoCard
          data={{
            messageId: msg.id,
            provider: meta.provider ?? null,
            model: meta.model ?? null,
            routerReason: meta.routerReason ?? null,
            latencyMs: meta.latencyMs ?? null,
            firstTokenLatencyMs: meta.firstTokenLatencyMs ?? null,
            promptTokens: meta.promptTokens ?? null,
            completionTokens: meta.completionTokens ?? null,
            costCents: meta.costCents ?? null,
            streamingState: meta.streamingState ?? null,
            feedbackScore: meta.feedbackScore ?? null,
            attachmentsHash: meta.attachmentsHash ?? null,
            clientMessageId: meta.clientMessageId ?? null,
            parentMessageId: meta.parentMessageId ?? null,
            branchId: meta.branchId ?? null,
          }}
        />
      )}
      {/* v10.0.28 — operator-only "view trace" deep-link
          under the most-recent assistant message. The
          traceId is per-turn, not per-message, so we
          only render on the last assistant. Click to
          open /system/agent-traces filtered to that
          chain. */}
      {hasInfoData && msg.role === "assistant" && lastTraceId && isLastMessage && (
        <a
          href={`/system/agent-traces?search=${encodeURIComponent(lastTraceId)}`}
          target="_blank"
          rel="noopener"
          className="mt-1 block text-[9px] font-mono text-[var(--text-tertiary)] hover:text-[var(--gold)]/80"
          title="Open this turn in /system/agent-traces"
        >
          trace · {lastTraceId.slice(0, 12)}… →
        </a>
      )}
      {/* 2026-05-23 · UI #1 · Lens-fire badges (assistant-only, complete
       *   messages only). Component returns null when no lenses fired ·
       *   zero DOM cost when irrelevant. Streamed messages are skipped
       *   until they settle (the lens query depends on the FINAL
       *   message id matching a DB row · which only happens once the
       *   turn lands). */}
      {isAssistant && (!ss || ss === "complete") && (
        <div className="w-full">
          <LensBadgeRow messageId={msg.id} />
        </div>
      )}
    </div>
  );
}

/**
 * Memoized export. Default shallow equality is the right boundary —
 * the parent passes per-message PRIMITIVES (booleans + nullable
 * strings) and STABLE callback refs (useCallback'd in the parent).
 * A footer only re-renders when its `msg` ref flips (which the AI
 * SDK only does for the currently-streaming message) or when one of
 * its scalar props flips (editing toggle, last-message slot moves).
 *
 * If a callback prop is observed to be unstable, that's a bug at the
 * call site (parent), not at this memo boundary. The inline arrows
 * for MessageBranchSwitcher.onSelect, MessageEditControls.onStartEdit,
 * MessageEditControls.onSaved, and MessageEditControls.onRevertTo are
 * intentionally INSIDE this component — they're created fresh on each
 * inner render but the inner render only fires when memo bails OUT,
 * so they're effectively as stable as the memo boundary.
 */
export const MessageFooter = memo(MessageFooterImpl);
