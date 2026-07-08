"use client";

import { useState } from "react";
import { UIMessage } from "ai";
import { AlertTriangle } from "lucide-react";
import { useChatUiStore } from "../stores/chat-ui-store";
import { ToolResultCard, isKnownToolName } from "@/components/chat/tool-result-card";
import { NickMessage } from "@/components/chat/nick-message";
import { UserMessageBubble, AssistantMessageShell } from "@/components/chat/message-bubble-shells";
import { MessageActionSheet } from "@/components/chat/message-action-sheet";
import { ReasoningTraceModal } from "@/components/chat/reasoning-trace-modal";
import { ReasoningTraceLive } from "@/components/chat/reasoning-trace-live";
import { extractContextBlocks, extractQuality, extractCitations } from "@/lib/chat/extract-message-metadata";
import { toast } from "sonner";
import { useLazyRenderMessages } from "@/hooks/chat/use-lazy-render-messages";

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

/**
 * True when a message is a persisted stream-interruption stub —
 * stream-error-handler.ts writes an assistant row with
 * `streamingState:"errored"` on a mid/pre-stream failure. Hydrated onto the
 * UIMessage by use-conversations.ts.
 */
function isErroredAssistantTurn(m: UIMessage): boolean {
  return m.role === "assistant" && (m as { streamingState?: string }).streamingState === "errored";
}

/**
 * True when a reply was cut off by the output-token cap — persist-assistant-turn
 * maps finishReason==="length" → streamingState:"truncated". The text is useful
 * (a real partial answer), so unlike an errored turn we keep the bubble and just
 * append a "cut off · regenerate" affordance (2026-07-06 bug fix — chat-v2
 * previously rendered these as ordinary complete replies with no indication).
 */
function isTruncatedAssistantTurn(m: UIMessage): boolean {
  return m.role === "assistant" && (m as { streamingState?: string }).streamingState === "truncated";
}

/** The visible partial reply on an errored turn — `""` on a cold (pre-first-token) failure. */
function erroredPartialText(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

/**
 * The explicit interrupted-turn affordance for a persisted errored stub row
 * (2026-07-05 audit HIGH). The v2 parts-only render path never read
 * `streamingState`, so a reloaded errored turn used to show a BLANK assistant
 * bubble with no error chip and no retry (the MessageStatusBadge lived only on
 * the dead components/chat list). Shows the partial reply if any, plus a red
 * "interrupted" chip and a Retry button wired to the same regenerate.
 */
function InterruptedTurnCard({ message, onRetry }: { message: UIMessage; onRetry?: () => void }) {
  const partialText = erroredPartialText(message);
  return (
    <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="max-w-[85%] rounded-2xl border border-red-900/40 bg-red-950/25 px-5 py-3.5 shadow-sm">
        {partialText.length > 0 && (
          <div className="mb-3 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-200">{partialText}</div>
        )}
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle size={15} className="shrink-0" />
          <span className="text-[13px] font-semibold">Response interrupted</span>
        </div>
        <p className="mt-1 text-[11px] text-red-400/60">
          {partialText.length > 0
            ? "The reply was cut off — tap to regenerate."
            : "This turn failed before any reply — tap to try again."}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 rounded-lg bg-red-500/15 px-5 py-2 text-[12px] font-semibold text-red-300 transition-all hover:bg-red-500/25 active:scale-95"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatMessageList({
  messages,
  isLoading,
  isLoadingConvo,
  error,
  liveContextBlocksRef,
  onRetry,
}: {
  messages: UIMessage[],
  isLoading: boolean,
  isLoadingConvo?: boolean,
  error: Error | undefined,
  liveContextBlocksRef?: React.RefObject<any>,
  onRetry?: () => void,
}) {
  const pending = useChatUiStore((s) => s.pending);
  const setDraft = useChatUiStore((s) => s.setDraft);
  const [actionSheetMsg, setActionSheetMsg] = useState<{ id: string; role: "user" | "assistant"; text: string } | null>(null);
  const [reasoningTraceMsg, setReasoningTraceMsg] = useState<string | null>(null);

  // 2026-07-06 bug fix · tap-to-edit a sent message. The UserMessageBubble is
  // titled "Tap to edit" but chat-v2 wired onClick to a no-op, so there was no
  // way to edit/correct a previously-sent message. Load its text into the
  // composer draft (useLongPress now distinguishes a tap from a drag-select, so
  // this doesn't fire when the user selects text to copy).
  const editMessage = (text: string) => {
    setDraft(text);
    toast("Loaded into composer — edit and resend", { duration: 1600 });
  };

  const { renderedMessages, hasHidden, hiddenCount, showOlder } = useLazyRenderMessages(messages, isLoading);

  if (messages.length === 0 && pending.length === 0) {
    if (isLoadingConvo) {
      return (
        <div className="flex h-full flex-col items-center justify-center p-8">
          <div className="animate-pulse text-xs font-semibold uppercase tracking-widest text-zinc-600">
            Loading conversation...
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <h2 className="text-xl font-semibold text-zinc-400">NOUR OS</h2>
        <p className="mt-2 text-sm text-zinc-600">The cognitive force multiplier is online.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 pb-12">
      {/* Show-older banner — only when lazy-rendering a long conversation */}
      {hasHidden && (
        <button
          onClick={showOlder}
          className="mx-auto rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 active:scale-95"
        >
          Show {hiddenCount} older {hiddenCount === 1 ? "message" : "messages"}
        </button>
      )}

      {/* Real Messages */}
      {/* eslint-disable-next-line react-hooks/refs */}
      {renderedMessages.map((m) => {
        // A persisted errored stub row renders as an explicit interrupted-turn
        // card instead of the blank bubble the parts-only path below would
        // produce (2026-07-05 audit HIGH — see InterruptedTurnCard).
        if (isErroredAssistantTurn(m)) {
          return <InterruptedTurnCard key={m.id} message={m} onRetry={onRetry} />;
        }
        return (
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
                      key={`${m.id}-part-${i}`}
                      text={part.text}
                      onClick={() => editMessage(part.text)}
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
                  <div key={`${m.id}-part-${i}`}>
                    <AssistantMessageShell
                      text={part.text}
                      messageId={m.id}
                      onLongPress={() => setActionSheetMsg({ id: m.id, role: "assistant", text: part.text })}
                      contextBlocks={contextBlocks}
                      quality={quality}
                      citations={citations}
                      // 2026-07-04 audit P4 · was a dead "coming soon" toast —
                      // the QualityBar's REGEN chip (the quality-gate escape
                      // hatch) did nothing in chat-v2. Wire it to the same
                      // regenerate() the Retry card uses.
                      onRegen={() => onRetry?.()}
                    >
                      <ReasoningTraceLive steps={reasoningSteps} />
                      <NickMessage
                        text={part.text}
                        streaming={isLoading && m.id === messages[messages.length - 1]?.id}
                        messageId={m.id}
                      />
                    </AssistantMessageShell>
                    {isTruncatedAssistantTurn(m) && (
                      <button
                        onClick={() => onRetry?.()}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-all hover:bg-amber-500/[0.12] active:scale-95"
                      >
                        <AlertTriangle size={12} className="shrink-0" />
                        Response cut off — tap to regenerate
                      </button>
                    )}
                  </div>
                );
              }
              if (part.type.startsWith("tool-")) {
                const toolName = part.type.replace("tool-", "");
                if (isKnownToolName(toolName)) {
                  return (
                    <ToolResultCard
                      key={`${m.id}-part-${i}`}
                      toolName={toolName}
                      state={(part as any).state}
                      output={(part as any).output}
                    />
                  );
                }
                return (
                  <div key={`${m.id}-part-${i}`} className="mt-3 rounded-xl border border-zinc-700/50 bg-zinc-950 p-3 text-sm font-mono text-zinc-400">
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
        );
      })}

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
        <div className="mx-auto w-full max-w-md rounded-xl border border-red-900/40 bg-red-950/25 p-4 text-center">
          <div className="flex items-center justify-center gap-2 text-red-400 mb-1">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="text-[13px] font-semibold">Stream failed</span>
          </div>
          <p className="text-[11px] text-red-400/60 mb-3">
            Response was interrupted — tap below to try again
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-5 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 active:scale-95 text-red-300 text-[12px] font-semibold transition-all"
            >
              Retry
            </button>
          )}
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
        onEdit={
          actionSheetMsg?.role === "user"
            ? () => {
                if (actionSheetMsg?.text) editMessage(actionSheetMsg.text);
                setActionSheetMsg(null);
              }
            : undefined
        }
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
