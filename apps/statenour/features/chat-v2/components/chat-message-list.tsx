"use client";

import Link from "next/link";
import { TypedToolCards } from "./typed-tool-cards";
import { Fragment, useState, useCallback, useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { AlertTriangle, CheckCircle2, ChevronRight, Copy, MoreHorizontal, Pencil, RotateCcw, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { ChatMediaPart, type ChatFilePart } from "./chat-media-part";
import { MediaTimestampBar } from "./media-timestamp-bar";
import { VideoLinks } from "@/components/chat/video-link-facade";
import { useChatUiStore } from "../stores/chat-ui-store";
import { ToolResultCard, isKnownToolName } from "@/components/chat/tool-result-card";
import { toolReceiptLabel } from "@/components/chat/tool-result-registry";
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
import { doneToast } from "../lib/popup-mutes";
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

type ListPart = UIMessage["parts"][number];
const wordedText = (part: ListPart) => part.type === "text" && part.text.trim().length > 0;

/** Index of the last text part with words in it, -1 when none. */
function lastWordedTextIndex(parts: readonly ListPart[]): number {
  for (let i = parts.length - 1; i >= 0; i--) if (wordedText(parts[i])) return i;
  return -1;
}

/** The reply's text is written (its last part is finished text) and no tool is still running. */
function isVerifyTail(parts: readonly ListPart[]): boolean {
  const last = [...parts].reverse().find((part) => part.type !== "step-start");
  if (!last || !wordedText(last) || (last as { state?: string }).state !== "done") return false;
  return !parts.some((part) => part.type.startsWith("tool-") && !["output-available", "output-error"].includes((part as { state?: string }).state ?? ""));
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    doneToast("Copied to clipboard", { duration: 1500 });
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
    // W3b (B1): both turns sit in one left-aligned column now, so their actions do too.
    <div className="mt-1.5 flex items-center justify-start gap-0.5" data-testid={`message-actions-${role}`}>
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

/** The latest Undo deadline among a turn's tool outputs (ms), or null: no undo offered (PR #3090, 4299648934). */
function latestUndoDeadline(message: UIMessage): number | null {
  let until: number | null = null;
  for (const part of message.parts ?? []) {
    const out = (part as { output?: { undoToken?: unknown; undoExpiresAt?: unknown } }).output;
    if (!part.type.startsWith("tool-") || !out?.undoToken || typeof out.undoExpiresAt !== "string") continue;
    const at = Date.parse(out.undoExpiresAt);
    if (Number.isFinite(at) && (until === null || at > until)) until = at;
  }
  return until;
}
const nowMs = () => Date.now();

/**
 * True until the turn's latest Undo deadline passes, so the disclosure that holds the Undo chip stays
 * open while the chip can still be used. A deadline that arrives mid-stream is picked up; one already
 * past at mount (a reopened conversation) never holds it open.
 */
function useUndoHoldsOpen(message: UIMessage): boolean {
  const deadline = latestUndoDeadline(message);
  const [expired, setExpired] = useState<number | null>(() => (deadline !== null && deadline <= nowMs() ? deadline : null));
  useEffect(() => {
    if (deadline === null || deadline === expired) return;
    const timer = setTimeout(() => setExpired(deadline), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, expired]);
  return deadline !== null && deadline !== expired;
}

/**
 * The turn's receipt line. W3b (B1): it is the only chrome a finished turn carries. The tool cards
 * (`children`) sit behind it in a native disclosure whose summary names what ran ("Memories found,
 * 1 match"); the disclosure is open while the latest reply is still streaming so the running cards
 * stay in view, and folds when it settles, unless a card's Undo is still live (it folds when that
 * expires). No cards, no disclosure: the line as before.
 */
function ToolReceiptSummary({ message, traceId, children, openByDefault = false }: { message: UIMessage; traceId?: string | null; children?: React.ReactNode; openByDefault?: boolean }) {
  const toolParts = (message.parts ?? []).filter((part) => part.type.startsWith("tool-")) as Array<{
    type: string;
    state?: string;
    output?: unknown;
  }>;
  const undoHoldsOpen = useUndoHoldsOpen(message);
  if (toolParts.length === 0 && !traceId) return null;
  const named = [...new Set(toolParts.map((part) => toolReceiptLabel(part.type.replace("tool-", ""), part.state, part.output)).filter((label): label is string => Boolean(label)))];

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
  const glyph = (
    <ShieldCheck
      size={13}
      aria-hidden="true"
      className={counts.failed > 0 ? "text-red-400" : unproven ? "text-fg-tertiary" : "text-emerald-400"}
    />
  );
  const words = counts.total > 0 ? (
    <span>
      {formatToolReceipts(counts)}
      {named.length > 0 ? ` · ${named.join(" · ")}` : ""}
    </span>
  ) : (
    <span className="text-fg-tertiary">no tools run</span>
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-fg-tertiary">
      {children && counts.total > 0 ? (
        <details className="group min-w-0 flex-1" open={openByDefault || undoHoldsOpen || undefined}>
          {/* 44px: the summary is a tap target at 390. */}
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control [&::-webkit-details-marker]:hidden">
            {glyph}
            {words}
            <ChevronRight size={11} aria-hidden className="transition-transform duration-[var(--motion-state)] group-open:rotate-90" />
          </summary>
          {children}
        </details>
      ) : (
        <>
          {glyph}
          {words}
        </>
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
  // Focus inside the same tap: iOS raises the keyboard only for a focus made
  // during the gesture, so an edit armed without it looked like nothing
  // happened (2026-10-29). The draft lands on the next render.
  const editMessage = useCallback(
    (text: string, messageId: string) => {
      offerDraft(text, messageId);
      document.querySelector<HTMLTextAreaElement>("[data-chat-composer-input]")?.focus();
    },
    [offerDraft],
  );
  const editFromSheetRef = useRef(false);
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
      doneToast("Saved as belief");
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
      doneToast("Saved as decision");
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
        doneToast("Feedback saved", { duration: 1500 });
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

  // The failed-open card (W3b): the transcript on screen was put back by use-conversations, so it
  // also renders below a restored transcript. Announced; Retry stays mounted while the re-read runs.
  const loadFailedCard = loadFailedId ? (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-center text-[15px] text-fg">
      <p>Couldn&apos;t open that conversation. Nothing was changed.</p>
      {onRetryLoad && (
        <button type="button" onClick={() => onRetryLoad(loadFailedId)} disabled={isLoadingConvo} className="min-h-11 rounded-control border border-edge-default px-4 font-medium text-fg hover:bg-surface disabled:opacity-50">
          Retry
        </button>
      )}
    </div>
  ) : null;

  if (messages.length === 0 && pending.length === 0 && !diagnosticReport) {
    if (isLoadingConvo && !loadFailedId) {
      return <div className="flex h-full items-center justify-center p-8 text-[13px] text-fg-tertiary">Loading conversation…</div>;
    }
    // A failed open is not an empty chat: the active conversation did not move (chat-island.tsx
    // openConversation), so the starters would invite a send into the wrong place.
    if (loadFailedId) {
      return <div className="flex h-full flex-col items-center justify-center p-8">{loadFailedCard}</div>;
    }
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center p-5 sm:p-8">
        {/* W3b: the headline is the hero, in the verdict role Home uses (the one line a page may
            shout). The NICK eyebrow (the header says Nick) and the description are gone. */}
        <div className="mb-7">
          {/* .vt-verdict is unlayered and sets its own 30 / 40 / 48 px scale; utility sizes here would be dead. */}
          <h2 className="vt-verdict">What are we solving?</h2>
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
      // W3b (B1): the log grows up from the composer (min-h-full + justify-end), so a short
      // conversation sits next to the input instead of leaving the viewport's lower half empty.
      className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-5 px-4 py-5 pb-12 sm:px-6"
    >
      {diagnosticReport && (
        <section className="rounded-surface border border-edge-subtle bg-content p-4">
          <div className="mb-3 flex items-center gap-2 text-fg-secondary">
            <CheckCircle2 size={15} />
            <h3 className="font-mono text-[11px] tracking-[0.12em]">Independent chat diagnostic</h3>
            <button onClick={() => setDiagnosticReport(null)} className="ml-auto min-h-11 px-2 text-[11px] text-fg-tertiary hover:text-fg sm:min-h-8">Dismiss</button>
          </div>
          <NickMessage text={diagnosticReport} streaming={false} messageId="chat-diagnostic" />
        </section>
      )}

      {hasHidden && <button onClick={showOlder} className="mx-auto min-h-11 rounded-full border border-edge-default bg-surface px-4 py-1.5 text-xs text-fg-secondary transition-colors hover:text-fg sm:min-h-8">Show {hiddenCount} older messages</button>}

      {renderedMessages.map((message, messageIndex) => {
        if (isErroredAssistantTurn(message)) return <InterruptedTurnCard key={message.id} message={message} onRetry={onRetry} />;
        const isLatestAssistant = message.role === "assistant" && messageIndex === renderedMessages.length - 1;
        const streamingHere = isLoading && isLatestAssistant;
        // 2026-10-29 · one reply, one badge strip: a multi-step reply (text, tools, text) repeated
        // the strip under every step and drew a blank shell for a step with no text, so it read as
        // several replies. The strip sits under the last text that has words.
        const lastTextIndex = lastWordedTextIndex(message.parts ?? []);
        // 2026-08-29 · When recall was broken the model retried the same
        // search several times in one turn and the transcript rendered five
        // byte-identical "0 matches" cards in a row -- on a phone that is
        // most of the viewport spent saying one thing. Only ADJACENT
        // identical runs collapse; a different part in between keeps them
        // separate, because the real sequence is information.
        const toolRunRepeat = new Map(
          collapseRepeatedToolParts(message.parts ?? []).map((r) => [r.index, r.repeat]),
        );
        // W3b (B1): the tool cards leave the flow of the reply and sit behind its receipt line.
        const toolCards = (message.parts ?? []).flatMap((part, index) => {
          if (!part.type.startsWith("tool-")) return [];
          const repeat = toolRunRepeat.get(index);
          // Not the head of its run: an identical card already stands directly above it.
          if (repeat === undefined) return [];
          const toolName = part.type.replace("tool-", "");
          const repeatBadge = repeat > 1 ? (
            <div className="mt-1 font-mono text-[11px] text-fg-tertiary">
              ×{repeat}: same call, same result
            </div>
          ) : null;
          if (isKnownToolName(toolName)) return [
            <div key={`${message.id}-${index}`}>
              <ToolResultCard toolName={toolName} state={(part as any).state} output={(part as any).output} />
              {repeatBadge}
            </div>,
          ];
          // "verified complete" was the same overclaim as the receipt chip: `output-available` only
          // means the call returned.
          return [
            <div key={`${message.id}-${index}`} className="mt-2 rounded-surface border border-edge-subtle bg-content px-3 py-2 font-mono text-[12px] text-fg-secondary">
              {toolName}: {noCardToolLine((part as any).state, (part as any).output)}
              {repeatBadge}
            </div>,
          ];
        });
        return (
          <Fragment key={message.id}>
          {/* W3b (B1): one ruled text column. Each turn opens with a rule; the operator's words
              sit in the column in the secondary tone (no fill, no right alignment), Nick's reply is
              the page's text at 20px, and the receipt line below it is the turn's only chrome
              (the per-reply NICK eyebrow is gone; the header already says Nick). */}
          {/* PR #3090 fix round: Nick's reply sits on the reading plane (surface-interactive,
              column-bleed, no radius, no border); the operator's turn stays on the ground with its
              rule. The plane tells the speakers apart, so neither needs an eyebrow or a bubble. */}
          <div className={message.role === "assistant" ? "-mx-4 bg-surface-interactive px-4 pb-4 pt-4 sm:-mx-6 sm:px-6" : "border-t border-edge-subtle pt-4"}>
            <div
              className={
                message.role === "user"
                  ? "w-full min-w-0 text-[15px] leading-relaxed text-fg-secondary"
                  : "w-full min-w-0 text-[20px] leading-[1.6] text-fg"
              }
            >
              {/* 09-F20: the speaker, for screen readers. */}
              <span className="sr-only">{message.role === "user" ? "You:" : "Nick:"}</span>
              {message.parts?.map((part, index) => {
                if (part.type === "text") {
                  if (message.role === "user") {
                    // 2026-08-18 · tap-to-edit ARMS edit-resend (draft +
                    // editingMessageId) instead of bare prefill — sending
                    // used to APPEND a duplicate while the original stayed.
                    // The composer shows a visible editing banner w/ cancel.
                    return (
                      <div key={`${message.id}-${index}`}>
                        <UserMessageBubble text={part.text} onClick={() => editMessage(part.text, message.id)} />
                        {/* U3 · a video he pasted plays here, after a tap. */}
                        <VideoLinks text={part.text} />
                      </div>
                    );
                  }
                  // An empty step draws nothing; the part still streaming keeps its shell (the caret).
                  if (!part.text.trim() && !(streamingHere && index === (message.parts?.length ?? 0) - 1)) return null;
                  const underThis = index === lastTextIndex;
                  const contextBlocks = underThis ? extractContextBlocks(message, liveContextBlocks ?? null) : undefined;
                  const quality = underThis ? extractQuality(message) : undefined;
                  const citations = underThis ? extractCitations(message) : undefined;
                  const reasoningSteps = ((message.parts as any[]) || []).filter((item) => item?.type === "data-reasoningStep").map((item) => item.data);
                  return (
                    <div key={`${message.id}-${index}`}>
                      <AssistantMessageShell text={part.text} messageId={message.id} contextBlocks={contextBlocks} quality={quality} citations={citations} onRegen={() => onRetry?.()}>
                        <ReasoningTraceLive steps={reasoningSteps} />
                        <NickMessage text={part.text} streaming={isLoading && isLatestAssistant} messageId={message.id} />
                        {/* BDN-312 · seek controls for any time refs in the
                            reply. Renders null unless a player is docked —
                            a seek control with nothing to seek is a dead
                            button. Suppressed mid-stream: a half-written
                            "4:1" parses as nothing and a half-written
                            "4:12" would flicker a control that then moves. */}
                        {!(isLoading && isLatestAssistant) && <MediaTimestampBar text={part.text} />}
                        {/* U3 · video links play in place after a tap; not mid-stream (a half URL). */}
                        {!(isLoading && isLatestAssistant) && <VideoLinks text={part.text} />}
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
                // tool parts render behind the receipt line (toolCards above)
                return null;
              })}
              {message.role === "assistant" && (
                <ToolReceiptSummary message={message} traceId={isLatestAssistant ? lastTraceId ?? null : null} openByDefault={isLoading && isLatestAssistant}>
                  {toolCards.length > 0 ? toolCards : null}
                </ToolReceiptSummary>
              )}
              {message.role === "assistant" && <TypedToolCards message={message} />}
              {/* 2026-10-29 · the draft is written but the turn is still open: the server checks the
                  reply (45-90 s on a gated turn) before it sends the stored version. Without this
                  the only sign was the red Stop button, and a Stop here loses the checked text. */}
              {/* B2: or the turn closed on the draft and the server's check is still running (latest reply
                  only: a new send stops the read, and an older bubble keeps its mark). */}
              {((streamingHere && isVerifyTail(message.parts ?? [])) ||
                (isLatestAssistant && (message.metadata as { verifying?: boolean } | undefined)?.verifying === true)) && (
                <p className="mt-3 flex items-center gap-2 font-mono text-[11.5px] text-fg-tertiary">
                  <span aria-hidden className="pulse-live inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Checking the reply…
                </p>
              )}
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
                            editMessage(bodyText, message.id);
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
        // W3b (B1): a send on its way reads like the operator's turn it is about to become.
        <div key={item.tempId} className="border-t border-edge-subtle pt-4 text-[15px] leading-relaxed text-fg-secondary">
          <p className="whitespace-pre-wrap">{item.text}</p>
          <p className="mt-1 font-mono text-[11px] text-fg-tertiary">{item.status === "resolving-context" ? "Resolving live context…" : "Sending…"}</p>
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
          {hold && <p role="status" aria-live="polite" className="mt-2 text-[13px] leading-snug text-fg-secondary">{hold}</p>}
        </div>
      )}
      {/* Round 3 (A5): a refusal (side-effecting or private turn) holds with no stream error. */}
      {!error && hold && <p role="status" aria-live="polite" className="mx-auto px-1 text-center text-[13px] leading-snug text-fg-secondary">{hold}</p>}
      {/* PR #3090: the failed-open card is the log's last element, next to the composer: the log is
          bottom-anchored and follows the bottom, so with a long transcript kept it stays in view. */}
      {loadFailedCard}

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
        onEdit={
          actionSheetMsg?.role === "user"
            ? () => {
                if (!actionSheetMsg.text) return;
                editFromSheetRef.current = true;
                editMessage(actionSheetMsg.text, actionSheetMsg.id);
              }
            : undefined
        }
        // The sheet restores focus to More when it closes, which undid the
        // edit's composer focus and closed the iOS keyboard (PR 3351 review).
        finalFocus={() => {
          if (!editFromSheetRef.current) return true;
          editFromSheetRef.current = false;
          return document.querySelector<HTMLTextAreaElement>("[data-chat-composer-input]") ?? true;
        }}
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
