"use client";

import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStream } from "../hooks/use-chat-stream";
import { ChatComposer } from "./chat-composer";
import { ChatMessageList } from "./chat-message-list";
import { RealtimeVoiceOverlay } from "@/components/chat/realtime-voice-overlay";

export function ChatIsland() {
  const isVoiceDocked = useChatUiStore((s) => s.isVoiceDocked);
  const toggleVoiceDock = useChatUiStore((s) => s.toggleVoiceDock);

  const chat = useChatStream();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Header Area */}
      <header className="flex items-center justify-between border-b border-zinc-800/50 px-4 py-3 backdrop-blur-md">
        <h1 className="text-sm font-medium text-zinc-300">STATENOUR CHAT</h1>
        <button 
          onClick={toggleVoiceDock}
          className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold tracking-wider text-zinc-400 transition-transform active:scale-95 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {isVoiceDocked ? "CLOSE VOICE" : "DOCK VOICE"}
        </button>
      </header>

      {/* Main Flex Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <ChatMessageList 
            messages={chat.messages} 
            isLoading={chat.status === "streaming" || chat.status === "submitted"} 
            error={chat.error} 
          />
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
    </div>
  );
}
