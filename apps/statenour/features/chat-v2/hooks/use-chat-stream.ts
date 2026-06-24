"use client";

import { useRef, useCallback, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { useChatTransport } from "@/hooks/chat/use-chat-transport";
import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStall } from "@/hooks/chat/use-chat-stall";
import { useStreamingErrorGuard } from "@/hooks/chat/use-streaming-error-guard";
import type { ChatRuntimeController } from "../types/chat-runtime-controller";

export function useChatStream(): ChatRuntimeController {
  const activeConversationId = useChatUiStore((s) => s.activeConversationId);
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);
  const setConnection = useChatUiStore((s) => s.setConnection);

  // Body ref for transport (must be mutable so the transport reads the latest on every send without re-subscribing)
  const bodyRef = useRef({
    conversationId: activeConversationId,
    // Add other fields as needed (e.g. modes, overrides)
  });

  // Sync state to ref
  useEffect(() => {
    bodyRef.current.conversationId = activeConversationId;
  }, [activeConversationId]);

  const liveContextBlocksRef = useRef<any>(null);

  // Use the robust transport wrapper from the repo
  const transport = useChatTransport({
    apiPath: "/api/ai/chat",
    transportBodyRef: bodyRef,
    liveContextBlocksRef, // Provide refs if you need to extract these downstream
    lastPersonaHeaderRef: useRef(null),
    setDeeperContext: () => {}, 
    onConversationId: useCallback((id: string) => {
      setActiveConversationId(id);
    }, [setActiveConversationId]),
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
    }
  });

  // Streaming Error Guard
  useStreamingErrorGuard({
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    error: chat.error ? chat.error.message : null,
    clearError: () => {
      // Not strictly necessary in v6 as append clears error natively,
      // but we reset our connection degraded state just in case.
      setConnection("online");
    }
  });

  // Stall Detection
  const { stallStatus, triggerStallHandler } = useChatStall({
    messages: chat.messages as any,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    stop: chat.stop,
    setError: () => setConnection("degraded")
  });

  // We could expose stallStatus or triggerStallHandler via the store if needed,
  // but for now we just rely on connection state for "degraded" UI.
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
    stop: chat.stop,
    regenerate: chat.regenerate,
    setMessages: chat.setMessages,
    liveContextBlocksRef,
  };
}
