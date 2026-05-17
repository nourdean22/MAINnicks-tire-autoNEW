"use client";

import { Copy, Send, RefreshCw, Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MessageHoverActions — the desktop hover-action strip that appears
 * 4.5rem to the RIGHT of an assistant message bubble. Surfaces
 * Copy · Send-to-social · Regenerate (last message only) · Pin.
 *
 * Apr 27 · MOBILE-FLUIDITY — hidden under sm because (a) hover never
 * triggers on touch and (b) the floating strip lived 4.5rem off-screen
 * right, leaking a phantom click area near the edge swipe gesture.
 * Mobile users get the same actions via long-press → MessageActionSheet.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~55 LOC of
 * inline JSX. All handlers come from the parent · this is pure chrome.
 */
export function MessageHoverActions({
  isPinned,
  canRegenerate,
  onCopy,
  onSendToSocial,
  onRegenerate,
  onTogglePin,
}: {
  isPinned: boolean;
  /** Only show the regenerate button when this is the last message. */
  canRegenerate: boolean;
  onCopy: () => void;
  onSendToSocial: () => void;
  onRegenerate: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div className="hidden sm:flex absolute -right-[4.5rem] top-0 items-start gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={onCopy}
        className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
        title="Copy message"
        aria-label="Copy message"
      >
        <Copy size={11} />
      </button>
      {/* v10.0.276 · Send to social composer · deep-links to /social
          with caption pre-filled so chat-generated content is one tap
          from review-and-publish on IG / FB / GBP. */}
      <button
        onClick={onSendToSocial}
        className="p-1 rounded text-[var(--text-tertiary)] hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
        title="Send to /social composer (caption pre-filled)"
        aria-label="Send message to social composer"
      >
        <Send size={11} />
      </button>
      {canRegenerate && (
        <button
          onClick={onRegenerate}
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold-ghost)] transition-colors"
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          <RefreshCw size={11} />
        </button>
      )}
      <button
        onClick={onTogglePin}
        className={cn(
          "p-1 rounded transition-colors",
          isPinned
            ? "text-[var(--gold)]"
            : "text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold-ghost)]"
        )}
        title={isPinned ? "Unpin" : "Pin this insight"}
        aria-label={isPinned ? "Unpin this insight" : "Pin this insight"}
      >
        {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
      </button>
    </div>
  );
}
