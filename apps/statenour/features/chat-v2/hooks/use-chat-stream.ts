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
  // 2026-08-12 · the source page's route — the server has consumed
  // body.contextRoute (route hint + TOOL_BIAS) since Wave 30, but no
  // text-chat client ever sent it. The bridge now stores it per page.
  "contextRoute",
] as const;

export function useChatStream(): ChatRuntimeController {
  const activeConversationId = useChatUiStore((s) => s.activeConversationId);
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);
  const setConnection = useChatUiStore((s) => s.setConnection);
  // 2026-07-22 · authority-kernel controls (composer selectors)
  const privateMode = useChatUiStore((s) => s.privateMode);
  const turbo = useChatUiStore((s) => s.turbo);
  const setTurbo = useChatUiStore((s) => s.setTurbo);
  const posture = useChatUiStore((s) => s.posture);
  const depth = useChatUiStore((s) => s.depth);
  const actionPermission = useChatUiStore((s) => s.actionPermission);

  const bodyRef = useRef<Record<string, unknown>>({ conversationId: activeConversationId });
  const liveContextBlocksRef = useRef<any>(null);
  const lastTraceIdRef = useRef<string | null>(null);
  const lastPersonaHeaderRef = useRef(null);

  useEffect(() => {
    // Private Lab detaches from ANY conversation — no id is sent, the server
    // also drops it (belt + suspenders), so no rows can be conversation-scoped.
    bodyRef.current.conversationId = privateMode ? undefined : activeConversationId;
  }, [activeConversationId, privateMode]);

  useEffect(() => {
    // Ship only NON-DEFAULTS so an untouched composer = today's exact requests.
    if (privateMode) bodyRef.current.privateMode = true;
    else delete bodyRef.current.privateMode;
    if (posture !== "auto") bodyRef.current.posture = posture;
    else delete bodyRef.current.posture;
    if (depth !== "auto") bodyRef.current.modeOverride = depth;
    else delete bodyRef.current.modeOverride;
    if (actionPermission !== "draft") bodyRef.current.actionPermission = actionPermission;
    else delete bodyRef.current.actionPermission;
  }, [privateMode, posture, depth, actionPermission]);

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
    // WP-A (2026-07-29): on mount, reconnect to a turn that was in
    // flight when the PWA was backgrounded or the socket dropped — the
    // transport rewrites the resume GET to the per-conversation route;
    // no conversation / private mode resolves to a 204 no-op, so this
    // is always safe to leave on.
    resume: true,
    onError(error) {
      console.error("chat stream failed", error);
      setConnection("degraded");
    },
    onFinish() {
      // 2026-08-09 · Do NOT flip back to "online" when this turn was killed
      // by the stall abort. chat.stop() resolves the stream normally, so
      // onFinish fires on an ABORT exactly as it does on a real completion —
      // and it was wiping the only remaining trace that anything went wrong,
      // ~instantly, while the 6s toast was still on screen. That is how a
      // dead turn ended up looking completely healthy.
      if (stalledRef.current) return;
      setConnection("online");
    },
  });

  const retryCountRef = useRef(0);
  // True from the moment the 90s stall abort fires until the next send.
  // Guards onFinish (below) from erasing the degraded state, since an
  // abort and a completion are indistinguishable to that callback.
  const stalledRef = useRef(false);
  const messagesRef = useRef(chat.messages);
  // Whether the MOST RECENT send went out under Private Lab, + a live mirror of
  // privateMode. A private turn must never be replayed (regenerate / auto-retry)
  // once Private Lab is off — the replay would persist it (self-review high #4).
  const sentPrivateRef = useRef(false);
  const privateModeRef = useRef(privateMode);
  useEffect(() => {
    privateModeRef.current = privateMode;
  }, [privateMode]);

  const safeRegenerate = useCallback(
    (options?: Parameters<typeof chat.regenerate>[0]): Promise<void> => {
      if (sentPrivateRef.current && !privateModeRef.current) {
        toast.error("That turn was private — turn Private Lab back on to retry it.");
        return Promise.resolve();
      }
      return chat.regenerate(options);
    },
    [chat],
  );

  // Kept fresh the same way regenerateRef is, so the stall toast's action can
  // reach it without re-creating the toast on every render.
  const resumeStreamRef = useRef(chat.resumeStream);
  useEffect(() => {
    resumeStreamRef.current = chat.resumeStream;
  }, [chat.resumeStream]);

  const regenerateRef = useRef(safeRegenerate);
  useEffect(() => {
    regenerateRef.current = safeRegenerate;
  }, [safeRegenerate]);

  useEffect(() => {
    messagesRef.current = chat.messages;
  }, [chat.messages]);

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

    // 2026-07-22 · idempotency guard. A tool may have committed a real side
    // effect (Telegram send, IG autopost, customer alert) on the server BEFORE
    // the stream dropped. Auto-regenerating re-runs the turn and re-fires the
    // tool = duplicate action. Only auto-retry when the last assistant turn
    // produced NO tool parts (pure-text stream broke, or the POST never landed).
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
    const hadToolPart = lastAssistant?.parts?.some(
      (p) => typeof (p as { type?: unknown })?.type === "string" &&
        (((p as { type: string }).type).startsWith("tool-") || (p as { type: string }).type === "dynamic-tool"),
    );
    if (hadToolPart) return;

    // Private Lab: don't auto-replay a privately-sent turn once the mode is off.
    if (sentPrivateRef.current && !privateModeRef.current) return;

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
      stalledRef.current = true;
      setConnection("degraded");
      if (!message) return;
      // 2026-08-09 · Was a 6-second auto-dismissing toast. The stall it
      // reports takes 90 SECONDS to fire, so on a phone the notice routinely
      // came and went while the screen was off or the operator had looked
      // away — leaving a turn that had genuinely failed looking like one that
      // was merely slow. A stall is terminal for that turn: it must persist
      // until acknowledged, and it must offer the recovery, because
      // chat.error is never set on this path so the SDK's own retry cannot
      // arm and the persistent error card cannot render.
      // RECONNECT, never regenerate. chat.stop() abandons only the CLIENT
      // reader — route.ts calls result.consumeStream?.() and guarantees the
      // turn completes and persists after the client disconnects, and
      // registers it in the active-stream registry for exactly this purpose.
      // So a "Retry" that called regenerate() would start a SECOND execution
      // against a first that is still running: at best two competing assistant
      // turns, at worst a mutating tool fired twice — and this chat can invoke
      // gmail.sendDraft, telegram.send and shop.sendSms (route.ts
      // HIGH_STAKES_MUTATIONS). resumeStream() reattaches to the stream that
      // is already producing the answer. Caught in review on #1471.
      toast.error(message, {
        id: "chat-stall",
        duration: Infinity,
        action: {
          label: "Reconnect",
          onClick: () => {
            toast.dismiss("chat-stall");
            stalledRef.current = false;
            setConnection("online");
            void resumeStreamRef.current?.();
          },
        },
      });
    },
  });

  useEffect(() => {
    if (stallStatus === "stalled" || stallStatus === "warn") {
      setConnection("degraded");
    }
  }, [stallStatus, setConnection]);

  /** A new turn supersedes any stall notice from the previous one. */
  const clearStall = useCallback(() => {
    if (!stalledRef.current) return;
    stalledRef.current = false;
    toast.dismiss("chat-stall");
  }, []);

  return {
    messages: chat.messages,
    status: chat.status as "submitted" | "streaming" | "ready" | "error",
    error: chat.error,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    sendText: (text: string) => {
      sentPrivateRef.current = privateMode;
      clearStall();
      // 2026-08-12 · OPTIONAL TURBO: per-MESSAGE body override (race-free —
      // the option rides this exact send, not the shared bodyRef), consumed
      // and reset in the same tick so it can never stick to a second turn.
      // Regenerate/append deliberately do NOT carry it (no automatic
      // follow-on use, per the turbo contract).
      const turboOpts = turbo
        ? { body: { providerOverride: "anthropic" as const } }
        : undefined;
      if (turbo) setTurbo(false);
      return chat.sendMessage({ text }, turboOpts);
    },
    append: ((...args: Parameters<typeof chat.sendMessage>) => {
      sentPrivateRef.current = privateMode;
      clearStall();
      return chat.sendMessage(...args);
    }) as typeof chat.sendMessage,
    stop: chat.stop,
    regenerate: safeRegenerate,
    setMessages: chat.setMessages,
    liveContextBlocksRef,
    lastTraceIdRef,
  };
}
