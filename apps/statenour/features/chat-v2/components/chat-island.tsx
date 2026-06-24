"use client";

import { useEffect, useRef } from "react";

import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStream } from "../hooks/use-chat-stream";
import { ChatComposer } from "./chat-composer";
import { ChatMessageList } from "./chat-message-list";
import { RealtimeVoiceOverlay } from "@/components/chat/realtime-voice-overlay";
import { MemoryInspectorSidebar } from "@/components/chat/memory-inspector-sidebar";
import { Brain } from "lucide-react";

function useScrollToBottom<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // For simplicity in P0, we'll just scroll to the endRef whenever children change
    // but only if we were already at bottom. To implement "only when at bottom", 
    // we use a MutationObserver.
    
    const observer = new MutationObserver(() => {
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 150) {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
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

  const chat = useChatStream();
  const { containerRef, endRef } = useScrollToBottom<HTMLDivElement>();

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
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Header Area */}
      <header className="flex items-center justify-between border-b border-zinc-800/50 px-4 py-3 backdrop-blur-md">
        <h1 className="text-sm font-medium text-zinc-300">STATENOUR CHAT</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMemoryInspectorOpen(!memoryInspectorOpen)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold tracking-wider transition-transform active:scale-95 flex items-center gap-2 ${
              memoryInspectorOpen ? "bg-amber-500/20 text-amber-400" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            INSPECTOR
          </button>
          <button 
            onClick={toggleVoiceDock}
            className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold tracking-wider text-zinc-400 transition-transform active:scale-95 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {isVoiceDocked ? "CLOSE VOICE" : "DOCK VOICE"}
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
            error={chat.error} 
            liveContextBlocksRef={chat.liveContextBlocksRef}
          />
          <div ref={endRef} />
        </div>

        {/* Natively Docked Voice */}
        {isVoiceDocked && (
          <div className="w-80 border-l border-zinc-800/50 bg-black/40 backdrop-blur-lg">
            <RealtimeVoiceOverlay open={isVoiceDocked} onClose={toggleVoiceDock} />
          </div>
        )}
      </div>

      {/* Composer Area */}
      <div className="border-t border-zinc-800/50 bg-zinc-950 p-4">
        <ChatComposer chat={chat} />
      </div>

      <MemoryInspectorSidebar
        open={memoryInspectorOpen}
        onClose={() => setMemoryInspectorOpen(false)}
        hits={recalledHits}
        contradictions={contradictions}
      />
    </div>
  );
}
