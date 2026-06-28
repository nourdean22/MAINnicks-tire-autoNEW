"use client";

/**
 * useLazyRenderMessages — render only the most recent N messages on
 * very long conversations.
 *
 * v8.16 B3 stopgap virtualization. The chat page renders every message
 * unconditionally; on conversations with 200+ messages the DOM gets
 * heavy enough that streaming feels janky on older devices and the
 * scroll-to-bottom spring physics start to slide. Full virtualization
 * (e.g. @tanstack/react-virtual) would conflict with the existing
 * useStickToBottom ResizeObserver that watches the whole content
 * container, so we instead lazy-render: only the last `DEFAULT_VISIBLE`
 * messages mount until the user explicitly asks for older history.
 *
 * Crucially:
 *   · While `isStreaming`, force-show ALL messages so the scroll spring
 *     and last-message height growth keep working without surprise
 *     mount/unmount churn mid-turn.
 *   · When the user clicks "show older", visibleCount jumps to messages.length
 *     and stays there for the rest of the session — the convenience is
 *     "I want to dig into history right now," not a permanent setting.
 *   · When the underlying conversation switches (messages array shrinks
 *     OR the first id changes), reset visibleCount so a freshly-opened
 *     long convo isn't stuck on whatever the previous convo decided.
 *
 * Conservative threshold: only "lazy" mode kicks in when total messages
 * exceed `LAZY_THRESHOLD`. Below that the hook is a no-op pass-through —
 * the common case (most conversations are short) stays untouched.
 */

import { useEffect, useRef, useState } from "react";

const LAZY_THRESHOLD = 80;
const DEFAULT_VISIBLE = 50;

interface MessageLike {
  id: string;
}

export interface LazyRenderState<T extends MessageLike> {
  /** The slice of messages that should mount in the DOM. */
  renderedMessages: T[];
  /** True when fewer than `messages.length` are currently rendered. */
  hasHidden: boolean;
  /** How many messages are currently hidden (0 if none). */
  hiddenCount: number;
  /** Reveal the rest of the history (irreversible for the session). */
  showOlder: () => void;
}

export function useLazyRenderMessages<T extends MessageLike>(
  messages: T[],
  isStreaming: boolean,
): LazyRenderState<T> {
  const total = messages.length;
  const isLong = total > LAZY_THRESHOLD;
  const [visibleCount, setVisibleCount] = useState<number>(
    isLong ? Math.min(total, DEFAULT_VISIBLE) : total,
  );
  const lastFirstIdRef = useRef<string | null>(null);
  const lastTotalRef = useRef<number>(total);

  // Reset when the conversation switches: detect either a shrink (load
  // a different convo) or a different first id (same length but new
  // first message).
  useEffect(() => {
    const firstId = messages[0]?.id ?? null;
    const switched =
      total < lastTotalRef.current ||
      (firstId !== null && lastFirstIdRef.current !== null && firstId !== lastFirstIdRef.current);
    if (switched) {
      setVisibleCount(total > LAZY_THRESHOLD ? DEFAULT_VISIBLE : total);
    }
    lastFirstIdRef.current = firstId;
    lastTotalRef.current = total;
  }, [messages, total]);

  // While streaming, mount everything so heights are stable and scroll
  // physics stay calm. Restore the lazy slice once the turn settles.
  const resolvedVisibleCount = isStreaming ? total : visibleCount;

  // Effective slice: when not in lazy mode, return all messages.
  if (!isLong || resolvedVisibleCount >= total) {
    return {
      renderedMessages: messages,
      hasHidden: false,
      hiddenCount: 0,
      showOlder: () => setVisibleCount(total),
    };
  }

  const start = Math.max(0, total - resolvedVisibleCount);
  return {
    renderedMessages: messages.slice(start),
    hasHidden: true,
    hiddenCount: start,
    showOlder: () => setVisibleCount(total),
  };
}
