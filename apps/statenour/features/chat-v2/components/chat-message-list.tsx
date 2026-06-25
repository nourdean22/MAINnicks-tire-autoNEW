"use client";

import { useState } from "react";
import { UIMessage } from "ai";
import { useChatUiStore } from "../stores/chat-ui-store";
import { ToolResultCard, isKnownToolName } from "@/components/chat/tool-result-card";
import { NickMessage } from "@/components/chat/nick-message";
import { UserMessageBubble, AssistantMessageShell } from "@/components/chat/message-bubble-shells";
import { MessageActionSheet } from "@/components/chat/message-action-sheet";
import { ReasoningTraceModal } from "@/components/chat/reasoning-trace-modal";
import { ReasoningTraceLive } from "@/components/chat/reasoning-trace-live";
import { extractContextBlocks, extractQuality, extractCitations } from "@/lib/chat/extract-message-metadata";
import { toast } from "sonner";

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard", { duration: 1500 });
    } catch {
      toast.error("Clipboard blocked by browser");
    }
  }
}

export function ChatMessageList({ 
  messages, 
  isLoading, 
  error,
  liveContextBlocksRef 
}: { 
  messages: UIMessage[], 
  isLoading: boolean, 
  error: Error | undefined,
  liveContextBlocksRef?: React.RefObject<any>
}) {
  const pending = useChatUiStore((s) => s.pending);
  const [actionSheetMsg, setActionSheetMsg] = useState<{ id: string; role: "user" | "assistant"; text: string } | null>(null);
  const [reasoningTraceMsg, setReasoningTraceMsg] = useState<string | null>(null);

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
        <div key={m.id} className={`flex animate-in fade-in slide-in-from-bottom-2 duration-300 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm ${
            m.role === "user" 
              ? "bg-zinc-800 text-zinc-100 shadow-[0_0_15px_-5px_rgba(0,0,0,0.3)]" 
              : "bg-zinc-900/80 backdrop-blur-md border border-white/5 text-zinc-200 shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)]"
          }`}>
            {m.parts?.map((part, i) => {
              if (part.type === "text") {
                if (m.role === "user") {
                  return (
                    <UserMessageBubble 
                      key={i} 
                      text={part.text} 
                      onClick={() => {}} 
                      onLongPress={() => setActionSheetMsg({ id: m.id, role: "user", text: part.text })} 
                    />
                  );
                }
                
                const contextBlocks = extractContextBlocks(m, liveContextBlocksRef?.current || null);
                const quality = extractQuality(m);
                const citations = extractCitations(m);

                const reasoningSteps = ((m as any).annotations || [])
                  .filter((a: any) => a?.type === "reasoning-step")
                  .map((a: any) => a.step);

                return (
                  <AssistantMessageShell
                    key={i}
                    text={part.text}
                    messageId={m.id}
                    onLongPress={() => setActionSheetMsg({ id: m.id, role: "assistant", text: part.text })}
                    contextBlocks={contextBlocks}
                    quality={quality}
                    citations={citations}
                    onRegen={() => { toast("Regen triggered (coming soon)"); }}
                  >
                    <ReasoningTraceLive steps={reasoningSteps} />
                    <NickMessage 
                      text={part.text} 
                      streaming={isLoading && m.id === messages[messages.length - 1]?.id} 
                      messageId={m.id}
                    />
                  </AssistantMessageShell>
                );
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
        <div key={p.tempId} className="flex justify-end opacity-60 animate-in fade-in slide-in-from-bottom-2 duration-300">
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

      {/* Action Sheet */}
      <MessageActionSheet 
        open={!!actionSheetMsg}
        onClose={() => setActionSheetMsg(null)}
        role={actionSheetMsg?.role || "user"}
        text={actionSheetMsg?.text || ""}
        onCopy={() => {
          if (actionSheetMsg?.text) copyToClipboard(actionSheetMsg.text);
        }}
        onSaveAsBelief={() => {
          toast("Save as belief triggered (memory port pending)");
        }}
        onSaveAsDecision={() => {
          toast("Save as decision triggered (memory port pending)");
        }}
        onShowReasoning={() => {
          if (actionSheetMsg?.id) {
            setReasoningTraceMsg(actionSheetMsg.id);
          }
          setActionSheetMsg(null);
        }}
      />

      {/* Reasoning Trace Modal */}
      <ReasoningTraceModal
        open={reasoningTraceMsg !== null}
        messageId={reasoningTraceMsg}
        onClose={() => setReasoningTraceMsg(null)}
      />
    </div>
  );
}
