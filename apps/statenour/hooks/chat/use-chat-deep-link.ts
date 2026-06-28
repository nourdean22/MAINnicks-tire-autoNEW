"use client";

/**
 * useChatDeepLink — single-shot URL-param consumers.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.12 BATCH 68
 * decomposition. The page previously owned two effects that watched
 * `params` and dispatched on first hit:
 *   · `?q=...`    auto-send the query as the first message
 *   · `?cid=...`  (or ?conv= / ?conversationId=) load that conversation
 *
 * Both are one-shot — once they fire, subsequent param changes (e.g.
 * arriving at /chat from a different deep link) are ignored to avoid
 * surprising the user mid-session. The hook tracks per-instance
 * dispatch flags via local state so re-mounting (rare) re-arms them.
 */

import { useEffect, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";

interface UseChatDeepLinkOpts {
  params: ReadonlyURLSearchParams;
  /** Current message count — gates ?q= auto-send to empty conversations only. */
  messageCount: number;
  /** Currently-active conversation id, if any. Used to short-circuit ?cid=. */
  activeConversationId: string | null;
  /** Send a message (for ?q= auto-fire). */
  sendOrQueue: (text: string) => void;
  /** Load a conversation by id (for ?cid= deep-link). */
  loadConversation: (id: string) => Promise<void> | void;
}

export function useChatDeepLink(opts: UseChatDeepLinkOpts): void {
  const { params, messageCount, activeConversationId, sendOrQueue, loadConversation } = opts;
  const [qSent, setQSent] = useState(false);
  const [cidLoaded, setCidLoaded] = useState(false);

  // ?q= — auto-send from HQ compact-chat or a deep-linked share URL.
  // Gate on messageCount === 0 so we never inject into an active session.
  useEffect(() => {
    const q = params.get("q");
    if (!q || qSent || messageCount !== 0) return;
    setTimeout(() => setQSent(true), 0);
    sendOrQueue(q);
  }, [params, qSent, messageCount, sendOrQueue]);

  // ?cid= — load a specific conversation. Accepts ?cid, ?conv,
  // ?conversationId for backwards compat with old share links.
  useEffect(() => {
    if (cidLoaded) return;
    const cid =
      params.get("cid") ||
      params.get("conv") ||
      params.get("conversationId");
    if (!cid) return;
    if (activeConversationId === cid) {
      setTimeout(() => setCidLoaded(true), 0);
      return;
    }
    setTimeout(() => setCidLoaded(true), 0);
    void (async () => {
      try {
        await loadConversation(cid);
      } catch (err) {
        console.warn("[useChatDeepLink] failed to load cid:", err);
      }
    })();
  }, [params, cidLoaded, activeConversationId, loadConversation]);
}
