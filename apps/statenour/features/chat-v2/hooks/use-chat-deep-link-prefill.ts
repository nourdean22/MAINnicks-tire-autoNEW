"use client";

/**
 * Deep-link prefill for chat-v2 — BDN-004 (2026-08-12).
 *
 * 13 surfaces across the app hand context to chat via URL params
 * (nick-suggestions, active-task-companion, decision-replay-card,
 * contradictions-card, command palette, push-notification click URLs, …)
 * using three historical vocabularies: ?q= · ?seed= · ?prompt=. The old
 * handler (hooks/chat/use-chat-deep-link.ts) was orphaned in the chat-v2
 * migration, so every one of those entry points landed on an EMPTY
 * composer. This restores the wire through the store the composer
 * actually binds (`useChatUiStore.draft`).
 *
 * Deliberate change from the old hook: PREFILL, never auto-send. A page
 * load must not fire a model turn on its own ($0-incremental doctrine) —
 * the operator reads the prefilled prompt and taps send.
 *
 * Also honors conversation deep-links (?cid= / ?conv= /
 * ?conversationId=) via the same setter the history drawer uses.
 *
 * Reads window.location.search in a mount effect instead of
 * useSearchParams() — same read-once semantics, no Suspense-boundary
 * requirement at build time.
 */

import { useEffect } from "react";
import { useChatUiStore } from "../stores/chat-ui-store";

export interface DeepLinkStoreSlice {
  draft: string;
  setDraft: (draft: string) => void;
  setActiveConversationId: (id: string | null) => void;
  setHistoryDrawerOpen: (open: boolean) => void;
}

/**
 * PURE and exported for the test (homeHealthState pattern): given the raw
 * query string and the store slice, apply the deep-link. Never clobbers a
 * draft the operator already typed; never sends anything.
 */
export function consumeChatDeepLink(search: string, store: DeepLinkStoreSlice): void {
  const params = new URLSearchParams(search);

  const cid =
    params.get("cid") ?? params.get("conv") ?? params.get("conversationId");
  if (cid) store.setActiveConversationId(cid);

  const prompt = params.get("q") ?? params.get("seed") ?? params.get("prompt");
  if (prompt && prompt.trim() && !store.draft.trim()) {
    store.setDraft(prompt.trim());
  }

  // ?h=1 — nick-reasoner's "open chat history" deep-link.
  if (params.get("h") === "1") store.setHistoryDrawerOpen(true);
}

export function useChatDeepLinkPrefill(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { draft, setDraft, setActiveConversationId, setHistoryDrawerOpen } =
      useChatUiStore.getState();
    consumeChatDeepLink(window.location.search, {
      draft,
      setDraft,
      setActiveConversationId,
      setHistoryDrawerOpen,
    });
  }, []);
}
