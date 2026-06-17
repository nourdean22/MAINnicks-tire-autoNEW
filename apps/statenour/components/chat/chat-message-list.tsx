"use client";

/**
 * ChatMessageList — the message-list render for the /chat surface.
 *
 * Extracted VERBATIM from app/(mastery)/chat/page.tsx (the giant `Chat`
 * orchestrator). This is the `isEmpty ? <ChatEmptyState> : <messages
 * column>` ternary that lived inside the `stb.contentRef` div: the
 * lazy-render "show older" banner, the de-duplicated `dedupedRendered.map`
 * that renders each message row (AssistantMessageShell / NickMessage /
 * MessageHoverActions / part-renderers / MessageEditTextarea /
 * UserMessageBubble / MessageFooter), the SmartRepliesCluster, the
 * NickStreaming indicator, and the AutoFirePlanToast.
 *
 * STRICTLY a structural move — zero logic / condition / handler / key /
 * memoization changes. Every value the JSX referenced from the `Chat`
 * scope is now an explicit prop. The MessageFooter handler props are the
 * SAME stable useCallback refs the parent already created; they are just
 * forwarded, so the footer's React.memo bail-out still holds.
 *
 * The scroll container (`stb.scrollRef` / `stb.contentRef` divs), the
 * trailing ErrorDiagnosticPanel, and the "new reply" chip stay in
 * page.tsx — they are NOT part of this block.
 */

import type { UIMessage, ChatRequestOptions } from "ai";
import { cn } from "@/lib/utils";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { MessageHoverActions } from "@/components/chat/message-hover-actions";
import { MessageEditTextarea } from "@/components/chat/message-edit-textarea";
import { MessageFooter } from "@/components/chat/message-footer";
import { NickMessage } from "@/components/chat/nick-message";
import { NickStreaming } from "@/components/chat/nick-streaming";
import { AutoFirePlanToast } from "@/components/chat/auto-fire-plan-toast";
import { SmartRepliesCluster } from "@/components/chat/smart-replies-cluster";
import {
  FilePartRenderer,
  ReasoningPartRenderer,
  ToolPartRenderer,
} from "@/components/chat/message-part-renderers";
import {
  UserMessageBubble,
  AssistantMessageShell,
} from "@/components/chat/message-bubble-shells";
import {
  extractContextBlocks,
  extractQuality,
  extractModel,
  extractCitations,
} from "@/lib/chat/extract-message-metadata";
import { extractMessageText } from "@/lib/chat/extract-message-text";
import { haptic } from "@/lib/ui/haptic";
import type { ContextBlocks } from "@/components/chat/context-block-badges";
import type { MessageTiming } from "@/hooks/chat/use-chat-speed-ribbon";
import type { StallStatus } from "@/hooks/use-stall-detection";
import type { AutoFirePlan } from "@/lib/chat/auto-fire-gate";
import type { usePinnedMessages } from "@/hooks/use-pinned-messages";

export interface ChatMessageListProps {
  // ── Empty-state branch ──
  isEmpty: boolean;
  setInput: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;

  // ── Lazy-render banner ──
  hasHidden: boolean;
  hiddenCount: number;
  showOlder: () => void;

  // ── Message arrays ──
  dedupedRendered: UIMessage[];
  dedupedAll: UIMessage[];
  messages: UIMessage[];

  // ── Stream / per-message state ──
  isStreaming: boolean;
  showSpeedRibbon: boolean;
  timingRef: React.MutableRefObject<Map<string, MessageTiming>>;
  liveContextBlocksRef: React.MutableRefObject<ContextBlocks | null>;
  activeId: string | null;

  // ── Editing (user message inline edit) ──
  editingMsgId: string | null;
  editValue: string;
  setEditValue: (value: string) => void;
  setEditingMsgId: (id: string | null) => void;
  clearEditDraft: () => void;

  // ── Pins / actions ──
  pins: ReturnType<typeof usePinnedMessages>;
  copyMessage: (msg: { parts?: Array<{ type: string; text?: string }> }) => void | Promise<void>;
  regenerate: (
    options?: { messageId?: string } & ChatRequestOptions,
  ) => Promise<void>;
  sendOrQueue: (text: string) => void;
  setMessages: (
    messages: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
  ) => void;
  handleFork: (messageId: string) => void;
  setActionSheetMsg: (
    msg: { id: string; role: "user" | "assistant"; text: string } | null,
  ) => void;

  // ── MessageFooter callbacks (stable useCallback refs from parent) ──
  editingAssistantId: string | null;
  lastTraceId: string | null;
  handleFooterStartEdit: (id: string) => void;
  handleFooterCancelEdit: () => void;
  handleFooterMessageSaved: (id: string, newContent: string, editedAt: string) => void;
  handleFooterMessageReverted: (id: string, priorContent: string) => void;
  handleFooterSwapBranch: (activeMessageId: string, siblingId: string) => void;

  // ── SmartRepliesCluster ──
  input: string;

  // ── NickStreaming ──
  stallStatus: StallStatus;

  // ── Auto-fire toast ──
  pendingAutoFire: { messageId: string; plan: AutoFirePlan } | null;
  handleAutoFireProceed: (finalPrompt: string) => void;
  handleAutoFireCancel: () => void;
}

export function ChatMessageList({
  isEmpty,
  setInput,
  inputRef,
  hasHidden,
  hiddenCount,
  showOlder,
  dedupedRendered,
  dedupedAll,
  messages,
  isStreaming,
  showSpeedRibbon,
  timingRef,
  liveContextBlocksRef,
  activeId,
  editingMsgId,
  editValue,
  setEditValue,
  setEditingMsgId,
  clearEditDraft,
  pins,
  copyMessage,
  regenerate,
  sendOrQueue,
  setMessages,
  handleFork,
  setActionSheetMsg,
  editingAssistantId,
  lastTraceId,
  handleFooterStartEdit,
  handleFooterCancelEdit,
  handleFooterMessageSaved,
  handleFooterMessageReverted,
  handleFooterSwapBranch,
  input,
  stallStatus,
  pendingAutoFire,
  handleAutoFireProceed,
  handleAutoFireCancel,
}: ChatMessageListProps) {
  return (
        isEmpty ? (
          /* Apr 19 · Chat empty state v2 — Nick leads with 3 SPECIFIC
              observations pulled from live state (contradictions,
              overdue commits, ghost prediction, weak axis, skill
              candidates, momentum). No generic "ask me anything".
              No mode/persona labels. Tap an opener → ask fills input.
              See components/chat/chat-empty-state.tsx */
          <ChatEmptyState
            onPick={(ask) => {
              setInput(ask);
              inputRef.current?.focus();
            }}
          />
        ) : (
          // Apr 27 · MOBILE-FLUIDITY — outer padding tuned for thumb
          // reach. Generous bottom space so the last message clears
          // the sticky input row + safe-area without being hugged.
          // mx-auto + max-w-3xl centers the column on desktop so
          // messages don't stretch impotent across a wide viewport.
          <div className="mx-auto w-full max-w-3xl px-3 sm:px-4 pt-3 pb-6 sm:pb-3 space-y-3">
            {/* Dedupe messages by id before rendering. AI SDK v6 can
                occasionally push the same message twice during stream
                reconnects or HMR — React then throws duplicate-key
                warnings and the UI goes spotty. We defensively dedupe
                here so React never sees the collision regardless of
                what's in the underlying store. */}

            {/* v8.16 B3 · Lazy-render banner. Only renders when the
                conversation crosses the 80-message threshold AND we're
                hiding older history. Click reveals the rest for the
                session. */}
            {hasHidden && (
              <button
                type="button"
                onClick={showOlder}
                className="mx-auto block w-full max-w-md rounded-full border border-(--gold)/30 bg-(--gold)/4 px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-(--gold)/80 hover:border-(--gold)/50 hover:bg-(--gold)/8 hover:text-(--gold) transition-colors"
                title="Reveal older messages — kept hidden by default to keep the page snappy"
              >
                ↑ show {hiddenCount} older message{hiddenCount === 1 ? "" : "s"}
              </button>
            )}

            {dedupedRendered.map((msg, idx, arr) => {
              // v10.0.529.20 · compute `isLastMessage` against the
              // raw useChat `messages` array (semantics IDENTICAL to
              // the pre-extraction IIFE that used the same check)
              // so the MessageFooter receives a stable boolean rather
              // than re-running the lookup behind the memo boundary.
              const isLastMessage = messages[messages.length - 1]?.id === msg.id;
              const isLatestAssistant = msg.role === "assistant" && idx === arr.length - 1;
              const isLatestAssistantStreaming = isLatestAssistant && isStreaming;
              // Show timestamp on first message, role changes, and every 5th message
              const prevMsg = idx > 0 ? arr[idx - 1] : null;
              const showTimestamp = idx === 0 || msg.role !== prevMsg?.role || idx % 5 === 0;
              // Relative time label
              // UIMessage doesn't have createdAt — use the timing ref
              // or fall back to null (timestamp only shows for timed messages)
              const msgTiming = msg.id ? timingRef.current.get(msg.id) : undefined;
              const msgTime = msgTiming?.sentAt ? new Date(msgTiming.sentAt) : null;
              const timeLabel = msgTime
                ? (() => {
                    const diff = Date.now() - msgTime.getTime();
                    if (diff < 60_000) return "now";
                    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
                    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h`;
                    return msgTime.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  })()
                : null;
              return (
                <div key={msg.id} className={cn(
                  "flex group",
                  msg.role === "user" ? "justify-end" : "justify-start",
                  // Extra spacing between conversation turns for visual breathing
                  prevMsg && prevMsg.role !== msg.role && "mt-3"
                )}
                  style={{ animation: "fadeSlideUp 0.2s ease-out" }}>
                  {/* Apr 27 · MOBILE-FLUIDITY — bumped to 90% width on
                      mobile so messages aren't squeezed into a narrow
                      column, and bumped text size to 14.5px so it's
                      thumb-readable without zoom. Desktop keeps the
                      tighter 13.5px. */}
                  <div className={cn(
                    "max-w-[92%] sm:max-w-[88%] text-[14.5px] sm:text-[13.5px] leading-[1.55] sm:leading-[1.6] relative",
                    msg.role === "user"
                      ? "rounded-2xl rounded-br-md px-3.5 py-2.5 sm:py-2 user-bubble-premium text-(--text-primary)"
                      : "pl-1 border-l-2 border-(--gold)/10 text-(--text-secondary)",
                    isLatestAssistantStreaming && "nick-bubble-latest"
                  )}>
                    {/* Timestamp — shown on role changes and periodically */}
                    {showTimestamp && timeLabel && (
                      <div className={cn(
                        "text-[10px] font-mono uppercase tracking-wider mb-0.5",
                        msg.role === "user" ? "text-(--gold)/40 text-right" : "text-(--text-tertiary)/50"
                      )}>
                        {msg.role === "assistant" && <span className="text-(--gold)/30 mr-1">Nick</span>}
                        {timeLabel}
                      </div>
                    )}

                    {/* Hover actions strip · v10.0.529.106 · Wave 83 ·
                        ~55 LOC of icon buttons lifted into
                        MessageHoverActions. */}
                    {msg.role === "assistant" && !isLatestAssistantStreaming && (
                      <MessageHoverActions
                        isPinned={pins.isPinned(msg.id)}
                        canRegenerate={idx === messages.length - 1}
                        onCopy={() => copyMessage(msg)}
                        onSendToSocial={() => {
                          const text = extractMessageText(msg);
                          if (!text) return;
                          const url = `/content?tab=publish&caption=${encodeURIComponent(text.slice(0, 2200))}`;
                          window.open(url, "_blank", "noopener");
                        }}
                        onRegenerate={() => regenerate()}
                        onTogglePin={() => {
                          const text = msg.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ") || "";
                          pins.toggle(msg.id, text);
                        }}
                      />
                    )}
                    {msg.parts?.map((part, i) => {
                      if (part.type === "text" && part.text.trim()) {
                        // Apr 19 · Extract contextBlocks from the
                        // message's tokenUsage blob (persisted) or the
                        // live stream header (cached in a ref).
                        const blocks = extractContextBlocks(msg, liveContextBlocksRef.current);
                        return msg.role === "assistant" ? (
                          <AssistantMessageShell
                            key={i}
                            text={part.text}
                            messageId={msg.id}
                            contextBlocks={blocks}
                            quality={extractQuality(msg)}
                            citations={extractCitations(msg)}
                            onRegen={() => regenerate()}
                            onLongPress={() =>
                              setActionSheetMsg({
                                id: msg.id,
                                role: "assistant",
                                text: part.text,
                              })
                            }
                          >
                          <NickMessage
                            text={part.text}
                            onQuickAction={(t) => { setInput(""); sendOrQueue(t); }}
                            streaming={isLatestAssistantStreaming}
                            showTiming={showSpeedRibbon}
                            timing={msg.id ? timingRef.current.get(msg.id) : undefined}
                            model={extractModel(msg)}
                            messageId={msg.id}
                            conversationId={activeId ?? undefined}
                          />
                          </AssistantMessageShell>
                        ) : editingMsgId === msg.id ? (
                          // v10.0.529.106 · Wave 83 · ~62 LOC of inline
                          // textarea + Resend/Cancel JSX lifted into
                          // MessageEditTextarea · the truncate-then-
                          // resend orchestration stays on the parent
                          // because it needs the messages array. Same
                          // queueMicrotask semantics as before.
                          <MessageEditTextarea
                            key={i}
                            value={editValue}
                            onChange={setEditValue}
                            onResend={() => {
                              if (!editValue.trim()) return;
                              const idx2 = messages.findIndex((m) => m.id === msg.id);
                              if (idx2 >= 0) {
                                setMessages(messages.slice(0, idx2));
                                queueMicrotask(() => sendOrQueue(editValue.trim()));
                              }
                              clearEditDraft();
                              setEditingMsgId(null);
                            }}
                            onCancel={() => {
                              clearEditDraft();
                              setEditingMsgId(null);
                            }}
                          />
                        ) : (
                          <UserMessageBubble
                            key={i}
                            text={part.text}
                            onClick={() => {
                              if (msg.role === "user") {
                                setEditingMsgId(msg.id);
                                setEditValue(part.text || "");
                              }
                            }}
                            onLongPress={() =>
                              setActionSheetMsg({
                                id: msg.id,
                                role: msg.role as "user" | "assistant",
                                text: part.text,
                              })
                            }
                          />
                        );
                      }
                      // File parts — images attached by the user, or
                      // files the assistant returned (rare). Renders a
                      // thumbnail that opens full-size in a new tab.
                      // Shape: { type: "file", mediaType, url, filename? }
                      // v10.0.529.106 · Wave 83 · ~110 LOC of file/
                      // reasoning/tool part renderers lifted into
                      // components/chat/message-part-renderers.tsx.
                      // Each branch is now an independent named
                      // function · easier to unit-test · ToolResultCard
                      // dynamic-import preserved.
                      if (part.type === "file") {
                        return <FilePartRenderer key={i} part={part as Parameters<typeof FilePartRenderer>[0]["part"]} role={msg.role} />;
                      }
                      if (part.type === "reasoning") {
                        return <ReasoningPartRenderer key={i} part={part as Parameters<typeof ReasoningPartRenderer>[0]["part"]} />;
                      }
                      if (part.type.startsWith("tool-")) {
                        return <ToolPartRenderer key={i} part={part as Parameters<typeof ToolPartRenderer>[0]["part"]} />;
                      }
                      return null;
                    })}

                    {/* v7.6 · C6 · Apr 29 · Streaming-state badge +
                        per-message info card (C7). Both surface Batch A
                        columns. Status badge silent when complete; info
                        card always present on assistant turns (icon-
                        only, expands on tap).
                        v10.0.529.20 · extracted from a ~140-line inline
                        IIFE into MessageFooter so finished messages bail
                        out via React.memo shallow equality on every
                        streamed token. All callbacks below are stable
                        useCallback refs hoisted to the parent. */}
                    <MessageFooter
                      msg={msg}
                      editing={editingAssistantId === msg.id}
                      isLastMessage={isLastMessage}
                      lastTraceId={lastTraceId}
                      onStartEdit={handleFooterStartEdit}
                      onCancelEdit={handleFooterCancelEdit}
                      onMessageSaved={handleFooterMessageSaved}
                      onMessageReverted={handleFooterMessageReverted}
                      onSwapBranch={handleFooterSwapBranch}
                    />
                  </div>
                </div>
              );
            })}

            {/* Smart replies — 3 tap-to-send follow-up chips under the
                latest assistant message. Fires /api/ai/chat/suggestions
                keyed by message id; server caches 60s. Hidden while
                streaming so they don't flicker mid-token.
                v10.0.529.106 · Wave 83 · ~53 LOC of IIFE + walker
                lifted into SmartRepliesCluster. */}
            <SmartRepliesCluster
              messages={dedupedAll}
              isStreaming={isStreaming}
              activeConversationId={activeId}
              inputIsEmpty={!input.trim()}
              onPick={(s) => {
                haptic.tap();
                setInput("");
                sendOrQueue(s);
              }}
            />

            {/* Streaming indicator — "Nick is thinking..." with tool awareness */}
            {isStreaming && (
              <NickStreaming
                lastMessage={messages[messages.length - 1] as { role: string; parts?: Array<{ type: string; state?: string }> } | undefined}
                stallStatus={stallStatus}
              />
            )}

            {/* v6 · Apr 28 — Auto-fire plan toast.
                Replaces the silent "now generate the picture" injection.
                Shows plan card + Go/Edit/Cancel + 2.5s countdown. */}
            {pendingAutoFire && !isStreaming && (
              <div className="my-2">
                <AutoFirePlanToast
                  plan={pendingAutoFire.plan}
                  onProceed={handleAutoFireProceed}
                  onCancel={handleAutoFireCancel}
                />
              </div>
            )}

            {/* v10.0.484 · ProactiveInsightCard mount removed per
                operator. The card auto-injected a "Nick noticed"
                nudge between turns and operator wanted it gone from
                /chat (intrusive after every reply). Component file
                preserved at components/chat/proactive-insight-card.tsx
                in case it gets re-mounted on a different surface
                (Ultron HQ · /brain · etc) later — nothing renders it
                today. */}
          </div>
        )
  );
}
