"use client";

import Link from "next/link";
import { TypedToolCards } from "./typed-tool-cards";
import { useState, useCallback } from "react";
import type { UIMessage } from "ai";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, MoreHorizontal, Pencil, RotateCcw, ShieldCheck, Volume2, VolumeX, Wrench } from "lucide-react";
import { ChatMediaPart, type ChatFilePart } from "./chat-media-part";
import { MediaTimestampBar } from "./media-timestamp-bar";
import { useChatUiStore } from "../stores/chat-ui-store";
import { ToolResultCard, isKnownToolName } from "@/components/chat/tool-result-card";
import { NickMessage } from "@/components/chat/nick-message";
import { UserMessageBubble, AssistantMessageShell } from "@/components/chat/message-bubble-shells";
import { MessageActionSheet } from "@/components/chat/message-action-sheet";
import { ReasoningTraceModal } from "@/components/chat/reasoning-trace-modal";
import { ReasoningTraceLive } from "@/components/chat/reasoning-trace-live";
import { extractContextBlocks, extractQuality, extractCitations } from "@/lib/chat/extract-message-metadata";
import { sideEffectingTools } from "@/lib/ai/tools/catalog";
import { summarizeToolReceipts, formatToolReceipts, collapseRepeatedToolParts, isEmptyToolOutput } from "@/lib/ai/receipts/tool-receipt-summary";
import { toast } from "sonner";
import { useLazyRenderMessages } from "@/hooks/chat/use-lazy-render-messages";
import { trpc } from "@/lib/trpc/client";
import { haptic } from "@/lib/ui/haptic";
import type { TtsApi } from "../hooks/use-tts";

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

/**
 * 2026-08-30 · review P1. Regeneration replays the whole assistant turn —
 * tool calls included. If that turn executed a side-effecting tool
 * (quote, SMS, payment…), a casual Regenerate tap would re-run it on the
 * shop. The message row refuses to offer Regenerate on such turns; the
 * operator can still send a new message. Catalog-driven so a tool newly
 * flagged `sideEffecting` is covered without touching this file.
 */
function turnHasSideEffect(message: UIMessage): boolean {
  const names = new Set(sideEffectingTools());
  return (message.parts ?? []).some(
    (part) =>
      typeof part.type === "string" &&
      part.type.startsWith("tool-") &&
      names.has(part.type.replace("tool-", "")),
  );
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard", { duration: 1500 });
  } catch {
    toast.error("Clipboard blocked by browser");
  }
}

/**
 * 2026-08-28 · VISIBLE per-message actions.
 *
 * Copy / Edit / Read / Retry already existed — but only inside
 * MessageActionSheet, reachable ONLY by long-pressing a bubble. An
 * undiscoverable gesture is indistinguishable from a missing feature,
 * and the operator reported exactly that ("I want the read and edit
 * buttons underneath the messages themselves"). The sheet stays as the
 * overflow surface for the long tail (pin, fork, save-as-belief,
 * delete, feedback, reasoning); the four actions worth a thumb are now
 * always on screen, under the message they act on.
 *
 * Read is gated on tts.supported — a dead control that looks alive is
 * this repo's signature defect, and a Read button with no speech engine
 * behind it is exactly that.
 */
function MessageActionButton({
  onClick,
  icon,
  label,
  text,
  active,
}: {
  onClick: () => void;
  icon?: React.ReactNode;
  /** Optional compact text instead of an icon (e.g. "1.25x", "auto"). */
  text?: string;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      // 2026-08-30 · review P2: 48×48 minimum touch target (iOS-PWA
      // house rule; 32px visual glyph inside a 48px hit area).
      className={
        "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-[11px] transition " +
        (active
          ? "text-sky-300"
          : "text-fg-tertiary hover:bg-white/[0.05] hover:text-fg-secondary")
      }
    >
      {icon ?? text}
    </button>
  );
}

function MessageActions({
  role,
  text,
  isSpeaking,
  canSpeak,
  narrationOn,
  onToggleNarration,
  onCycleRate,
  rate,
  onCopy,
  onEdit,
  onSpeak,
  onStopSpeak,
  onRetry,
  onMore,
}: {
  role: "user" | "assistant";
  text: string;
  isSpeaking: boolean;
  canSpeak: boolean;
  /** Auto-narration preference (persisted). */
  narrationOn: boolean;
  onToggleNarration: () => void;
  onCycleRate: () => void;
  rate: number;
  onCopy: () => void;
  onEdit?: () => void;
  onSpeak: () => void;
  onStopSpeak: () => void;
  onRetry?: () => void;
  onMore: () => void;
}) {
  if (!text.trim()) return null;
  return (
    <div
      className={
        "mt-1.5 flex items-center gap-0.5 " + (role === "user" ? "justify-end" : "justify-start")
      }
      data-testid={`message-actions-${role}`}
    >
      <MessageActionButton onClick={onCopy} icon={<Copy size={14} />} label="Copy message" />
      {role === "user" && onEdit && (
        <MessageActionButton onClick={onEdit} icon={<Pencil size={14} />} label="Edit and resend" />
      )}
      {role === "assistant" && canSpeak && (
        <>
          <MessageActionButton
            onClick={isSpeaking ? onStopSpeak : onSpeak}
            icon={isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
            label={isSpeaking ? "Stop reading" : "Read aloud"}
            active={isSpeaking}
          />
          {/* 2026-08-30 · review P2: the composer's global read/rate chips
              were removed by the operator's no-dials directive — this row
              is where the persistent preference lives now. Auto-narration
              toggle (works with per-message Read; default off), rate while
              active. A preference with no surface is a dead control. */}
          {isSpeaking && (
            <MessageActionButton
              onClick={onCycleRate}
              label={`Narration speed ${rate}x (tap to cycle)`}
              text={`${rate}x`}
            />
          )}
          <MessageActionButton
            onClick={onToggleNarration}
            label={narrationOn ? "Auto-read replies is on (tap to turn off)" : "Auto-read replies is off (tap to turn on)"}
            // 2026-09-02 · was `narrationOn ? "auto" : undefined`, and the
            // button passes no icon -- so in the DEFAULT (off) state
            // `icon ?? text` resolved to undefined and every assistant
            // message carried a BLANK 44x44 tap target, labelled only to
            // screen readers. The on/off state is already carried by
            // `active` styling and aria-pressed, so the label is constant.
            text="auto"
            active={narrationOn && !isSpeaking}
          />
        </>
      )}
      {role === "assistant" && onRetry && (
        <MessageActionButton onClick={onRetry} icon={<RotateCcw size={14} />} label="Regenerate reply" />
      )}
      <MessageActionButton onClick={onMore} icon={<MoreHorizontal size={14} />} label="More actions" />
    </div>
  );
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
    output?: unknown;
  }>;
  if (toolParts.length === 0 && !traceId) return null;

  // 2026-08-29 · This chip said "N verified" over a green shield, computed
  // purely from `state === "output-available"` -- i.e. "the call did not
  // throw". The operator screenshotted "3 verified" sitting directly above
  // five "0 matches" cards. A search that found nothing is not a verified
  // anything, and "verified" is the word this product uses for receipts it
  // actually proved. Empty results now get counted and named on their own.
  const counts = summarizeToolReceipts(toolParts);
  const allEmpty = counts.total > 0 && counts.returned === 0 && counts.failed === 0 && counts.running === 0;
  // 2026-09-02 · The 2026-08-29 fix above caught "returned empty" and
  // missed "never ran". `allEmpty` requires total > 0, so a turn with NO
  // tool parts fell through to emerald and the count text was hidden by
  // the `total > 0` guard below -- a bare green verification shield over
  // a turn that proved nothing, which is the same over-claim in a new
  // shape. The chip mounts on any turn carrying a traceId, so this is
  // the common case for conversational replies, not an edge case.
  const ranNothing = counts.total === 0;
  const unproven = ranNothing || allEmpty;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-void/60 px-3 py-2 text-[11px] text-fg-secondary">
      <ShieldCheck
        size={13}
        aria-hidden="true"
        className={counts.failed > 0 ? "text-red-400" : unproven ? "text-fg-tertiary" : "text-emerald-400"}
      />
      {counts.total > 0 ? (
        <span>{formatToolReceipts(counts)}</span>
      ) : (
        <span className="text-fg-tertiary">no tools run</span>
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
  tts,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  isLoadingConvo?: boolean;
  error: Error | undefined;
  liveContextBlocksRef?: React.RefObject<any>;
  lastTraceIdRef?: React.RefObject<string | null>;
  onRetry?: () => void;
  onCommand?: (prompt: string) => void;
  tts?: TtsApi;
}) {
  const pending = useChatUiStore((state) => state.pending);
  const connection = useChatUiStore((state) => state.connection);
  const diagnosticReport = useChatUiStore((state) => state.diagnosticReport);
  const setDiagnosticReport = useChatUiStore((state) => state.setDiagnosticReport);
  const setDraft = useChatUiStore((state) => state.setDraft);
  const setEditingMessageId = useChatUiStore((state) => state.setEditingMessageId);
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
        // 2026-08-29 · When recall was broken the model retried the same
        // search several times in one turn and the transcript rendered five
        // byte-identical "0 matches" cards in a row -- on a phone that is
        // most of the viewport spent saying one thing. Only ADJACENT
        // identical runs collapse; a different part in between keeps them
        // separate, because the real sequence is information.
        const toolRunRepeat = new Map(
          collapseRepeatedToolParts(message.parts ?? []).map((r) => [r.index, r.repeat]),
        );
        return (
          <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed ${message.role === "user" ? "bg-surface text-fg" : "border border-glass bg-raised/85 text-fg"}`}>
              {message.parts?.map((part, index) => {
                if (part.type === "text") {
                  if (message.role === "user") {
                    // 2026-08-18 · tap-to-edit ARMS edit-resend (draft +
                    // editingMessageId) instead of bare prefill — sending
                    // used to APPEND a duplicate while the original stayed.
                    // The composer shows a visible editing banner w/ cancel.
                    return <UserMessageBubble key={`${message.id}-${index}`} text={part.text} onClick={() => { setDraft(part.text); setEditingMessageId(message.id); }} onLongPress={() => setActionSheetMsg({ id: message.id, role: "user", text: part.text })} />;
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
                        {/* BDN-312 · seek controls for any time refs in the
                            reply. Renders null unless a player is docked —
                            a seek control with nothing to seek is a dead
                            button. Suppressed mid-stream: a half-written
                            "4:1" parses as nothing and a half-written
                            "4:12" would flicker a control that then moves. */}
                        {!(isLoading && isLatestAssistant) && <MediaTimestampBar text={part.text} />}
                      </AssistantMessageShell>
                      {isTruncatedAssistantTurn(message) && <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> Response cut off — regenerate</button>}
                      {isRefusedAssistantTurn(message) && <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-300"><AlertTriangle size={12} /> Model refused — retry may route differently</button>}
                    </div>
                  );
                }
                if (part.type === "file") {
                  // Was: <img> for image/*, and one undifferentiated
                  // paperclip for everything else — no playback, no type
                  // distinction, no way to open the file. ChatMediaPart
                  // plays video/audio natively and always offers a link.
                  return <ChatMediaPart key={`${message.id}-${index}`} id={`${message.id}-${index}`} part={part as ChatFilePart} />;
                }
                if (part.type.startsWith("tool-")) {
                  const repeat = toolRunRepeat.get(index);
                  // Not the head of its run — an identical card already
                  // stands directly above it.
                  if (repeat === undefined) return null;
                  const toolName = part.type.replace("tool-", "");
                  const repeatBadge = repeat > 1 ? (
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-fg-tertiary">
                      ×{repeat} — same call, same result
                    </div>
                  ) : null;
                  if (isKnownToolName(toolName)) return (
                    <div key={`${message.id}-${index}`}>
                      <ToolResultCard toolName={toolName} state={(part as any).state} output={(part as any).output} />
                      {repeatBadge}
                    </div>
                  );
                  // "verified complete" was the same overclaim as the receipt
                  // chip: `output-available` only means the call returned.
                  return (
                    <div key={`${message.id}-${index}`} className="mt-2 rounded-lg border border-edge bg-void/50 p-3 text-xs text-fg-secondary">
                      {toolName}: {(part as any).state === "output-available" ? (isEmptyToolOutput((part as any).output) ? "returned no results" : "returned data") : (part as any).state === "output-error" ? "failed" : "running"}
                      {repeatBadge}
                    </div>
                  );
                }
                return null;
              })}
              {message.role === "assistant" && <ToolReceiptSummary message={message} traceId={isLatestAssistant ? lastTraceIdRef?.current : null} />}
              {message.role === "assistant" && <TypedToolCards message={message} />}
              {/* 2026-08-28 · always-visible actions. Suppressed on the
                  assistant turn that is still streaming: Copy would
                  capture a half-written reply and Read would narrate a
                  moving target. */}
              {!(isLoading && isLatestAssistant) && (() => {
                const bodyText = textOf(message);
                const role = message.role === "user" ? "user" : "assistant";
                return (
                  <MessageActions
                    role={role}
                    text={bodyText}
                    canSpeak={Boolean(tts?.supported)}
                    isSpeaking={tts?.speakingMessageId === message.id}
                    narrationOn={Boolean(tts?.enabled)}
                    onToggleNarration={() => tts?.toggle()}
                    onCycleRate={() => tts?.cycleRate()}
                    rate={tts?.rate ?? 1}
                    onCopy={() => void copyToClipboard(bodyText)}
                    onEdit={
                      role === "user"
                        ? () => {
                            setDraft(bodyText);
                            setEditingMessageId(message.id);
                            haptic.tap();
                          }
                        : undefined
                    }
                    onSpeak={() => tts?.speakMessage(message.id, bodyText)}
                    onStopSpeak={() => tts?.stop()}
                    // 2026-08-30 · review P1: never offer Regenerate on a
                    // turn that ran a side-effecting tool — replay would
                    // re-run it on the shop.
                    onRetry={
                      role === "assistant" && isLatestAssistant && !turnHasSideEffect(message)
                        ? onRetry
                        : undefined
                    }
                    onMore={() => setActionSheetMsg({ id: message.id, role, text: bodyText })}
                  />
                );
              })()}
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
        onEdit={actionSheetMsg?.role === "user" ? () => { if (actionSheetMsg?.text) { setDraft(actionSheetMsg.text); setEditingMessageId(actionSheetMsg.id); } } : undefined}
        onShowReasoning={() => {
          if (actionSheetMsg?.id) setReasoningTraceMsg(actionSheetMsg.id);
          setActionSheetMsg(null);
        }}
        onSpeak={
          actionSheetMsg?.role === "assistant" && tts?.supported
            ? () => tts.speakMessage(actionSheetMsg.id, actionSheetMsg.text)
            : undefined
        }
        isSpeaking={Boolean(actionSheetMsg && tts?.speakingMessageId === actionSheetMsg.id)}
        onStopSpeaking={tts ? () => tts.stop() : undefined}
        onSaveAsBelief={actionSheetMsg?.role === "assistant" ? onSaveAsBelief : undefined}
        onSaveAsDecision={actionSheetMsg?.role === "assistant" ? onSaveAsDecision : undefined}
      />
      <ReasoningTraceModal open={reasoningTraceMsg !== null} messageId={reasoningTraceMsg} onClose={() => setReasoningTraceMsg(null)} />
    </div>
  );
}
