"use client";

import { Send, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * ComposerSendButton — the kinetic Send / Stop morph button.
 *
 * v11.1 Tier-1 · single kinetic button that morphs between send
 * arrow and stop square. The inner <span> stack stays mounted in
 * both states — only the icon opacity/scale toggles. Makes the tap
 * feel committed: you SEE the arrow become a stop, you don't watch
 * a different-colored button replace it.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~50 LOC of
 * inline button JSX. Parent owns send() / stop() / input state and
 * passes them in via callback props + an `empty` flag.
 */
export function ComposerSendButton({
  isStreaming,
  empty,
  onSend,
  onStop,
}: {
  isStreaming: boolean;
  empty: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <Button
      onClick={() => (isStreaming ? onStop() : onSend())}
      disabled={!isStreaming && empty}
      size="icon"
      className={cn(
        // Apr 27 · SEND-POLISH — bumped to 11×11 on mobile for
        // weight, 9×9 on desktop. The button is the page's
        // primary action; it now ALWAYS looks like a button
        // (faint chip when empty, gold-filled with subtle glow
        // when active) instead of a ghost arrow.
        "shrink-0 relative w-11 h-11 sm:w-9 sm:h-9 rounded-xl overflow-hidden",
        "transition-[background-color,color,border-color,transform,box-shadow] duration-200 ease-out",
        "active:scale-90",
        isStreaming
          ? "bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40"
          : empty
            ? "bg-[var(--bg-raised)] text-[var(--text-tertiary)] border border-[var(--border-default)]"
            : "bg-[var(--gold)] text-black hover:bg-[var(--gold)]/90 shadow-[0_0_12px_rgba(253,185,19,0.35)]"
      )}
      title={isStreaming ? "Stop generating" : "Send (Enter)"}
      // v10.0.529.18 a11y · explicit aria-label that toggles with
      // streaming state · pre-fix only the `title` attr was set
      // and iOS VoiceOver does not announce title on a button
      // unless focused. The send button is the page's primary
      // action · this is the highest-traffic control in the OS.
      aria-label={isStreaming ? "Stop generating" : "Send message"}
    >
      {/* Both icons always mounted — we morph by opacity + rotate.
          Avoids unmount/remount which cancels the CSS transition. */}
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-[180ms] ease-out",
          isStreaming ? "opacity-0 scale-50 rotate-[-30deg]" : "opacity-100 scale-100 rotate-0"
        )}
        aria-hidden={isStreaming}
      >
        <Send size={14} />
      </span>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-[180ms] ease-out",
          isStreaming ? "opacity-100 scale-100 rotate-0" : "opacity-0 scale-50 rotate-[30deg]"
        )}
        aria-hidden={!isStreaming}
      >
        <StopCircle size={14} />
      </span>
    </Button>
  );
}
