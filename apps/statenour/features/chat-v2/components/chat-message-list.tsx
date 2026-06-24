"use client";

import { UIMessage } from "ai";
import { useChatUiStore } from "../stores/chat-ui-store";
import { ToolResultCard, isKnownToolName } from "@/components/chat/tool-result-card";

export function ChatMessageList({ messages, isLoading, error }: { messages: UIMessage[], isLoading: boolean, error: Error | undefined }) {
  const pending = useChatUiStore((s) => s.pending);

  if (messages.length === 0 && pending.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <h2 className="text-xl font-semibold text-zinc-400">NOUR OS</h2>
        <p className="mt-2 text-sm text-zinc-600">The cognitive force multiplier is online.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 pb-12">
      {/* Real Messages */}
      {messages.map((m) => (
        <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm ${
            m.role === "user" 
              ? "bg-zinc-800 text-zinc-100" 
              : "bg-zinc-900 border border-zinc-800/60 text-zinc-300"
          }`}>
            {m.parts?.map((part, i) => {
              if (part.type === "text") {
                return <div key={i}>{part.text}</div>;
              }
              if (part.type.startsWith("tool-")) {
                const toolName = part.type.replace("tool-", "");
                if (isKnownToolName(toolName)) {
                  return (
                    <ToolResultCard 
                      key={i} 
                      toolName={toolName} 
                      state={(part as any).state} 
                      output={(part as any).output} 
                    />
                  );
                }
                return (
                  <div key={i} className="mt-3 rounded-xl border border-zinc-700/50 bg-zinc-950 p-3 text-sm font-mono text-zinc-400">
                    <span className="text-zinc-500">[{toolName}]</span>
                    {(part as any).state === "output-available" && (
                      <div className="mt-2 pl-2 border-l border-zinc-700">Done.</div>
                    )}
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      ))}

      {/* Pending / Optimistic Messages */}
      {pending.map((p) => (
        <div key={p.tempId} className="flex justify-end opacity-60">
          <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-5 py-3.5 text-[15px] leading-relaxed text-zinc-100 shadow-sm">
            {p.text}
          </div>
        </div>
      ))}

      {/* Loading Indicator */}
      {isLoading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex justify-start">
           <div className="animate-pulse px-4 py-2 text-xs font-semibold uppercase tracking-widest text-zinc-500">
             Thinking...
           </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mx-auto w-full max-w-md rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-center text-sm text-red-400">
          Stream degraded. Check logs or retry.
        </div>
      )}
    </div>
  );
}
