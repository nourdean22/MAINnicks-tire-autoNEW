"use client";

import Link from "next/link";
import { TypedToolCards } from "./typed-tool-cards";
import { useState, useCallback } from "react";
import type { UIMessage } from "ai";
import { AlertTriangle, CheckCircle2, ExternalLink, Paperclip, ShieldCheck, Wrench } from "lucide-react";
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
import { trpc } from "@/lib/trpc/client";
import { haptic } from "@/lib/ui/haptic";

/** Stable djb2-ish content-hash key so re-saving the same reply reinforces the
 *  row (upsert by category+key) instead of duplicating. Mirrors the legacy
 *  save-as-* hook so keys match across both entry points. */
function memoryKey(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function textOf(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard", { duration: 1500 });
  } catch {
    toast.error("Clipboard blocked by browser");
  }
}

function isErroredAssistantTurn(message: UIMessage): boolean {
  return message.role === "assistant" && (message as { streamingState?: string }).streamingState === "errored";
}

function isTruncatedAssistantTurn(message: UIMessage): boolean {
  return message.role === "assistant" && (message as { streamingState?: string }).streamingState === "truncated";
}

// 2026-08-11 · Claude 5-family models can end a turn with stop_reason
// "refusal" (persisted as streamingState "refused"). Distinct from
// errored: the provider worked, the model declined — the chip says so
// instead of letting the turn read as an outage.
function isRefusedAssistantTurn(message: UIMessage): boolean {
  return message.role === "assistant" && (message as { streamingState?: string }).streamingState === "refused";
}

function ToolReceiptSummary({ message, traceId }: { message: UIMessage; traceId?: string | null }) {
  const toolParts = (message.parts ?? []).filter((part) => part.type.startsWith("tool-")) as Array<{
    type: string;
    state?: string;
  }>;
  if (toolParts.length === 0 && !traceId) return null;

  const complete = toolParts.filter((part) => part.state === "output-available").length;
  const failed = toolParts.filter((part) => part.state === "output-error").length;
  const running = toolParts.length - complete - failed;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-void/60 px-3 py-2 text-[11px] text-fg-secondary">
      <ShieldCheck size={13} className={failed > 0 ? "text-red-400" : "text-emerald-400"} />
      {toolParts.length > 0 && (
        <span>
          Tool receipts: {complete} verified{failed ? ` · ${failed} failed` : ""}{running ? ` · ${running} running` : ""}
        </span>
      )}
      {traceId && (
        <Link
          href={`/system/cockpit-observability?search=${encodeURIComponent(traceId)}`}
          className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-medium text-gold hover:bg-gold/10"
        >
          View trace <ExternalLink size={11} />
        </Link>
      )}
    </div>
  );
}

function InterruptedTurnCard({ message, onRetry }: { message: UIMessage; onRetry?: () => void }) {
  const partialText = textOf(message);
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl border border-red-900/40 bg-red-950/25 px-5 py-3.5">
        {partialText && <div className="mb-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{partialText}</div>}
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle size={15} />
          <span className="text-[13px] font-semibold">Response interrupted</span>
        </div>
        <p className="mt-1 text-[11px] text-red-300/60">{partialText ? "The reply was cut off." : "This turn failed before any reply."}</p>
        {onRetry && <button onClick={onRetry} className="mt-3 rounded-lg bg-red-500/15 px-5 py-2 text-[12px] font-semibold text-red-300">Retry</button>}
      </div>
    </div>
  );
}

const COMMANDS = [
  { label: "Run my command brief", prompt: "/today", detail: "Done, open, top stat, one warning" },
  { label: "Find the biggest revenue leaks", prompt: "Show me the biggest revenue leaks right now using live shop data. Rank the actions by money and urgency.", detail: "Leads, estimates, callbacks" },
  { label: "Plan today around reality", prompt: "Plan the rest of today using my calendar, open missions, energy, and current commitments. Give me a realistic execution order.", detail: "Calendar + missions + energy" },
  { label: "Show verified recent actions", prompt: "/receipts", detail: "What Nick and the system actually did" },
];

export function ChatMessageList({
  messages,
  isLoading,
  isLoadingConvo,
  error,
  liveContextBlocksRef,
  lastTraceIdRef,
  onRetry,
  onCommand,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  isLoadingConvo?: boolean;
  error: Error | undefined;
  liveContextBlocksRef?: React.RefObject<any>;
  lastTraceIdRef?: React.RefObject<string | null>;
  onRetry?: () => void;
  onCommand?: (prompt: string) => void;
}) {
  const pending = useChatUiStore((state) => state.pending);
  const connection = useChatUiStore((state) => state.connection);
  const diagnosticReport = useChatUiStore((state) => state.diagnosticReport);
  const setDiagnosticReport = useChatUiStore((state) => state.setDiagnosticReport);
  const setDraft = useChatUiStore((state) => state.setDraft);
  const [actionSheetMsg, setActionSheetMsg] = useState<{ id: string; role: "user" | "assistant"; text: string } | null>(null);
  const [reasoningTraceMsg, setReasoningTraceMsg] = useState<string | null>(null);

  // 2026-07-22 · restore the save-as-* long-press actions the v2 rewrite dropped.
  // Assistant-only: they promote Nick's reply into his trusted memory (belief) or
  // the decision loop. recordMemory upserts by (category, key) — the content-hash
  // key means re-saving reinforces instead of duplicating.
  const recordMemory = trpc.brain.recordMemory.useMutation();
  const harvestBeliefs = trpc.brain.harvestBeliefs.useMutation();

  const onSaveAsBelief = useCallback(async () => {
    if (!actionSheetMsg) return;
    try {
      await harvestBeliefs.mutateAsync();
      const content = actionSheetMsg.text.slice(0, 500);
      await recordMemory.mutateAsync({
        category: "belief_manual",
        key: `belief_manual:${memoryKey(content)}`,
        content,
        source: "chat:save-as-belief",
      });
      haptic.success();
      toast.success("Saved as belief");
    } catch {
      haptic.error();
      toast.error("Couldn't save as belief — try again");
    }
  }, [actionSheetMsg, harvestBeliefs, recordMemory]);

  const onSaveAsDecision = useCallback(async () => {
    if (!actionSheetMsg) return;
    try {
      const content = actionSheetMsg.text.slice(0, 500);
      await recordMemory.mutateAsync({
        category: "decision_manual",
        key: `decision_manual:${memoryKey(content)}`,
        content,
        source: "chat:save-as-decision",
      });
      haptic.success();
      toast.success("Saved as decision");
    } catch {
      haptic.error();
      toast.error("Couldn't save as decision — try again");
    }
  }, [actionSheetMsg, recordMemory]);
  const { renderedMessages, hasHidden, hiddenCount, showOlder } = useLazyRenderMessages(messages, isLoading);

  if (messages.length === 0 && pending.length === 0 && !diagnosticReport) {
    if (isLoadingConvo) {
      return <div className="flex h-full items-center justify-center p-8 text-xs font-semibold uppercase tracking-widest text-fg-tertiary">Loading conversation…</div>;
    }
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center p-5 sm:p-8">
        <div className="mb-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold">NOUR OS · operator chat</p>
          <h2 className="mt-2 text-2xl font-semibold text-fg">What are we solving?</h2>
          <p className="mt-2 text-sm text-fg-secondary">
            Live business data, memory, tasks, research, and verified system actions from one surface.
          </p>
          {connection !== "online" && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300">
              <AlertTriangle size={12} /> Chat is degraded — run /diagnose for an independent check.
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {COMMANDS.map((command) => (
            <button
              key={command.label}
              type="button"
              onClick={() => onCommand?.(command.prompt)}
              className="rounded-xl border border-edge bg-raised p-4 text-left transition hover:border-gold/35 hover:bg-elevated"
            >
              <div className="flex items-start gap-3">
                <Wrench size={16} className="mt-0.5 shrink-0 text-gold" />
                <div>
                  <p className="text-sm font-semibold text-fg">{command.label}</p>
                  <p className="mt-1 text-[11px] text-fg-tertiary">{command.detail}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    // 2026-08-08 · role="log" = implicit polite live region that announces
    // ADDITIONS only (new turns), never re-reads the feed. aria-busy while
    // a reply streams batches those announcements until the turn settles,
    // so screen readers hear one finished message instead of per-token
    // spam. Completion itself is announced by the always-mounted
    // role="status" region at the bottom of this container.
    <div
      role="log"
      aria-label="Chat messages"
      aria-busy={isLoading}
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 pb-12"
    >
      {diagnosticReport && (
        <section className="rounded-xl border border-gold/25 bg-gold/[0.04] p-4">
          <div className="mb-3 flex items-center gap-2 text-gold">
            <CheckCircle2 size={15} />
            <h3 className="text-[12px] font-bold uppercase tracking-wider">Independent chat diagnostic</h3>
            <button onClick={() => setDiagnosticReport(null)} className="ml-auto text-[11px] text-fg-tertiary hover:text-fg">Dismiss</button>
          </div>
          <NickMessage text={diagnosticReport} streaming={false} messageId="chat-diagnostic" />
        </section>
      )}

      {hasHidden && <button onClick={showOlder} className="mx-auto rounded-full border border-edge bg-raised px-4 py-1.5 text-xs text-fg-secondary">Show {hiddenCount} older messages</button>}

      {renderedMessages.map((message, messageIndex) => {
        if (isErroredAssistantTurn(message)) return <InterruptedTurnCard key={message.id} message={message} onRetry={onRetry} />;
        const isLatestAssistant = message.role === "assistant" && messageIndex === renderedMessages.length - 1;
        return (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed ${message.role === "user" ? "bg-surface text-fg" : "border border-glass bg-raised/85 text-fg"}`}>
              {message.parts?.map((part, index) => {
                if (part.type === "text") {
                  if (message.role === "user") {
                    return <UserMessageBubble key={`${message.id}-${index}`} text={part.text} onClick={() => setDraft(part.text)} onLongPress={() => setActionSheetMsg({ id: message.id, role: "user", text: part.text })} />;
                  }
                  const contextBlocks = extractContextBlocks(message, liveContextBlocksRef?.current || null);
                  const quality = extractQuality(message);
                  const citations = extractCitations(message);
                  const reasoningSteps = ((message.parts as any[]) || []).filter((item) => item?.type === "data-reasoningStep").map((item) => item.data);
                  return (
                    <div key={`${message.id}-${index}`}>
                      <AssistantMessageShell text={part.text} messageId={message.id} onLongPress={() => setActionSheetMsg({ id: message.id, role: "assistant", text: part.text })} contextBlocks={contextBlocks} quality={quality} citations={citations} onRegen={() => onRetry?.()}>
                        <ReasoningTraceLive steps={reasoningSteps} />
                        <NickMessage text={part.text} streaming={isLoading && isLatestAssistant} messageId={message.id} />
                      </AssistantMessageShell>
                      {isTruncatedAssistantTurn(message) && <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> Response cut off — regenerate</button>}
                      {isRefusedAssistantTurn(message) && <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> Model refused — retry may route differently</button>}
                    </div>
                  );
                }
                if (part.type === "file") {
                  const file = part as { url?: string; mediaType?: string; filename?: string };
                  if (file.url && file.mediaType?.startsWith("image/")) return <img key={`${message.id}-${index}`} src={file.url} alt={file.filename || "attached image"} className="mt-2 max-h-64 rounded-lg border border-glass" />;
                  return <div key={`${message.id}-${index}`} className="mt-2 flex items-center gap-2 rounded-lg border border-edge px-3 py-2 text-xs text-fg-secondary"><Paperclip size={12} />{file.filename || "attachment"}</div>;
                }
                if (part.type.startsWith("tool-")) {
                  const toolName = part.type.replace("tool-", "");
                  if (isKnownToolName(toolName)) return <ToolResultCard key={`${message.id}-${index}`} toolName={toolName} state={(part as any).state} output={(part as any).output} />;
                  return <div key={`${message.id}-${index}`} className="mt-2 rounded-lg border border-edge bg-void/50 p-3 text-xs text-fg-secondary">{toolName}: {(part as any).state === "output-available" ? "verified complete" : (part as any).state === "output-error" ? "failed" : "running"}</div>;
                }
                return null;
              })}
              {message.role === "assistant" && <ToolReceiptSummary message={message} traceId={isLatestAssistant ? lastTraceIdRef?.current : null} />}
              {message.role === "assistant" && <TypedToolCards message={message} />}
            </div>
          </div>
        );
      })}

      {pending.map((item) => (
        <div key={item.tempId} className="flex justify-end opacity-75">
          <div className="max-w-[88%] rounded-2xl bg-surface px-5 py-3.5 text-[15px] text-fg">
            <p className="whitespace-pre-wrap">{item.text}</p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-tertiary">{item.status === "resolving-context" ? "Resolving live context…" : "Sending…"}</p>
          </div>
        </div>
      ))}

      {isLoading && messages[messages.length - 1]?.role === "user" && <div className="px-4 py-2 text-xs font-semibold uppercase tracking-widest text-fg-tertiary">Thinking…</div>}
      {/* 2026-07-29 · was a hardcoded "Stream failed." that DISCARDED the
          server's message — an image turn dying for want of a vision model
          looked exactly like a network blip. The server authors a safe
          category string (never raw provider text); render it. */}
      {error && (
        <div className="mx-auto rounded-xl border border-red-900/40 bg-red-950/25 p-4 text-center text-sm text-red-300">
          {error.message?.trim() || "Stream failed."}
          {onRetry && (
            <button onClick={onRetry} className="ml-2 underline">
              Retry
            </button>
          )}
        </div>
      )}

      {/* 2026-08-08 · always-mounted completion announcer — polite regions
          must pre-exist to announce (people-scoring-panel is the in-repo
          reference; mobile-a11y.test.tsx §A10 pins the rule). Text is
          derived, not effect-driven: it flips exactly once per stream
          (busy → idle with an assistant turn last), which is the one
          change AT announces. */}
      <div role="status" aria-live="polite" className="sr-only">
        {!isLoading && messages[messages.length - 1]?.role === "assistant"
          ? "Nick finished replying"
          : ""}
      </div>

      <MessageActionSheet
        open={Boolean(actionSheetMsg)}
        onClose={() => setActionSheetMsg(null)}
        role={actionSheetMsg?.role || "user"}
        text={actionSheetMsg?.text || ""}
        onCopy={() => actionSheetMsg?.text && void copyToClipboard(actionSheetMsg.text)}
        onEdit={actionSheetMsg?.role === "user" ? () => actionSheetMsg?.text && setDraft(actionSheetMsg.text) : undefined}
        onShowReasoning={() => {
          if (actionSheetMsg?.id) setReasoningTraceMsg(actionSheetMsg.id);
          setActionSheetMsg(null);
        }}
        onSaveAsBelief={actionSheetMsg?.role === "assistant" ? onSaveAsBelief : undefined}
        onSaveAsDecision={actionSheetMsg?.role === "assistant" ? onSaveAsDecision : undefined}
      />
      <ReasoningTraceModal open={reasoningTraceMsg !== null} messageId={reasoningTraceMsg} onClose={() => setReasoningTraceMsg(null)} />
    </div>
  );
}
