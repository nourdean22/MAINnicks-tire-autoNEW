"use client";

import { useEffect, useRef, useCallback } from "react";

import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStream } from "../hooks/use-chat-stream";
import { ChatComposer } from "./chat-composer";
import { ChatMessageList } from "./chat-message-list";
import { RealtimeVoiceOverlay } from "@/components/chat/realtime-voice-overlay";
import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";
import { Brain, History, Mic, MicOff } from "lucide-react";
import { ConversationDrawer } from "@/components/chat/conversation-drawer";
import { useConversations } from "@/hooks/use-conversations";

function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // For simplicity in P0, we'll just scroll to the endRef whenever children change
    // but only if we were already at bottom. To implement "only when at bottom", 
    // we use a MutationObserver.
    
    // Throttle to one scroll check per animation frame — during fast
    // streaming the observer fires for every character, which on iOS
    // causes battery drain and choppy animation at 300+ callbacks/sec.
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
  const isVoiceDocked = useChatUiStore((s) => s.isVoiceDocked);
  const toggleVoiceDock = useChatUiStore((s) => s.toggleVoiceDock);
  const memoryInspectorOpen = useChatUiStore((s) => s.memoryInspectorOpen);
  const setMemoryInspectorOpen = useChatUiStore((s) => s.setMemoryInspectorOpen);
  const recalledHits = useChatUiStore((s) => s.recalledHits);
  const contradictions = useChatUiStore((s) => s.contradictions);
  const setMemoryData = useChatUiStore((s) => s.setMemoryData);

  const historyDrawerOpen = useChatUiStore((s) => s.historyDrawerOpen);
  const setHistoryDrawerOpen = useChatUiStore((s) => s.setHistoryDrawerOpen);
  // forensic-audit CRITICAL · the transport body reads conversationId from
  // this store, but drawer select/new/delete only updated useConversations'
  // local activeId — so follow-up messages were persisted to a stale/null
  // conversation. Sync the store on explicit drawer actions (the stream's
  // X-Conversation-Id write still owns the new-conversation-created case).
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);

  const chat = useChatStream();
  const convProps = useConversations({
    setMessages: chat.setMessages,
    onError: (msg) => console.error("useConversations error:", msg),
  });
  const { containerRef, endRef } = useScrollToBottom<HTMLDivElement>();

  // ── Island ref for iOS keyboard height compensation ──────────────────
  // On iOS PWA, window.innerHeight doesn't change when the software
  // keyboard opens, but window.visualViewport.height does. By setting
  // the island height to visualViewport.height the flex layout shrinks
  // naturally, keeping the composer above the keyboard.
  const islandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const syncHeight = () => {
      if (islandRef.current) {
        islandRef.current.style.height = `${vv.height}px`;
      }
    };
    vv.addEventListener("resize", syncHeight);
    vv.addEventListener("scroll", syncHeight);
    syncHeight();
    return () => {
      vv.removeEventListener("resize", syncHeight);
      vv.removeEventListener("scroll", syncHeight);
    };
  }, []);

  // ── Escape key closes the conversation drawer ────────────────────────
  const closeDrawer = useCallback(() => setHistoryDrawerOpen(false), [setHistoryDrawerOpen]);
  useEffect(() => {
    if (!historyDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [historyDrawerOpen, closeDrawer]);

  useEffect(() => {
    const handleCockpitEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ type: string; payload: any }>;
      const { type, payload } = customEvent.detail;
      
      if (type === "memory.recalled") {
        setMemoryData(payload.hits || [], payload.contradictions || []);
      }
    };

    window.addEventListener("cockpit-event", handleCockpitEvent);
    return () => window.removeEventListener("cockpit-event", handleCockpitEvent);
  }, [setMemoryData]);

  return (
    <div
      ref={islandRef}
      className="flex h-full w-full flex-col overflow-hidden bg-linear-to-br from-zinc-950 via-[#0a0a0a] to-black text-zinc-100"
    >
      {/* Header Area */}
      <header className="z-10 flex items-center justify-between border-b border-white/5 bg-black/40 px-4 py-3 backdrop-blur-xl">
        <h1 className="text-sm font-medium tracking-wide text-zinc-300 drop-shadow-sm">STATENOUR CHAT</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMemoryInspectorOpen(!memoryInspectorOpen)}
            aria-label="Memory inspector"
            aria-pressed={memoryInspectorOpen}
            className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold tracking-wider transition-all duration-300 active:scale-95 flex items-center gap-2 ${
              memoryInspectorOpen
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-[0_0_15px_-3px_rgba(245,158,11,0.3)]"
                : "bg-zinc-900/50 backdrop-blur-md border border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-white/10 hover:shadow-[0_0_10px_-2px_rgba(255,255,255,0.05)]"
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">INSPECTOR</span>
          </button>
          <button
            onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)}
            aria-label="Conversation history"
            aria-pressed={historyDrawerOpen}
            className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold tracking-wider transition-all duration-300 active:scale-95 flex items-center gap-2 ${
              historyDrawerOpen
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_-3px_rgba(16,185,129,0.3)]"
                : "bg-zinc-900/50 backdrop-blur-md border border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-white/10 hover:shadow-[0_0_10px_-2px_rgba(255,255,255,0.05)]"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">HISTORY</span>
          </button>
          <button
            onClick={toggleVoiceDock}
            aria-label={isVoiceDocked ? "Close voice" : "Open voice"}
            aria-pressed={isVoiceDocked}
            className={`rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold tracking-wider transition-all duration-300 active:scale-95 flex items-center gap-2 ${
              isVoiceDocked
                ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_15px_-3px_rgba(99,102,241,0.3)]"
                : "bg-zinc-900/50 backdrop-blur-md border border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 hover:border-white/10 hover:shadow-[0_0_10px_-2px_rgba(255,255,255,0.05)]"
            }`}
          >
            {isVoiceDocked ? (
              <MicOff className="w-3.5 h-3.5" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{isVoiceDocked ? "CLOSE VOICE" : "VOICE"}</span>
          </button>
        </div>
      </header>


      {/* Main Flex Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div 
          ref={containerRef}
          className="flex-1 overflow-y-auto"
        >
          <ChatMessageList
            messages={chat.messages}
            isLoading={chat.status === "streaming" || chat.status === "submitted"}
            isLoadingConvo={convProps.isLoadingConvo}
            error={chat.error}
            liveContextBlocksRef={chat.liveContextBlocksRef}
            onRetry={() => chat.regenerate()}
          />
          <div ref={endRef} />
        </div>

        {/* Voice overlay · 2026-07-11 review · RealtimeVoiceOverlay is
            fixed inset-0 (full-screen) by design, so the old w-80 "dock"
            wrapper was dead chrome that never constrained it. Render the
            overlay directly and drop the false docked framing. */}
        {isVoiceDocked && (
          <RealtimeVoiceOverlay open={isVoiceDocked} onClose={toggleVoiceDock} />
        )}
      </div>

      {/* Composer Area — pb-safe clears the fixed BottomTabBar (pulse ticker
          32px + nav 52px + env(safe-area-inset-bottom)) on all iPhones. */}
      <div className="border-t border-white/5 bg-black/40 backdrop-blur-xl px-4 pt-4 pb-safe z-10 relative">
        <ChatComposer chat={chat} />
      </div>

      <MemoryInspectorSidebar
        open={memoryInspectorOpen}
        onClose={() => setMemoryInspectorOpen(false)}
        hits={recalledHits}
        contradictions={contradictions}
      />

      {/* Conversation Drawer Overlay — full-width on mobile, fixed 320px sidebar on desktop */}
      {historyDrawerOpen && (
        <div
          className="absolute inset-y-0 left-0 w-full sm:w-80 bg-black/40 backdrop-blur-xl border-r border-white/5 z-50 flex flex-col"
          style={{ paddingLeft: "env(safe-area-inset-left, 0px)" }}
        >
          <ConversationDrawer
            convos={convProps.convos}
            activeId={convProps.activeId}
            pinnedConvoIds={convProps.pinnedIds}
            hasMoreConvos={convProps.hasMoreConvos}
            loadingMore={convProps.loadingMore}
            onLoadMore={convProps.loadMoreConvos}
            onSelectConvo={(id) => { setActiveConversationId(id); void convProps.loadConvo(id); setHistoryDrawerOpen(false); }}
            onDeleteConvo={(id, e) => {
              // 2026-07-11 review · only null the transport-store active id
              // AFTER the server delete succeeds. Nulling it eagerly meant a
              // failed delete left the convo loaded while the send body
              // carried conversationId:null → next send forked a new convo.
              const wasActive = convProps.activeId === id;
              void convProps.deleteConvo(id, e).then((ok) => {
                if (ok && wasActive) setActiveConversationId(null);
              });
            }}
            onRename={convProps.renameConvo}
            onTogglePin={convProps.togglePin}
            onNewChat={() => { setActiveConversationId(null); convProps.newChat(); setHistoryDrawerOpen(false); }}
            onToggleStar={(id) => {
              const convo = convProps.convos.find(c => c.id === id);
              if (convo) convProps.patchConvoFlag(id, "starred", !convo.starredAt);
            }}
            onToggleArchive={(id) => {
              // Note: archivedAt is not in the Convo type because we don't return them, 
              // but patchConvoFlag handles the archived toggle.
              convProps.patchConvoFlag(id, "archived", true);
            }}
            onToggleMute={(id) => {
              const convo = convProps.convos.find(c => c.id === id);
              if (convo) convProps.patchConvoFlag(id, "muted", !convo.mutedAt);
            }}
            onClose={() => setHistoryDrawerOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
