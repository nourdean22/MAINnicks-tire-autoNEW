"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, History, Mic, MicOff } from "lucide-react";
import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStream } from "../hooks/use-chat-stream";
import { ChatComposer } from "./chat-composer";
import { ChatMessageList } from "./chat-message-list";
import { ChatCapabilityIndicator } from "./chat-capability-indicator";
import { OperatorConversationDrawer } from "./operator-conversation-drawer";
import { RealtimeVoiceOverlay } from "@/components/chat/realtime-voice-overlay";
import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";
import { useConversations } from "@/hooks/use-conversations";

function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const observer = new MutationObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (container.scrollHeight - container.scrollTop - container.clientHeight < 150) {
          endRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      });
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return { containerRef, endRef };
}

export function ChatIsland() {
  const isVoiceDocked = useChatUiStore((state) => state.isVoiceDocked);
  const toggleVoiceDock = useChatUiStore((state) => state.toggleVoiceDock);
  const memoryInspectorOpen = useChatUiStore((state) => state.memoryInspectorOpen);
  const setMemoryInspectorOpen = useChatUiStore((state) => state.setMemoryInspectorOpen);
  const historyDrawerOpen = useChatUiStore((state) => state.historyDrawerOpen);
  const posture = useChatUiStore((state) => state.posture);
  const depth = useChatUiStore((state) => state.depth);
  const actionPermission = useChatUiStore((state) => state.actionPermission);
  const privateMode = useChatUiStore((state) => state.privateMode);
  const setHistoryDrawerOpen = useChatUiStore((state) => state.setHistoryDrawerOpen);
  const setActiveConversationId = useChatUiStore((state) => state.setActiveConversationId);
  const recalledHits = useChatUiStore((state) => state.recalledHits);
  const contradictions = useChatUiStore((state) => state.contradictions);
  const setMemoryData = useChatUiStore((state) => state.setMemoryData);
  const [memoryFetchedAt, setMemoryFetchedAt] = useState<Date | null>(null);

  const chat = useChatStream();
  const conversations = useConversations({
    setMessages: chat.setMessages,
    onError: (message) => console.error("useConversations error:", message),
  });
  const { containerRef, endRef } = useScrollToBottom<HTMLDivElement>();
  const islandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const syncHeight = () => {
      if (islandRef.current) islandRef.current.style.height = `${viewport.height}px`;
    };
    viewport.addEventListener("resize", syncHeight);
    viewport.addEventListener("scroll", syncHeight);
    syncHeight();
    return () => {
      viewport.removeEventListener("resize", syncHeight);
      viewport.removeEventListener("scroll", syncHeight);
    };
  }, []);

  const closeDrawer = useCallback(() => setHistoryDrawerOpen(false), [setHistoryDrawerOpen]);
  useEffect(() => {
    if (!historyDrawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDrawer, historyDrawerOpen]);

  useEffect(() => {
    const onCockpitEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; payload: any }>).detail;
      if (detail?.type === "memory.recalled") {
        setMemoryData(detail.payload?.hits || [], detail.payload?.contradictions || []);
        setMemoryFetchedAt(new Date());
      }
    };
    window.addEventListener("cockpit-event", onCockpitEvent);
    return () => window.removeEventListener("cockpit-event", onCockpitEvent);
  }, [setMemoryData]);

  const lastUserText = useMemo(() => {
    const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
    return (lastUser?.parts ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
  }, [chat.messages]);

  useEffect(() => {
    if (!memoryInspectorOpen || !lastUserText) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/brain/recall?q=${encodeURIComponent(lastUserText.slice(0, 1000))}&limit=8`,
          { credentials: "include", signal: controller.signal },
        );
        if (!response.ok) return;
        const report = (await response.json()) as {
          hits?: Array<{ id?: string; memoryId?: string; content?: string; category?: string; similarity?: number; knnDistance?: number }>;
        };
        const hits = (report.hits ?? []).map((hit, index) => ({
          id: hit.id ?? hit.memoryId ?? `hit-${index}`,
          content: hit.content ?? "",
          category: hit.category ?? "memory",
          similarity: typeof hit.similarity === "number"
            ? hit.similarity
            : typeof hit.knnDistance === "number"
              ? Math.max(0, Math.min(1, 1 - hit.knnDistance))
              : 0,
        }));
        setMemoryData(hits, contradictions);
        setMemoryFetchedAt(new Date());
      } catch {
        // Abort and network failures preserve the last known memory view.
      }
    })();
    return () => controller.abort();
  }, [contradictions, lastUserText, memoryInspectorOpen, setMemoryData]);

  return (
    <div ref={islandRef} className="relative flex h-full w-full flex-col overflow-hidden bg-void text-fg">
      <header className="z-10 flex items-center justify-between gap-3 border-b border-edge bg-void/90 px-3 py-2.5 backdrop-blur-xl sm:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-wide text-fg">NICK</h1>
            <ChatCapabilityIndicator />
          </div>
          {/* UI-1 authority strip: the header answers "what mode, what
              access" at a glance — the static tagline told the operator
              nothing about current authority. Reads the same store the
              composer writes; gold = non-default. */}
          <p className="mt-0.5 text-[10px] text-fg-tertiary">
            <span className={posture !== "auto" ? "text-gold" : undefined}>{posture === "auto" ? "auto posture" : posture}</span>
            {" · "}
            <span className={depth !== "auto" ? "text-gold" : undefined}>{depth === "auto" ? "auto depth" : depth}</span>
            {" · "}
            <span className={actionPermission === "execute" ? "text-gold" : actionPermission === "read" ? "text-sky-300" : undefined}>
              {actionPermission === "draft" ? "draft only" : actionPermission === "read" ? "read access" : "execute enabled"}
            </span>
            {privateMode && <span className="text-gold"> · PRIVATE</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMemoryInspectorOpen(!memoryInspectorOpen)} aria-label="Context and memory" aria-pressed={memoryInspectorOpen} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wider ${memoryInspectorOpen ? "border-gold/35 bg-gold/10 text-gold" : "border-edge text-fg-secondary hover:text-fg"}`}>
            <Brain size={13} /><span className="hidden sm:inline">Context</span>
          </button>
          <button onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)} aria-label="Conversation history" aria-pressed={historyDrawerOpen} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wider ${historyDrawerOpen ? "border-gold/35 bg-gold/10 text-gold" : "border-edge text-fg-secondary hover:text-fg"}`}>
            <History size={13} /><span className="hidden sm:inline">History</span>
          </button>
          <button onClick={toggleVoiceDock} aria-label={isVoiceDocked ? "Close voice" : "Open voice"} aria-pressed={isVoiceDocked} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-semibold uppercase tracking-wider ${isVoiceDocked ? "border-red-500/35 bg-red-500/10 text-red-300" : "border-edge text-fg-secondary hover:text-fg"}`}>
            {isVoiceDocked ? <MicOff size={13} /> : <Mic size={13} />}<span className="hidden sm:inline">Voice</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <ChatMessageList
            messages={chat.messages}
            isLoading={chat.isStreaming}
            isLoadingConvo={conversations.isLoadingConvo}
            error={chat.error}
            liveContextBlocksRef={chat.liveContextBlocksRef}
            lastTraceIdRef={chat.lastTraceIdRef}
            onRetry={() => void chat.regenerate()}
            onCommand={(prompt) => chat.sendText(prompt)}
          />
          <div ref={endRef} />
        </div>
        {isVoiceDocked && <RealtimeVoiceOverlay open={isVoiceDocked} onClose={toggleVoiceDock} />}
      </div>

      <div className="relative z-10 border-t border-edge bg-void/90 px-3 pb-safe pt-3 backdrop-blur-xl sm:px-4">
        <ChatComposer chat={chat} />
      </div>

      <MemoryInspectorSidebar open={memoryInspectorOpen} onClose={() => setMemoryInspectorOpen(false)} hits={recalledHits} contradictions={contradictions} fetchedAt={memoryFetchedAt} />

      {historyDrawerOpen && (
        <div className="absolute inset-y-0 left-0 z-50 w-full border-r border-edge bg-void sm:w-80" style={{ paddingLeft: "env(safe-area-inset-left, 0px)" }}>
          <OperatorConversationDrawer
            convos={conversations.convos}
            activeId={conversations.activeId}
            pinnedIds={conversations.pinnedIds}
            hasMore={conversations.hasMoreConvos}
            loadingMore={conversations.loadingMore}
            onLoadMore={conversations.loadMoreConvos}
            onSelect={(id) => {
              setActiveConversationId(id);
              void conversations.loadConvo(id);
              setHistoryDrawerOpen(false);
            }}
            onDelete={(id, event) => {
              const wasActive = conversations.activeId === id;
              void conversations.deleteConvo(id, event).then((ok) => {
                if (ok && wasActive) setActiveConversationId(null);
              });
            }}
            onRename={conversations.renameConvo}
            onTogglePin={conversations.togglePin}
            onArchive={(id) => conversations.patchConvoFlag(id, "archived", true)}
            onNew={() => {
              setActiveConversationId(null);
              conversations.newChat();
              setHistoryDrawerOpen(false);
            }}
            onShowActions={() => {
              setHistoryDrawerOpen(false);
              chat.sendText("/receipts");
            }}
            onClose={() => setHistoryDrawerOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
