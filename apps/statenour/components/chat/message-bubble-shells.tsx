"use client";

import * as React from "react";
import { ContextBlockBadges, type ContextBlocks } from "@/components/chat/context-block-badges";
import { MessageDiagnostics } from "@/components/chat/message-diagnostics";
import { type QualityPayload } from "@/components/chat/quality-bar";

/**
 * Message-bubble shells used by the /chat messages list.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · these two
 * memo'd components lived at the bottom of the page file along with
 * the small `extract*` helpers. Moving them into their own module
 * keeps the page focused on render + state · and the memo bail-out
 * semantics live next to the only consumers that need them.
 *
 * Both wrap a longer-running content surface (markdown render, user
 * bubble text). Long-press is left to iOS text selection; the action
 * sheet opens from the visible More button (2026-10-29). React.memo
 * prevents re-renders on every composer keystroke + every streaming
 * token, which would otherwise re-render the entire history stack.
 */

/**
 * UserMessageBubble — user-side message text. Tap = edit-resend;
 * hold = the native iOS text selection (Copy).
 *
 * Wrapped in React.memo: a long conversation has N user bubbles
 * and none of them change once rendered — but every keystroke in
 * the composer re-renders the chat page, which would re-render all
 * N bubbles × N tokens during a stream. The memo means bubbles only
 * re-render when their own text/handlers actually change. O(active)
 * instead of O(N × tokens).
 */
export const UserMessageBubble = React.memo(function UserMessageBubble({
  text,
  onClick,
}: {
  text: string;
  onClick: () => void;
}) {
  return (
    <span
      // 2026-10-29 · a plain click, no long-press timer: the old 450 ms timer
      // opened the action sheet before iOS's own selection hold, so text could
      // not be copied. A click that ends a drag or a selection is a copy.
      onClick={() => {
        if (window.getSelection()?.isCollapsed === false) return;
        onClick();
      }}
      className="cursor-pointer select-text [-webkit-touch-callout:default]"
      title="Tap to edit · hold to select text"
      style={{ touchAction: "manipulation" }}
    >
      {text}
    </span>
  );
});

/**
 * AssistantMessageShell — wraps a NickMessage with:
 *   • selectable text (a hold is the native iOS selection)
 *   • ContextBlockBadges underneath showing which brain blocks fed
 *     the reply (tokenUsage.contextBlocks on persisted messages)
 *
 * Wraps instead of refactoring the 335-line NickMessage so the
 * markdown render pipeline stays untouched.
 *
 * Wrapped in React.memo for the same reason as UserMessageBubble:
 * finished assistant messages are static, but without memo every
 * keystroke during composing + every streaming token on the active
 * reply re-renders the entire history stack. Streamdown already
 * memoizes per-block internally; this memo prevents the shell
 * (ContextBlockBadges + CitationPills + QualityBar) from tearing
 * down and re-mounting on each parent update.
 */
export const AssistantMessageShell = React.memo(function AssistantMessageShell({
  children,
  contextBlocks,
  quality,
  citations,
  onRegen,
}: {
  children: React.ReactNode;
  text: string;
  messageId?: string;
  contextBlocks?: ContextBlocks;
  quality?: QualityPayload;
  citations?: Array<{ raw: string; category: string; detail?: string; start?: number; end?: number }>;
  onRegen?: () => void;
}) {
  // No long-press handler: a hold is iOS text selection (2026-10-29). The
  // action sheet opens from the More button under the reply.
  return (
    <div className="select-text [-webkit-touch-callout:default]" style={{ touchAction: "manipulation" }}>
      {children}
      <ContextBlockBadges blocks={contextBlocks} />
      {/* v10.0.161 · diagnostic strip — Citation + Quality on ONE row
          instead of two. Renders nothing when both clean. */}
      <MessageDiagnostics
        citations={citations}
        quality={quality}
        onRegen={onRegen}
      />
    </div>
  );
});
