"use client";

/**
 * useChatBranchSwap — listen for `nick-swap-branch` events and swap a
 * message in place with its sibling branch from the branches API.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.12 BATCH 68
 * decomposition. The page previously owned a 70-line useEffect that
 * registered a window event listener, fetched the sibling, and ran an
 * in-place setMessages. Logic is identical, now isolated.
 *
 * Why in-place: the alternative (truncate-from-cursor + re-render) jumps
 * scroll position and re-fires downstream effects (token counter, smart
 * replies recalc). In-place mutation keeps the user where they were.
 */

import { useEffect } from "react";

// REST→tRPC hooks slice (2026-05-22) · migrated off `authedFetch
// ("/api/ai/chat/branches/[parentMessageId]")` onto the existing
// `trpc.chat.branches` query (Phase DD) · both delegate to the SAME
// `chat-branches.readChatBranches` service · drift impossible. The
// listener does a one-shot imperative fetch (`utils.chat.branches
// .fetch`) so the lazy event-driven shape is preserved.
import { trpc } from "@/lib/trpc/client";
// v10.0.313 · generic over the message type so the /chat page can
// pass its UIMessage[] without an `as unknown as` cast. Only requires
// the structural minimum: id + optional parentMessageId.
interface ChatMessageLike {
  id: string;
  parentMessageId?: string;
}

type SetMessagesFn<M extends ChatMessageLike> = (
  updater: (prev: M[]) => M[],
) => void;

export function useChatBranchSwap<M extends ChatMessageLike>(
  messages: M[],
  setMessages: SetMessagesFn<M>,
): void {
  const utils = trpc.useUtils();
  useEffect(() => {
    function onSwap(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { activeMessageId?: string; siblingId?: string }
        | undefined;
      const activeId = detail?.activeMessageId;
      const siblingId = detail?.siblingId;
      if (!activeId || !siblingId || activeId === siblingId) return;

      const idx = messages.findIndex((m) => m.id === activeId);
      if (idx < 0) return;

      const active = messages[idx];
      if (!active.parentMessageId) return;

      void (async () => {
        try {
          const result = await utils.chat.branches.fetch({
            parentMessageId: active.parentMessageId!,
          });
          const sibling = result.siblings.find((s) => s.id === siblingId);
          if (!sibling) return;

          // Rebuild parts the same way use-conversations does so the
          // renderer doesn't see a malformed message.
          const persistedParts = sibling.parts;
          const parts: Array<Record<string, unknown>> = [];
          if (Array.isArray(persistedParts) && persistedParts.length > 0) {
            for (const p of persistedParts) {
              if (p && typeof p === "object")
                parts.push(p as Record<string, unknown>);
            }
          }
          if (
            parts.length === 0 &&
            typeof sibling.content === "string" &&
            sibling.content.trim()
          ) {
            parts.push({ type: "text", text: sibling.content });
          }
          if (parts.length === 0) parts.push({ type: "text", text: "" });

          setMessages((prev) => {
            const next = [...prev];
            const target = next[idx];
            if (!target) return prev;
            // v10.0.313 · M is generic + extends ChatMessageLike · the
            // composite literal needs an `as M` cast since TS can't
            // verify the widened shape preserves M. Spreading target
            // first ensures all M-specific fields persist.
            next[idx] = {
              ...target,
              id: siblingId,
              parts,
              ...(typeof sibling.streamingState === "string" && {
                streamingState: sibling.streamingState,
              }),
              ...(typeof sibling.provider === "string" && {
                provider: sibling.provider,
              }),
              ...(typeof sibling.model === "string" && { model: sibling.model }),
              ...(typeof sibling.latencyMs === "number" && {
                latencyMs: sibling.latencyMs,
              }),
              ...(typeof sibling.firstTokenLatencyMs === "number" && {
                firstTokenLatencyMs: sibling.firstTokenLatencyMs,
              }),
              ...(typeof sibling.costCents === "number" && {
                costCents: sibling.costCents,
              }),
              ...(typeof sibling.promptTokens === "number" && {
                promptTokens: sibling.promptTokens,
              }),
              ...(typeof sibling.completionTokens === "number" && {
                completionTokens: sibling.completionTokens,
              }),
              ...(typeof sibling.feedbackScore === "number" && {
                feedbackScore: sibling.feedbackScore,
              }),
              ...(typeof sibling.attachmentsHash === "string" && {
                attachmentsHash: sibling.attachmentsHash,
              }),
            } as M;
            return next;
          });
        } catch {
          // silent — swap is decoration; failure leaves the original visible
        }
      })();
    }

    window.addEventListener("nick-swap-branch", onSwap as EventListener);
    return () =>
      window.removeEventListener("nick-swap-branch", onSwap as EventListener);
  }, [messages, setMessages, utils]);
}
