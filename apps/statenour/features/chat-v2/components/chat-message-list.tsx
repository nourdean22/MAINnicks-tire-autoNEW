"use client";

import Link from "next/link";
import { TypedToolCards } from "./typed-tool-cards";
import { Fragment, useState, useCallback } from "react";
import type { UIMessage } from "ai";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, MoreHorizontal, Pencil, RotateCcw, ShieldCheck, Volume2, VolumeX } from "lucide-react";
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
import { summarizeToolReceipts, formatToolReceipts, collapseRepeatedToolParts, isEmptyToolOutput, isSoftFailedToolOutput } from "@/lib/ai/receipts/tool-receipt-summary";

/** The one-line status for a tool with no card; same words as ToolResultCard for a refusal or soft failure. */
function noCardToolLine(state: unknown, output: unknown): string {
  if (state === "output-error") return "failed";
  if (state !== "output-available") return "running";
  if (isSoftFailedToolOutput(output)) {
    return (output as { error?: unknown }).error === "approval_required" ? "Waiting for approval" : "Not done";
  }
  return isEmptyToolOutput(output) ? "returned no results" : "returned data";
}
import { toast } from "sonner";
import { useLazyRenderMessages } from "@/hooks/chat/use-lazy-render-messages";
import { postFeedback } from "@/hooks/chat/use-nick-message-actions";
import { trpc } from "@/lib/trpc/client";
import { haptic } from "@/lib/ui/haptic";
import type { TtsApi } from "../hooks/use-tts";
import { stoppedLabel, type StoppedTurn } from "../lib/turn-lifecycle";
import { turnHasSideEffect } from "../lib/turn-side-effect";
import { chatErrorText } from "../lib/chat-error-text";

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
      // 44px: the floor tests/e2e/target-size.spec.ts pins.
      className={
        "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-control px-2 text-[11px] transition " +
        (active
          ? "text-sky-300"
          : "text-fg-tertiary hover:bg-surface-interactive hover:text-fg-secondary")
      }
    >
      {icon ?? text}
    </button>
  );
}

function MessageActions({
  role,
  text,
  compact,
  isSpeaking,
  canSpeak,
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
  /** 09-F22: older turns: More only (the sheet holds Copy, Edit, Read). */
  compact: boolean;
  isSpeaking: boolean;
  canSpeak: boolean;
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
      {!compact && <MessageActionButton onClick={onCopy} icon={<Copy size={14} />} label="Copy message" />}
      {!compact && role === "user" && onEdit && (
        <MessageActionButton onClick={onEdit} icon={<Pencil size={14} />} label="Edit and resend" />
      )}
      {/* An older reply read from the sheet keeps its Stop on the row. The
          auto-read preference is global, so it lives in the island header. */}
      {role === "assistant" && canSpeak && (!compact || isSpeaking) && (
        <>
          <MessageActionButton
            onClick={isSpeaking ? onStopSpeak : onSpeak}
            icon={isSpeaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
            label={isSpeaking ? "Stop reading" : "Read aloud"}
            active={isSpeaking}
          />
          {isSpeaking && (
            <MessageActionButton
              onClick={onCycleRate}
              label={`Narration speed ${rate}x (tap to cycle)`}
              text={`${rate}x`}
            />
          )}
        </>
      )}
      {!compact && role === "assistant" && onRetry && (
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
    <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-tertiary">
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
      {/* 10-X4: the page reads no ?search= param, so it opens unfiltered:
          name the page, do not promise this turn's trace. */}
      {traceId && (
        <Link
          href="/system/cockpit-observability"
          className="ml-auto inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-fg-secondary transition-colors hover:text-fg sm:min-h-8"
        >
          Observability <ExternalLink size={11} />
        </Link>
      )}
    </div>
  );
}

/** 09-F29 · a stopped turn is marked where Nick's reply sits: a static rule
 *  and the word, no colour claim. -mt-5 pulls it back under the turn the
 *  list's gap-7 would otherwise push it away from. */
function StoppedRule({ label }: { label: string }) {
  return (
    <div data-testid="stopped-turn" className="-mt-5 flex items-center gap-2 font-mono text-[11px] text-fg-tertiary">
      <span aria-hidden className="h-px w-6 bg-edge-default" />
      {label}
    </div>
  );
}

function InterruptedTurnCard({ message, onRetry }: { message: UIMessage; onRetry?: () => void }) {
  const partialText = textOf(message);
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-surface border border-rose-500/30 bg-content px-4 py-3">
        {partialText && <div className="mb-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg">{partialText}</div>}
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle size={15} />
          <span className="text-[13px] font-semibold">Response interrupted</span>
        </div>
        <p className="mt-1 text-[11px] text-red-300">{partialText ? "The reply was cut off." : "This turn failed before any reply."}</p>
        {onRetry && <button onClick={onRetry} className="mt-3 min-h-11 rounded-control bg-red-500/15 px-5 py-2 text-[12px] font-semibold text-red-300">Retry</button>}
      </div>
    </div>
  );
}

// Section 5.10 (2026-09-08): personal-OS starters. The shop-flavoured one left with /market
// for the Nick's Tire admin; the repeated wrench carried no meaning and is gone (5.5).
const COMMANDS = [
  { label: "Run my command brief", prompt: "/today", detail: "Done, open, top stat, one warning" },
  { label: "What needs my judgment", prompt: "What needs my judgment right now? List the decisions parked on me, oldest first, and what each one unblocks.", detail: "Parked decisions, oldest first" },
  { label: "Plan today around reality", prompt: "Plan the rest of today using my calendar, open missions, energy, and current commitments. Give me a realistic execution order.", detail: "Calendar + missions + energy" },
  { label: "Show verified recent actions", prompt: "/receipts", detail: "What Nick and the system actually did" },
];

export function ChatMessageList({
  messages,
  isLoading,
  isLoadingConvo,
  loadFailedId,
  onRetryLoad,
  error,
  hold,
  liveContextBlocks,
  lastTraceId,
  onRetry,
  onCommand,
  tts,
  stopped,
  conversationId,
}: {
  messages: UIMessage[];
  isLoading: boolean;
  isLoadingConvo?: boolean;
  /** The conversation whose open failed (hooks/use-conversations.ts); the list offers Retry instead of the starters. */
  loadFailedId?: string | null;
  onRetryLoad?: (id: string) => void;
  error: Error | undefined;
  /** The current Retry hold's words (W3b): the toast's RETRY_* constant, kept on the error card. */
  hold?: string | null;
  liveContextBlocks?: Parameters<typeof extractContextBlocks>[1];
  lastTraceId?: string | null;
  onRetry?: () => void;
  onCommand?: (prompt: string) => void;
  tts?: TtsApi;
  /** The turn the operator stopped (09-F29). */
  stopped?: StoppedTurn | null;
  /** Lets thumbs on the latest reply resolve before its DB id is bound. */
  conversationId?: string | null;
}) {
  const pending = useChatUiStore((state) => state.pending);
  const privateMode = useChatUiStore((state) => state.privateMode);
  const connection = useChatUiStore((state) => state.connection);
  const diagnosticReport = useChatUiStore((state) => state.diagnosticReport);
  const setDiagnosticReport = useChatUiStore((state) => state.setDiagnosticReport);
  // 09-F11 · a tap on a sent message never overwrites a typed draft in one go.
  const offerDraft = useChatUiStore((state) => state.offerDraft);
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
      toast.error("Couldn't save as belief. Try again.");
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
      toast.error("Couldn't save as decision. Try again.");
    }
  }, [actionSheetMsg, recordMemory]);

  // 06-F9-N1: thumbs from the sheet. The server falls back to the newest
  // reply in the conversation when the id is not a DB id yet, so only the
  // latest reply sends the conversation id: an older one would label the
  // wrong row.
  const lastMessage = messages[messages.length - 1];
  const latestAssistantId = lastMessage?.role === "assistant" ? lastMessage.id : null;
  const onFeedback = useCallback(
    async (positive: boolean) => {
      if (!actionSheetMsg) return;
      const ok = await postFeedback({
        messageId: actionSheetMsg.id,
        positive,
        snippet: actionSheetMsg.text,
        conversationId: actionSheetMsg.id === latestAssistantId ? (conversationId ?? null) : null,
      });
      if (ok) {
        haptic.success();
        toast.success("Feedback saved", { duration: 1500 });
      } else {
        haptic.error();
        toast.error("Couldn't save your feedback. Try again.");
      }
    },
    [actionSheetMsg, latestAssistantId, conversationId],
  );
  const { renderedMessages, hasHidden, hiddenCount, showOlder } = useLazyRenderMessages(messages, isLoading);
  const latestUserIndex = renderedMessages.map((m) => m.role).lastIndexOf("user");
  // A stop recorded in another conversation names a message that is not here.
  const stoppedHere = stopped && !isLoading && messages.some((m) => m.id === stopped.messageId) ? stopped : null;

  if (messages.length === 0 && pending.length === 0 && !diagnosticReport) {
    if (isLoadingConvo) {
      return <div className="flex h-full items-center justify-center p-8 text-[13px] text-fg-tertiary">Loading conversation…</div>;
    }
    // A failed open is not an empty chat: the active conversation did not move (chat-island.tsx
    // openConversation), so the starters would invite a send into the wrong place.
    if (loadFailedId) {
      return (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-[15px] text-fg">
          <p>Couldn&apos;t open that conversation. Nothing was changed.</p>
          {onRetryLoad && (
            <button type="button" onClick={() => onRetryLoad(loadFailedId)} className="min-h-11 rounded-control border border-edge-default px-4 font-medium text-fg hover:bg-surface">
              Retry
            </button>
          )}
        </div>
      );
    }
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center p-5 sm:p-8">
        <div className="mb-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">NICK</p>
          <h2 className="mt-2 text-[26px] font-semibold tracking-[-0.02em] text-fg">What are we solving?</h2>
          <p className="mt-2 max-w-[48ch] text-[15px] leading-relaxed text-fg-secondary">
            Live business data, memory, tasks, research, and verified system actions from one surface.
          </p>
          {(connection === "degraded" || connection === "offline") && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[12px] text-amber-300">
              <AlertTriangle size={12} /> Chat is degraded. Run /diagnose for an independent check.
            </p>
          )}
        </div>
        <ul className="border-t border-edge-subtle">
          {COMMANDS.map((command) => (
            <li key={command.label} className="border-b border-edge-subtle">
              <button
                type="button"
                onClick={() => onCommand?.(command.prompt)}
                className="group flex min-h-[56px] w-full items-center gap-3 rounded-control px-1 py-2 text-left transition-colors duration-[var(--motion-state)] hover:bg-surface"
              >
                <span className="notch h-4 shrink-0 opacity-0 transition-opacity duration-[var(--motion-state)] group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium text-fg">{command.label}</span>
                  <span className="block text-[12.5px] text-fg-tertiary">{command.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    // role="log" is an implicit polite live region, and some screen readers
    // ignore aria-busy and read every streamed token (09-F5). aria-live="off"
    // silences the log; the always-mounted role="status" region at the bottom
    // announces each finished reply.
    <div
      role="log"
      aria-label="Chat messages"
      aria-live="off"
      aria-busy={isLoading}
      className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-5 pb-12 sm:px-6"
    >
      {diagnosticReport && (
        <section className="rounded-surface border border-edge-subtle bg-content p-4">
          <div className="mb-3 flex items-center gap-2 text-fg-secondary">
            <CheckCircle2 size={15} />
            <h3 className="font-mono text-[11px] uppercase tracking-[0.12em]">Independent chat diagnostic</h3>
            <button onClick={() => setDiagnosticReport(null)} className="ml-auto min-h-11 px-2 text-[11px] text-fg-tertiary hover:text-fg sm:min-h-8">Dismiss</button>
          </div>
          <NickMessage text={diagnosticReport} streaming={false} messageId="chat-diagnostic" />
        </section>
      )}

      {hasHidden && <button onClick={showOlder} className="mx-auto min-h-11 rounded-full border border-edge-default bg-surface px-4 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg sm:min-h-8">Show {hiddenCount} older messages</button>}

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
          <Fragment key={message.id}>
          <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
            {/* UI v2 (2026-10-01): the operator's message is a compact graphite block; Nick's
                reply is editorial prose in the reading column — no bubble, no border. The
                NICK designation replaces an avatar. docs/design/ui-v2/SURFACES.md §E1. */}
            <div
              className={
                message.role === "user"
                  ? "max-w-[80%] rounded-surface bg-surface-interactive px-4 py-3 text-[15px] leading-relaxed text-fg"
                  : "w-full min-w-0 text-[16px] leading-[1.6] text-fg"
              }
            >
              {/* 09-F20: the speaker, for screen readers; the visual NICK stays aria-hidden. */}
              <span className="sr-only">{message.role === "user" ? "You:" : "Nick:"}</span>
              {message.role === "assistant" && (
                <p className="mb-2 font-mono text-[11px] tracking-[0.1em] text-fg-tertiary" aria-hidden>
                  NICK
                </p>
              )}
              {message.parts?.map((part, index) => {
                if (part.type === "text") {
                  if (message.role === "user") {
                    // 2026-08-18 · tap-to-edit ARMS edit-resend (draft +
                    // editingMessageId) instead of bare prefill — sending
                    // used to APPEND a duplicate while the original stayed.
                    // The composer shows a visible editing banner w/ cancel.
                    return <UserMessageBubble key={`${message.id}-${index}`} text={part.text} onClick={() => offerDraft(part.text, message.id)} onLongPress={() => setActionSheetMsg({ id: message.id, role: "user", text: part.text })} />;
                  }
                  const contextBlocks = extractContextBlocks(message, liveContextBlocks ?? null);
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
                      {isTruncatedAssistantTurn(message) && <button onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-control border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-300 sm:min-h-8"><AlertTriangle size={12} /> Response cut off. Regenerate</button>}
                      {isRefusedAssistantTurn(message) && <button onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-control border border-amber-500/30 px-2.5 py-1 text-[11px] text-amber-300 sm:min-h-8"><AlertTriangle size={12} /> Model refused. A retry may route differently</button>}
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
                    <div className="mt-1 font-mono text-[11px] text-fg-tertiary">
                      ×{repeat}: same call, same result
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
                    <div key={`${message.id}-${index}`} className="mt-2 rounded-surface border border-edge-subtle bg-content px-3 py-2 font-mono text-[12px] text-fg-secondary">
                      {toolName}: {noCardToolLine((part as any).state, (part as any).output)}
                      {repeatBadge}
                    </div>
                  );
                }
                return null;
              })}
              {message.role === "assistant" && <ToolReceiptSummary message={message} traceId={isLatestAssistant ? lastTraceId ?? null : null} />}
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
                    compact={!(isLatestAssistant || messageIndex === latestUserIndex)}
                    canSpeak={Boolean(tts?.supported)}
                    isSpeaking={tts?.speakingMessageId === message.id}
                    onCycleRate={() => tts?.cycleRate()}
                    rate={tts?.rate ?? 1}
                    onCopy={() => void copyToClipboard(bodyText)}
                    onEdit={
                      role === "user"
                        ? () => {
                            offerDraft(bodyText, message.id);
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
          {stoppedHere?.messageId === message.id && <StoppedRule label={stoppedLabel(stoppedHere.outcome)} />}
          </Fragment>
        );
      })}

      {pending.map((item) => (
        <div key={item.tempId} className="flex justify-end">
          <div className="max-w-[80%] rounded-surface bg-surface-interactive px-4 py-3 text-[15px] text-fg">
            <p className="whitespace-pre-wrap">{item.text}</p>
            <p className="mt-1 font-mono text-[11px] text-fg-tertiary">{item.status === "resolving-context" ? "Resolving live context…" : "Sending…"}</p>
          </div>
        </div>
      ))}

      {isLoading && messages[messages.length - 1]?.role === "user" && (
        <div className="flex items-center gap-2 px-1 py-1 font-mono text-[11.5px] text-fg-tertiary">
          <span aria-hidden className="pulse-live inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
          Working…
        </div>
      )}
      {/* 2026-07-29 · was a hardcoded "Stream failed." that DISCARDED the
          server's message — an image turn dying for want of a vision model
          looked exactly like a network blip. The server authors a safe
          category string (never raw provider text); render it. 04-X13: a
          pre-stream failure is the raw JSON body, so chatErrorText unwraps it. */}
      {error && (
        <div className="mx-auto rounded-surface border border-rose-500/30 bg-content p-4 text-center text-sm text-rose-300">
          {chatErrorText(error.message ?? "")}
          {onRetry && (
            <button type="button" onClick={onRetry} className="ml-1 inline-flex min-h-11 items-center px-2 underline">
              Retry
            </button>
          )}
          {/* W3b: the hold's words (use-chat-stream.ts toasts them once; the card keeps them). Retry
              stays: a tap re-checks the saved turn through safeRegenerate. */}
          {hold && <p className="mt-2 text-[13px] leading-snug text-fg-secondary">{hold}</p>}
        </div>
      )}

      {/* 2026-08-08 · always-mounted completion announcer — polite regions
          must pre-exist to announce (people-scoring-panel is the in-repo
          reference; mobile-a11y.test.tsx §A10 pins the rule). Text is
          derived, not effect-driven: it flips exactly once per stream
          (busy → idle with an assistant turn last), which is the one
          change AT announces. */}
      <div role="status" aria-live="polite" className="sr-only">
        {stoppedHere
          ? stoppedLabel(stoppedHere.outcome)
          : error
            ? chatErrorText(error.message ?? "")
          : !isLoading && messages[messages.length - 1]?.role === "assistant"
            ? "Nick finished replying"
            : ""}
      </div>

      <MessageActionSheet
        open={Boolean(actionSheetMsg)}
        onClose={() => setActionSheetMsg(null)}
        role={actionSheetMsg?.role || "user"}
        text={actionSheetMsg?.text || ""}
        onCopy={() => actionSheetMsg?.text && void copyToClipboard(actionSheetMsg.text)}
        onEdit={actionSheetMsg?.role === "user" ? () => { if (actionSheetMsg?.text) offerDraft(actionSheetMsg.text, actionSheetMsg.id); } : undefined}
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
        // Private Lab persists nothing, and a private reply has no row to score.
        // A reply still streaming has no row yet: the server would score the previous one.
        onFeedback={
          actionSheetMsg?.role === "assistant" && !privateMode && !(isLoading && actionSheetMsg.id === latestAssistantId)
            ? (positive) => void onFeedback(positive)
            : undefined
        }
      />
      <ReasoningTraceModal open={reasoningTraceMsg !== null} messageId={reasoningTraceMsg} onClose={() => setReasoningTraceMsg(null)} />
    </div>
  );
}
