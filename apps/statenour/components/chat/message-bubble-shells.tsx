"use client";

import * as React from "react";
import { useLongPress } from "@/components/chat/use-long-press";
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
 * bubble text) and add the long-press → MessageActionSheet drawer
 * gesture. React.memo prevents re-renders on every composer keystroke
 * + every streaming token, which would otherwise re-render the
 * entire history stack.
 */

/**
 * UserMessageBubble — user-side message bubble with long-press
 * support. Tap = existing edit behavior. Long-press = open the
 * MessageActionSheet bottom drawer.
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
  onLongPress,
}: {
  text: string;
  onClick: () => void;
  onLongPress: () => void;
}) {
  const lp = useLongPress({ onLongPress, onClick, holdMs: 450 });
  return (
    <span
      {...lp}
      // 2026-07-06 bug fix · was `select-none`, which blocked desktop
      // drag-select + Ctrl+C on the user's own messages (assistant text is
      // already selectable — this makes them consistent). useLongPress cancels
      // on >8px pointer movement, so a drag-to-select doesn't trip the
      // long-press action sheet.
      className="cursor-pointer select-text"
      title="Tap to edit · long-press for actions"
      style={{ touchAction: "manipulation" }}
    >
      {text}
    </span>
  );
});

/**
 * AssistantMessageShell — wraps a NickMessage with:
 *   • long-press bottom-sheet for Copy / Pin / Save-as-belief /
 *     Save-as-decision (phone-first)
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
  onLongPress,
  contextBlocks,
  quality,
  citations,
  onRegen,
}: {
  children: React.ReactNode;
  text: string;
  messageId?: string;
  onLongPress: () => void;
  contextBlocks?: ContextBlocks;
  quality?: QualityPayload;
  citations?: Array<{ raw: string; category: string; detail?: string; start?: number; end?: number }>;
  onRegen?: () => void;
}) {
  const lp = useLongPress({ onLongPress, holdMs: 450 });
  return (
    <div {...lp} style={{ touchAction: "manipulation" }}>
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
