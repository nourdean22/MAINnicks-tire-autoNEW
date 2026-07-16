"use client";

import { useCallback, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { toast } from "sonner";
import { useChatTransport } from "@/hooks/chat/use-chat-transport";
import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStall } from "@/hooks/chat/use-chat-stall";
import { useStreamingErrorGuard } from "@/hooks/chat/use-streaming-error-guard";
import {
  readPageContext,
  onPageContextChanged,
  type PageContextPayload,
} from "@/components/chat/page-context-bridge";
import type { ChatRuntimeController } from "../types/chat-runtime-controller";

const PAGE_ANCHOR_KEYS = [
  "lastTaskId",
  "lastGoalId",
  "lastJournalEntryId",
  "lastDecisionId",
  "lastPinId",
  "lastReflectionId",
  "lastMissionId",
] as const;

export function useChatStream(): ChatRuntimeController {
  const activeConversationId = useChatUiStore((s) => s.activeConversationId);
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);
  const setConnection = useChatUiStore((s) => s.setConnection);

  const bodyRef = useRef<Record<string, unknown>>({ conversationId: activeConversationId });
  const liveContextBlocksRef = useRef<any>(null);
  const lastTraceIdRef = useRef<string | null>(null);
  const lastPersonaHeaderRef = useRef(null);

  useEffect(() => {
    bodyRef.current.conversationId = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    const apply = (ctx: PageContextPayload | null) => {
      for (const key of PAGE_ANCHOR_KEYS) delete bodyRef.current[key];
      if (!ctx) return;
      for (const key of PAGE_ANCHOR_KEYS) {
        const value = ctx[key];
        if (value) bodyRef.current[key] = value;
      }
    };
    apply(readPageContext());
    return onPageContextChanged(apply);
  }, []);

  const transport = useChatTransport({
    apiPath: "/api/ai/chat",
    transportBodyRef: bodyRef,
    liveContextBlocksRef,
    lastPersonaHeaderRef,
    lastTraceIdRef,
    setDeeperContext: () => {},
    onConversationId: useCallback(
      (id: string) => setActiveConversationId(id),
      [setActiveConversationId],
    ),
  });

  const chat = useChat({
    id: "chat-v2",
    transport,
    onError(error) {
      console.error("chat stream failed", error);
      setConnection("degraded");
    },
    onFinish() {
      setConnection("online");
    },
  });

  const retryCountRef = useRef(0);
  const regenerateRef = useRef(chat.regenerate);

  useEffect(() => {
    regenerateRef.current = chat.regenerate;
  }, [chat.regenerate]);

  useEffect(() => {
    if (!chat.error) {
      retryCountRef.current = 0;
      return;
    }
    if (retryCountRef.current >= 2) return;

    const message = (chat.error.message ?? "").toLowerCase();
    const isNetworkKill =
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("fetch failed") ||
      message.includes("load failed");
    if (!isNetworkKill) return;

    retryCountRef.current += 1;
    const timer = setTimeout(
      () => regenerateRef.current?.(),
      1_500 * retryCountRef.current,
    );
    return () => clearTimeout(timer);
  }, [chat.error]);

  useStreamingErrorGuard({
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    error: chat.error?.message ?? null,
    clearError: () => setConnection("online"),
  });

  const { stallStatus } = useChatStall({
    messages: chat.messages as any,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    stop: chat.stop,
    setError: (message) => {
      setConnection("degraded");
      if (message) toast.error(message, { duration: 6000 });
    },
  });

  useEffect(() => {
    if (stallStatus === "stalled" || stallStatus === "warn") {
      setConnection("degraded");
    }
  }, [stallStatus, setConnection]);

  return {
    messages: chat.messages,
    status: chat.status as "submitted" | "streaming" | "ready" | "error",
    error: chat.error,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    sendText: (text: string) => chat.sendMessage({ text }),
    append: chat.sendMessage,
    stop: chat.stop,
    regenerate: chat.regenerate,
    setMessages: chat.setMessages,
    liveContextBlocksRef,
    lastTraceIdRef,
  };
}
