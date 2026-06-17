"use client";

/**
 * MessageActionSheet v2 — Apr 27 polish.
 *
 * Bottom sheet that pops on long-press of any chat message. Replaces
 * the floating hover cluster (copy/pin/edit) with a phone-first
 * surface that fits one thumb.
 *
 * Apr 27 changes:
 *   · Swipe-down-to-close gesture on the grab handle (touchstart →
 *     touchmove tracks deltaY, releases at >80px or snaps back)
 *   · Larger row height (py-3.5 → 56px tap targets, well above iOS
 *     HIG 44px min)
 *   · Action icons get a tinted square background so they read like
 *     iOS-style action sheets (visual rhythm > monochrome list)
 *   · Cinematic stagger entrance — each row 30ms after the previous
 *   · Pin shows "pinned" state if already pinned (caller passes
 *     isPinned)
 *
 * Actions:
 *   • Copy text
 *   • Pin / Unpin as insight
 *   • Edit (user messages only)
 *   • Delete (user messages only)
 *   • Save as belief (assistant messages only)
 *   • Save as decision (assistant messages only)
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Copy, Pin, PinOff, Pencil, Trash2, BookOpen, ClipboardCheck, X, Brain, ListChecks, ThumbsUp, ThumbsDown, GitFork } from "lucide-react";

export interface MessageActionSheetProps {
  open: boolean;
  onClose: () => void;
  role: "user" | "assistant";
  text: string;
  onCopy?: () => void;
  onPin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onSaveAsBelief?: () => void;
  onSaveAsDecision?: () => void;
  /** v10.0.360 · "Show reasoning" · opens the BDI provenance trace. */
  onShowReasoning?: () => void;
  /** Relocated from the deleted message hover-bar - now touch-reachable. */
  onCreateTask?: () => void;
  onSaveToBrain?: () => void;
  onPinToPrompt?: () => void;
  onFeedback?: (positive: boolean) => void;
  onFork?: () => void;
  /** Apr 27 — caller passes whether this message is currently pinned
   *  so the sheet can show Pin / Unpin instead of always Pin. */
  isPinned?: boolean;
}

// Tinted icon square for visual rhythm (matches iOS action-sheet style).
function ActionRow({
  onClick,
  icon,
  label,
  tone,
  delay,
  destructive,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: "gold" | "blue" | "emerald" | "neutral" | "rose";
  delay: number;
  destructive?: boolean;
}) {
  const toneClass = {
    gold: "bg-(--gold)/10 text-(--gold)",
    blue: "bg-blue-500/10 text-blue-400",
    emerald: "bg-emerald-500/10 text-emerald-400",
    neutral: "bg-(--bg-raised) text-(--text-secondary)",
    rose: "bg-rose-500/10 text-rose-400",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3.5 transition-colors active:scale-[0.99] active:bg-(--bg-raised)/60",
        destructive ? "text-rose-300 hover:bg-rose-500/10" : "text-(--text-primary) hover:bg-(--bg-raised)",
      )}
      style={{ animation: `fadeSlideUp 0.32s ${delay}ms ease-out both` }}
    >
      <span
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          toneClass,
        )}
      >
        {icon}
      </span>
      <span className="text-[14px] font-medium">{label}</span>
    </button>
  );
}

export function MessageActionSheet({
  open,
  onClose,
  role,
  text,
  onCopy,
  onPin,
  onEdit,
  onDelete,
  onSaveAsBelief,
  onSaveAsDecision,
  onShowReasoning,
  onCreateTask,
  onSaveToBrain,
  onPinToPrompt,
  onFeedback,
  onFork,
  isPinned = false,
}: MessageActionSheetProps) {
  // Drag-to-dismiss state. Tracks vertical translation while the user
  // drags the handle; commits a close at >80px, snaps back otherwise.
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const dragStartRef = useRef<number | null>(null);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Drag state self-cleans: handleTouchEnd always resets dragY to 0
  // when the user lets go without committing a close. No effect-based
  // sync needed — and avoiding it sidesteps the cascading-render lint.

  if (!open) return null;

  const fireAndClose = (fn?: () => void) => () => {
    fn?.();
    onClose();
  };

  // Touch handlers on the grab handle area
  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartRef.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartRef.current === null) return;
    const dy = e.touches[0].clientY - dragStartRef.current;
    if (dy > 0) setDragY(dy); // only allow dragging down
  };
  const handleTouchEnd = () => {
    if (dragY > 80) {
      onClose();
    } else {
      setDragY(0); // snap back
    }
    dragStartRef.current = null;
  };

  // Build the action list dynamically so we can stagger the entrance.
  // Counter is captured by closure rather than module-let so it resets
  // on every render — each open of the sheet recomputes delays from 0.
  const delayCounter = { current: 80 };
  const next = () => {
    const d = delayCounter.current;
    delayCounter.current += 35;
    return d;
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-120 bg-black/65 backdrop-blur-[2px] animate-fade-in"
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-121",
          "bg-(--bg-void) border-t border-(--border-default)",
          "rounded-t-2xl shadow-[0_-20px_60px_rgba(0,0,0,0.7)]",
          "max-h-[78vh] overflow-y-auto",
        )}
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 16px)",
          // Animate the sheet up from below + apply live drag offset.
          // No spring, just snappy ease-out.
          transform: `translateY(${dragY}px)`,
          transition: dragY === 0 ? "transform 0.22s ease-out" : "none",
          animation: dragY === 0 ? "slideUpSheet 0.28s ease-out" : undefined,
        }}
      >
        {/* Drag handle — also the grab gesture surface */}
        <div
          className="flex justify-center pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-(--text-tertiary)/40" />
        </div>

        {/* Message preview */}
        <div className="px-4 py-2.5 border-b border-(--border-default)">
          <p className="text-[9px] font-mono uppercase tracking-[0.22em] text-(--text-tertiary) mb-1">
            {role === "user" ? "your message" : "nick's reply"}
          </p>
          <p className="text-[12.5px] text-(--text-secondary) line-clamp-3 leading-relaxed">
            {text.slice(0, 240)}
            {text.length > 240 && "…"}
          </p>
        </div>

        {/* Actions — staggered entrance, tinted icon squares */}
        <div className="py-1.5">
          {onCopy && (
            <ActionRow
              onClick={fireAndClose(onCopy)}
              icon={<Copy size={16} />}
              label="Copy text"
              tone="neutral"
              delay={next()}
            />
          )}
          {onPin && (
            <ActionRow
              onClick={fireAndClose(onPin)}
              icon={isPinned ? <PinOff size={16} /> : <Pin size={16} />}
              label={isPinned ? "Unpin" : "Pin as insight"}
              tone="gold"
              delay={next()}
            />
          )}
          {role === "user" && onEdit && (
            <ActionRow
              onClick={fireAndClose(onEdit)}
              icon={<Pencil size={16} />}
              label="Edit"
              tone="neutral"
              delay={next()}
            />
          )}
          {role === "assistant" && onSaveAsBelief && (
            <ActionRow
              onClick={fireAndClose(onSaveAsBelief)}
              icon={<BookOpen size={16} />}
              label="Save as belief"
              tone="emerald"
              delay={next()}
            />
          )}
          {role === "assistant" && onSaveAsDecision && (
            <ActionRow
              onClick={fireAndClose(onSaveAsDecision)}
              icon={<ClipboardCheck size={16} />}
              label="Save as decision"
              tone="blue"
              delay={next()}
            />
          )}
          {/* v10.0.360 · BDI reasoning trace · only for assistant
              messages · opens the cognitive chain modal showing which
              beliefs / desires / intentions / observations supported
              the reply. */}
          {role === "assistant" && onShowReasoning && (
            <ActionRow
              onClick={fireAndClose(onShowReasoning)}
              icon={<Brain size={16} />}
              label="Show reasoning"
              tone="gold"
              delay={next()}
            />
          )}
          {/* May 02 · delete now allowed for both roles. Server (DELETE
              /api/ai/chat/edit/[id]) cascades — removing an assistant
              row drops it + every subsequent message in the convo,
              same as the user-row case. */}
          {role === "assistant" && onCreateTask && (
            <ActionRow
              onClick={fireAndClose(onCreateTask)}
              icon={<ListChecks size={16} />}
              label="Create task"
              tone="neutral"
              delay={next()}
            />
          )}
          {role === "assistant" && onSaveToBrain && (
            <ActionRow
              onClick={fireAndClose(onSaveToBrain)}
              icon={<Brain size={16} />}
              label="Save to brain"
              tone="gold"
              delay={next()}
            />
          )}
          {role === "assistant" && onPinToPrompt && (
            <ActionRow
              onClick={fireAndClose(onPinToPrompt)}
              icon={<Pin size={16} />}
              label="Pin to Nick's prompt"
              tone="gold"
              delay={next()}
            />
          )}
          {role === "assistant" && onFeedback && (
            <>
              <ActionRow
                onClick={fireAndClose(() => onFeedback(true))}
                icon={<ThumbsUp size={16} />}
                label="Good response"
                tone="emerald"
                delay={next()}
              />
              <ActionRow
                onClick={fireAndClose(() => onFeedback(false))}
                icon={<ThumbsDown size={16} />}
                label="Bad response"
                tone="rose"
                delay={next()}
              />
            </>
          )}
          {onFork && (
            <ActionRow
              onClick={fireAndClose(onFork)}
              icon={<GitFork size={16} />}
              label="Fork conversation"
              tone="neutral"
              delay={next()}
            />
          )}
          {onDelete && (
            <ActionRow
              onClick={fireAndClose(onDelete)}
              icon={<Trash2 size={16} />}
              label="Delete message"
              tone="rose"
              delay={next()}
              destructive
            />
          )}
        </div>

        {/* Cancel — also large for thumb */}
        <button
          onClick={onClose}
          className="w-full flex items-center justify-center gap-1.5 py-3.5 border-t border-(--border-default) text-[11px] font-mono uppercase tracking-[0.18em] text-(--text-tertiary) hover:text-(--text-primary) active:scale-[0.98] transition-colors"
          style={{ animation: `fadeSlideUp 0.32s ${delayCounter.current}ms ease-out both` }}
        >
          <X size={12} /> Close
        </button>
      </div>
    </>
  );
}
