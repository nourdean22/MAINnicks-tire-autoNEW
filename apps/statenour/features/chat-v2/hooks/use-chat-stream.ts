"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { toast } from "sonner";
import { useChatTransport, type ChatUIMessage } from "@/hooks/chat/use-chat-transport";
import { useChatUiStore } from "../stores/chat-ui-store";
import { useChatStall } from "@/hooks/chat/use-chat-stall";
import { useStreamingErrorGuard } from "@/hooks/chat/use-streaming-error-guard";
import {
  readPageContext,
  onPageContextChanged,
  type PageContextPayload,
} from "@/components/chat/page-context-bridge";
import type { ChatRuntimeController } from "../types/chat-runtime-controller";
import type { ContextBlocks } from "@/components/chat/context-block-badges";
import { looksLikeImageGenerationRequest } from "@/lib/ai/chat/handlers/patterns";
import { bindPersistedMessage, stopTurn as requestStop, type StoppedTurn } from "../lib/turn-lifecycle";
import { turnHasSideEffect } from "../lib/turn-side-effect";
import {
  judgeAfterUnansweredReplay,
  judgeSavedTurn,
  latestTurnTraces,
  RETRY_HELD_NO_RECORD,
  RETRY_HELD_RAN,
  RETRY_HELD_RESENT_UNKNOWN,
  RETRY_HELD_UNCONFIRMED,
  RETRY_STILL_CHECKING,
  type SavedRow,
  type SavedTurnVerdict,
} from "../lib/saved-turn";

/** How long Retry waits for the saved turn before it gives up and holds. */
const SAVED_TURN_READ_TIMEOUT_MS = 12_000;

/** What the saved-turn check decided: replay, say nothing (the operator moved on), or hold with this message. */
type SavedTurnCheck = { kind: "go"; rows: readonly SavedRow[] | null } | { kind: "stale" } | { kind: "hold"; message: string };

const PAGE_ANCHOR_KEYS = [
  "lastTaskId",
  "lastGoalId",
  "lastJournalEntryId",
  "lastDecisionId",
  "lastPinId",
  "lastReflectionId",
  "lastMissionId",
  // 2026-08-12 · the source page's route — the server has consumed
  // body.contextRoute (route hint + TOOL_BIAS) since Wave 30, but no
  // text-chat client ever sent it. The bridge now stores it per page.
  "contextRoute",
] as const;

export type UseChatStreamOptions = {
  /**
   * Reads the conversation as saved (every row, oldest first), fresh from the server. Retry after
   * a stream error asks it before replaying. The signal is aborted when Retry gives up waiting.
   */
  readSavedTurn?: (conversationId: string, signal?: AbortSignal) => Promise<readonly SavedRow[] | null>;
};

export function useChatStream(options?: UseChatStreamOptions): ChatRuntimeController {
  const activeConversationId = useChatUiStore((s) => s.activeConversationId);
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);
  const setConnection = useChatUiStore((s) => s.setConnection);
  // 2026-07-22 · authority-kernel controls (composer selectors)
  const privateMode = useChatUiStore((s) => s.privateMode);
  const turbo = useChatUiStore((s) => s.turbo);
  const setTurbo = useChatUiStore((s) => s.setTurbo);
  const posture = useChatUiStore((s) => s.posture);
  const depth = useChatUiStore((s) => s.depth);
  const actionPermission = useChatUiStore((s) => s.actionPermission);

  const bodyRef = useRef<Record<string, unknown>>({ conversationId: activeConversationId });
  const liveContextBlocksRef = useRef<ContextBlocks | null>(null);
  const lastTraceIdRef = useRef<string | null>(null);
  // "A replay is outstanding": replay() records the trace it re-ran (`from`, null allowed: a cold page,
  // a conversation opened from history, or a reply that came back with no trace header all leave it
  // null). A replay whose POST dies before any response header leaves lastTraceId unchanged, and one
  // answered WITHOUT a header (429, 5xx, a gateway) nulls it, so the client cannot tell whether the
  // server (which does not stop when the client disconnects) is running it. While the record stands
  // and an error is set, Retry and the auto retry are judged from the saved turn instead of replaying
  // blind, whatever the trace in hand is. An explicit record, not a trace comparison: a comparison
  // was off whenever the trace in hand was null, or became null.
  // Cleared by a new send, by opening another conversation when nothing is in flight, and by a response
  // that carries a trace header other than `from`.
  const replayOutstandingRef = useRef<{ from: string | null } | null>(null);
  const [liveContextBlocks, setLiveContextBlocks] = useState<ContextBlocks | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const lastPersonaHeaderRef = useRef(null);

  useEffect(() => {
    // Private Lab detaches from ANY conversation — no id is sent, the server
    // also drops it (belt + suspenders), so no rows can be conversation-scoped.
    bodyRef.current.conversationId = privateMode ? undefined : activeConversationId;
  }, [activeConversationId, privateMode]);

  useEffect(() => {
    // Ship only NON-DEFAULTS so an untouched composer = today's exact requests.
    if (privateMode) bodyRef.current.privateMode = true;
    else delete bodyRef.current.privateMode;
    if (posture !== "auto") bodyRef.current.posture = posture;
    else delete bodyRef.current.posture;
    if (depth !== "auto") bodyRef.current.modeOverride = depth;
    else delete bodyRef.current.modeOverride;
    if (actionPermission !== "draft") bodyRef.current.actionPermission = actionPermission;
    else delete bodyRef.current.actionPermission;
  }, [privateMode, posture, depth, actionPermission]);

  useEffect(() => {
    const apply = (ctx: PageContextPayload | null) => {
      for (const key of PAGE_ANCHOR_KEYS) delete bodyRef.current[key];
      if (!ctx) return;
      for (const key of PAGE_ANCHOR_KEYS) {
        const value = ctx[key];
        if (value) bodyRef.current[key] = value;
      }
    };
    apply(readPageContext());
    return onPageContextChanged(apply);
  }, []);

  // 2026-08-28 · WP2 review fix · automatic re-resume.
  //
  // The resume route tails an in-flight turn for a bounded window and then
  // must close the SSE stream (its own platform maxDuration). Measured deep
  // turns run 132s mean / 161s worst, so one tail window is routinely NOT
  // enough — and a closed stream reads to the AI SDK as a completed one
  // (there is no "partial" status), which also tears down stall detection.
  // The server flags that case with `X-Resume-Partial: 1`; this reattaches.
  //
  // BOUNDED ON PURPOSE. This repo has scar tissue from an auto-resend that
  // spawned duplicate messages and a retry storm that rate-limited the
  // pipeline. A resume is NOT a resend — it re-runs no model and mints no
  // message (the server keys the replay to a deterministic id) — but an
  // unbounded loop would still hammer the route, so: a hard attempt cap and
  // a delay between attempts. On exhaustion we stop silently rather than
  // spin; the in-bubble marker the server appended is what the operator
  // sees, and a reload always shows the canonical persisted text.
  const resumeAttemptsRef = useRef(0);
  const resumeStreamRefForPartial = useRef<(() => void) | null>(null);
  // True while the latest request is a reattach, not a send: a failed resume
  // must never auto-regenerate (see the auto-retry effect). Starts true for
  // useChat's own mount-time resume; every send clears it.
  const resumingRef = useRef(true);
  // The pending re-resume belongs to the turn that was tailing: a send, a stop
  // or an unmount cancels it, or it would resume against the next turn.
  const partialTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelPartialResume = useCallback(() => clearTimeout(partialTimerRef.current), []);
  useEffect(() => cancelPartialResume, [cancelPartialResume]);
  const onResumePartial = useCallback(() => {
    if (resumeAttemptsRef.current >= 5) return;
    resumeAttemptsRef.current += 1;
    clearTimeout(partialTimerRef.current);
    partialTimerRef.current = setTimeout(() => {
      resumingRef.current = true;
      void resumeStreamRefForPartial.current?.();
    }, 1500);
  }, []);

  // 04-F2 · the stored text + DB id of this turn's reply, applied once the
  // stream settles (see the binding effect below). A ref: the transport is
  // memoized once and must keep a stable callback.
  const persistedRef = useRef<{ id: string; content: string; traceId: string | null } | null>(null);
  const onMessagePersisted = useCallback(
    (persisted: { id: string; content: string; traceId: string | null }) => {
      persistedRef.current = persisted;
    },
    [],
  );

  // Live mirror of chat.messages (synced by an effect below). Declared here
  // because the transport, built once, reads it at resume time.
  const messagesRef = useRef<ChatUIMessage[]>([]);

  // True from the moment the 90s stall abort fires until the next send.
  // Guards onFinish (below) from erasing the degraded state, since an
  // abort and a completion are indistinguishable to that callback.
  const stalledRef = useRef(false);
  // R3-15: the error of a network kill whose turn the server owns. A resume
  // that then finds nothing (204) settles as "ready" with no error, so the
  // hook holds this error to keep the turn visibly interrupted.
  const killedErrorRef = useRef<Error | null>(null);
  const [heldError, setHeldError] = useState<Error | null>(null);

  // 2026-08-09: persistent, not a 6-second toast. A stall takes 90 seconds
  // to fire, so on a phone the notice came and went while the screen was off.
  // RECONNECT, never regenerate (see the stall setError below).
  const showStallToast = useCallback(
    (message: string) => {
      toast.error(message, {
        id: "chat-stall",
        duration: Infinity,
        action: {
          label: "Reconnect",
          onClick: () => {
            toast.dismiss("chat-stall");
            stalledRef.current = false;
            setHeldError(null);
            setConnection("online");
            resumingRef.current = true;
            void resumeStreamRefForPartial.current?.();
          },
        },
      });
    },
    [setConnection],
  );
  const onResumeEmpty = useCallback(() => {
    const killed = killedErrorRef.current;
    if (!killed) return;
    stalledRef.current = true;
    setConnection("degraded");
    setHeldError(killed);
    showStallToast("The connection dropped and Nick's reply could not be picked up. Reconnect, or reload to check for it.");
  }, [setConnection, showStallToast]);

  const transport = useChatTransport({
    apiPath: "/api/ai/chat",
    transportBodyRef: bodyRef,
    onMessagePersisted,
    // P2-B6 · a named resume replaces the reply bubble already on screen
    // (Reconnect after a stall) instead of adding a second copy.
    resumeIntoMessageId: () => {
      const last = messagesRef.current[messagesRef.current.length - 1];
      return last?.role === "assistant" ? last.id : undefined;
    },
    liveContextBlocksRef,
    onLiveContextBlocks: setLiveContextBlocks,
    lastPersonaHeaderRef,
    lastTraceIdRef,
    onTraceId: useCallback((id: string) => {
      // A response that carries a trace answered the request: a replay is no longer outstanding. The very
      // trace it re-ran (a resume of that same turn) is not an answer to the replay.
      const outstanding = replayOutstandingRef.current;
      if (outstanding && id !== outstanding.from) replayOutstandingRef.current = null;
      setLastTraceId(id);
    }, []),
    setDeeperContext: () => {},
    onConversationId: useCallback(
      (id: string) => setActiveConversationId(id),
      [setActiveConversationId],
    ),
    onResumePartial,
    onResumeEmpty,
    // 2026-08-28 · make escalation legible. The operator explicitly asked
    // for depth on this turn, so telling them what happened is expected
    // feedback, not noise — and a REFUSED escalation that says nothing is
    // indistinguishable from never having asked, which is the exact
    // silent-gate failure the escalation lane was built to end.
    onEscalation: useCallback(
      (info: {
        tier: string;
        applied: boolean;
        blockedBy?: string;
        reason?: string;
        laneModel?: string;
      }) => {
        if (info.applied) {
          toast.success(`Depth applied · ${info.tier}`, {
            description: info.laneModel ? `answered by ${info.laneModel}` : undefined,
            duration: 4000,
          });
          return;
        }
        // Blocked: name the remedy, not just the refusal. `reason` is
        // server-authored and already carries the exact env var or count.
        toast.error(`Depth requested (${info.tier}), not applied`, {
          description: info.reason ?? info.blockedBy ?? "escalation unavailable",
          duration: 8000,
        });
      },
      [],
    ),
  });

  const chat = useChat({
    id: "chat-v2",
    transport,
    // WP-A (2026-07-29): on mount, reconnect to a turn that was in
    // flight when the PWA was backgrounded or the socket dropped — the
    // transport rewrites the resume GET to the per-conversation route;
    // no conversation / private mode resolves to a 204 no-op, so this
    // is always safe to leave on.
    resume: true,
    onError(error) {
      console.error("chat stream failed", error);
      setConnection("degraded");
    },
    onFinish() {
      // 2026-08-09 · Do NOT flip back to "online" when this turn was killed
      // by the stall abort. chat.stop() resolves the stream normally, so
      // onFinish fires on an ABORT exactly as it does on a real completion —
      // and it was wiping the only remaining trace that anything went wrong,
      // ~instantly, while the 6s toast was still on screen. That is how a
      // dead turn ended up looking completely healthy.
      if (stalledRef.current) return;
      setConnection("online");
    },
  });

  const retryCountRef = useRef(0);
  // Whether the MOST RECENT send went out under Private Lab, + a live mirror of
  // privateMode. A private turn must never be replayed (regenerate / auto-retry)
  // once Private Lab is off — the replay would persist it (self-review high #4).
  const sentPrivateRef = useRef(false);
  const privateModeRef = useRef(privateMode);
  useEffect(() => {
    privateModeRef.current = privateMode;
  }, [privateMode]);
  const [stopped, setStopped] = useState<StoppedTurn | null>(null);
  // The trace id in hand when the latest request went out. A different one
  // after a network kill means the POST was answered: the server has the turn.
  const traceAtSendRef = useRef<string | null>(null);
  // Every trace this turn's replays have already acted on: the one each replay re-ran, every trace in
  // the rows a replay was approved on, and every trace the hydrated messages carried when a replay
  // started (rows the client never saw cannot approve a replay whose attempt may be running unseen).
  // A replay whose POST gets no header is judged blind, and a clean row only proves the attempt BEFORE
  // the one that may be running, so a row in this set can never approve the next blind replay
  // (otherwise one clean row would approve a chain of them). Same lifetime as replayOutstandingRef:
  // a new send or opening another conversation (when nothing is in flight) clears it. It is not
  // cleared when a header arrives: an older acknowledged attempt must not later count as proof.
  const acknowledgedTracesRef = useRef<Set<string>>(new Set());

  // Retry after a stream error that the server owns: read the saved turn, then
  // replay only if every saved row says a replay repeats nothing AND a saved row
  // names the attempt that failed. One check at a time, so a second tap cannot
  // start a second replay; the flag is released whatever the check does.
  const checkingSavedTurnRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const readSavedTurnRef = useRef(options?.readSavedTurn);
  useEffect(() => {
    readSavedTurnRef.current = options?.readSavedTurn;
  }, [options?.readSavedTurn]);

  const checkSavedTurn = useCallback(async (judge: (rows: readonly SavedRow[] | null) => SavedTurnVerdict, unconfirmedMessage: string): Promise<SavedTurnCheck> => {
    // What the tap saw. If any of it moves while the saved turn is read, a replay would act on a
    // different turn (regenerate takes whatever message is last at that moment). Message ids are
    // left out on purpose: binding the reply to its database id renames the last message without
    // changing the turn.
    const turnKey = () =>
      [
        privateModeRef.current ? "private" : useChatUiStore.getState().activeConversationId,
        lastTraceIdRef.current,
        messagesRef.current.length,
        messagesRef.current[messagesRef.current.length - 1]?.role,
      ].join("|");
    const keyAtTap = turnKey();
    try {
      const conversationId = privateModeRef.current ? null : useChatUiStore.getState().activeConversationId;
      const read = readSavedTurnRef.current;
      // Private Lab writes no row, and no conversation or reader means nothing to read: waiting never helps.
      if (!conversationId || !read) return { kind: "hold", message: RETRY_HELD_NO_RECORD };

      let rows: readonly SavedRow[] | null = null;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        rows = await Promise.race([
          read(conversationId, controller.signal),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve(null);
            }, SAVED_TURN_READ_TIMEOUT_MS);
          }),
        ]);
      } catch {
        rows = null;
      } finally {
        clearTimeout(timer);
      }

      // The operator moved on while the read was out: say nothing about the old reply, replay nothing.
      if (!mountedRef.current || turnKey() !== keyAtTap) return { kind: "stale" };

      const verdict = judge(rows);
      if (verdict === "ran") return { kind: "hold", message: RETRY_HELD_RAN };
      if (verdict === "unconfirmed") return { kind: "hold", message: unconfirmedMessage };
      return { kind: "go", rows };
    } catch {
      return { kind: "hold", message: unconfirmedMessage };
    }
  }, []);
  const replayIfSavedTurnAllows = useCallback(
    async (
      replay: () => Promise<void>,
      judge: (rows: readonly SavedRow[] | null) => SavedTurnVerdict,
      unconfirmedMessage: string = RETRY_HELD_UNCONFIRMED,
    ): Promise<void> => {
      // An earlier check may hold the flag for up to the read timeout: say so, a silent tap reads as a dead button.
      if (checkingSavedTurnRef.current) return void toast.error(RETRY_STILL_CHECKING);
      checkingSavedTurnRef.current = true;
      try {
        const check = await checkSavedTurn(judge, unconfirmedMessage);
        if (check.kind === "hold") return void toast.error(check.message);
        if (check.kind === "go") {
          // Acknowledge what this replay was approved on BEFORE it posts, so the same rows cannot approve the next one.
          for (const trace of latestTurnTraces(check.rows)) acknowledgedTracesRef.current.add(trace);
          await replay();
        }
      } finally {
        checkingSavedTurnRef.current = false;
      }
    },
    [checkSavedTurn],
  );

  // R3-05 (04-F7 + 04-H4): the one choke point for a replay. Every Retry
  // (error card, interrupted card, cut-off and refused chips, quality bar) and
  // the auto-retry land here, so the refusals happen before anything changes.
  const safeRegenerate = useCallback(
    (options?: Parameters<typeof chat.regenerate>[0]): Promise<void> => {
      if (sentPrivateRef.current && !privateModeRef.current) {
        toast.error("That turn was private. Turn Private Lab back on to retry it.");
        return Promise.resolve();
      }
      // R3-15: the server owns this turn and nothing has reattached yet, so a
      // regenerate would run it a second time. Retry reattaches instead.
      if (killedErrorRef.current) {
        setHeldError(null);
        resumingRef.current = true;
        void chat.resumeStream();
        return Promise.resolve();
      }
      const messages = messagesRef.current;
      const target = options?.messageId
        ? messages.find((m) => m.id === options.messageId)
        : messages[messages.length - 1];
      if (target?.role === "assistant" && turnHasSideEffect(target)) {
        toast.error("That reply may have run an action, so it can't be replayed. Send a new message instead.");
        return Promise.resolve();
      }
      const replay = () => {
        resumingRef.current = false;
        cancelPartialResume();
        setStopped(null);
        replayOutstandingRef.current = { from: lastTraceIdRef.current };
        if (lastTraceIdRef.current) acknowledgedTracesRef.current.add(lastTraceIdRef.current);
        // Rows the client never saw (a conversation opened from history) cannot later approve a
        // replay whose attempt is running unseen: acknowledge what the hydrated messages carry.
        for (const trace of latestTurnTraces(messagesRef.current as unknown as SavedRow[])) acknowledgedTracesRef.current.add(trace);
        traceAtSendRef.current = lastTraceIdRef.current;
        return chat.regenerate(options);
      };
      // A stream error is not the end of the turn: ai@6 keeps going after an error
      // part, so a tool-call plus finish(tool-calls) after it still runs the tool on
      // the server, and the client SDK stops reading at the error chunk, so this
      // bubble never shows it. When the server owns the turn (it answered with a
      // trace), only the saved record can say what ran: ask it before replaying.
      const traceNow = lastTraceIdRef.current;
      const serverOwnsErroredTurn = Boolean(chat.error) && Boolean(traceNow) && traceNow !== traceAtSendRef.current;
      if (serverOwnsErroredTurn) return replayIfSavedTurnAllows(replay, (rows) => judgeSavedTurn(rows, traceNow));
      // The latest replay sent its POST but no header came back: that attempt may be running
      // unseen. Unknown means refuse until a later attempt's clean row proves otherwise. The record is
      // explicit and the trace in hand is not compared with it: a header for another trace already
      // cleared it (onTraceId), and a POST answered with NO header nulls lastTraceId, so comparing
      // would read a trace-less 429 or 5xx after a replay from T1 as "answered".
      const replayWentUnanswered = Boolean(chat.error) && replayOutstandingRef.current !== null;
      if (replayWentUnanswered) {
        const acknowledged = acknowledgedTracesRef.current;
        return replayIfSavedTurnAllows(replay, (rows) => judgeAfterUnansweredReplay(rows, acknowledged), RETRY_HELD_RESENT_UNKNOWN);
      }
      return replay();
    },
    [chat, cancelPartialResume, replayIfSavedTurnAllows],
  );

  // Kept fresh the same way regenerateRef is, so the network-kill reattach
  // below reaches the live handle.
  const resumeStreamRef = useRef(chat.resumeStream);
  useEffect(() => {
    resumeStreamRef.current = chat.resumeStream;
    // Same live handle for the partial-resume path and the stall toast, which
    // are declared above the transport (they have to be) and cannot close over `chat`.
    resumeStreamRefForPartial.current = chat.resumeStream as unknown as () => void;
  }, [chat.resumeStream]);

  const regenerateRef = useRef(safeRegenerate);
  useEffect(() => {
    regenerateRef.current = safeRegenerate;
  }, [safeRegenerate]);

  useEffect(() => {
    messagesRef.current = chat.messages;
  }, [chat.messages]);

  const isStreaming = chat.status === "streaming" || chat.status === "submitted";
  const stopSeqRef = useRef(0);

  // 04-F2 / 04-F8 · once the stream settles, bind the reply bubble to its DB
  // row: id + stored text (banners included). Not mid-stream: the SDK would
  // push a second bubble for a changed id. An effect, not useChat's onFinish,
  // so the read-aloud follower flushes its tail under the old id first.
  // A payload from another turn (trace mismatch) is dropped.
  const { setMessages } = chat;
  useEffect(() => {
    if (isStreaming) return;
    const persisted = persistedRef.current;
    persistedRef.current = null;
    if (!persisted || persisted.traceId !== lastTraceIdRef.current) return;
    const boundId = messagesRef.current[messagesRef.current.length - 1]?.id;
    setMessages((messages) => bindPersistedMessage(messages, persisted));
    setStopped((s) => (s && s.messageId === boundId ? { ...s, messageId: persisted.id } : s));
  }, [isStreaming, setMessages]);

  // 04-F6 / 09-F29 · operator Stop: the server hears it first, the bubble is
  // marked at once, and the label settles when the DELETE answers.
  const stopTurn = useCallback(() => {
    cancelPartialResume();
    const seq = ++stopSeqRef.current;
    const last = messagesRef.current[messagesRef.current.length - 1];
    setStopped(last ? { messageId: last.id, outcome: "pending" } : null);
    void requestStop({
      conversationId: bodyRef.current.conversationId as string | null | undefined,
      abort: chat.stop,
    }).then((outcome) => {
      if (stopSeqRef.current === seq) setStopped((s) => (s ? { ...s, outcome } : s));
    });
  }, [chat.stop, cancelPartialResume]);

  useEffect(() => {
    if (!chat.error) {
      retryCountRef.current = 0;
      return;
    }
    if (retryCountRef.current >= 2) return;

    const message = (chat.error.message ?? "").toLowerCase();
    const isNetworkKill =
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("fetch failed") ||
      message.includes("load failed");
    // Added so a drop AFTER the server answered reattaches (below). Before any header they are NOT
    // auto-replayed: they never were, and widening that was not asked for.
    const isLaterNetworkPhrase = message.includes("network error") || message.includes("the network connection was lost");
    if (!isNetworkKill && !isLaterNetworkPhrase) return;

    // A dropped resume is not a dropped send: the turn is still running (or
    // done) server-side, and the merged bubble has lost its tool parts, so
    // the guard below cannot see what already fired. A reload shows the
    // persisted reply.
    if (resumingRef.current) return;

    // R3-05 (04-H4): the POST was answered with this turn's trace, so the
    // server owns the turn and finishes it after the drop (route.ts
    // consumeStream). Reattach; a regenerate would start a second execution.
    const turnTrace = lastTraceIdRef.current;
    if (turnTrace && turnTrace !== traceAtSendRef.current) {
      killedErrorRef.current = chat.error ?? null;
      retryCountRef.current += 1;
      const timer = setTimeout(() => {
        resumingRef.current = true;
        void resumeStreamRef.current?.();
      }, 1_500 * retryCountRef.current);
      return () => clearTimeout(timer);
    }

    // No header since the send: only the original phrases are auto-replayed.
    if (!isNetworkKill) return;

    // 2026-07-22 · idempotency guard. A tool may have committed a real side
    // effect (Telegram send, IG autopost, customer alert) on the server BEFORE
    // the stream dropped. Auto-regenerating re-runs the turn and re-fires the
    // tool = duplicate action. Only auto-retry when the last assistant turn
    // produced NO tool parts (pure-text stream broke, or the POST never landed).
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
    const hadToolPart = lastAssistant?.parts?.some(
      (p) => typeof (p as { type?: unknown })?.type === "string" &&
        (((p as { type: string }).type).startsWith("tool-") || (p as { type: string }).type === "dynamic-tool"),
    );
    if (hadToolPart) return;

    // Image generation is a deterministic server fast path, not a safe
    // model regeneration. If its stream drops after the provider was called,
    // auto-regenerate would duplicate the image request and then hand the
    // same prompt to a model that may not have an image tool attached.
    const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
    const lastUserText = lastUser?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
      .join(" ")
      .trim();
    if (lastUserText && looksLikeImageGenerationRequest(lastUserText)) return;

    // Private Lab: don't auto-replay a privately-sent turn once the mode is off.
    if (sentPrivateRef.current && !privateModeRef.current) return;

    retryCountRef.current += 1;
    const timer = setTimeout(
      () => regenerateRef.current?.(),
      1_500 * retryCountRef.current,
    );
    return () => clearTimeout(timer);
  }, [chat.error]);

  // A reattach that streams hands the turn back: Retry regenerates as usual again.
  useEffect(() => {
    if (chat.status === "streaming") killedErrorRef.current = null;
  }, [chat.status]);

  useStreamingErrorGuard({
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    error: chat.error?.message ?? null,
    clearError: () => setConnection("online"),
  });

  const { stallStatus } = useChatStall({
    messages: chat.messages as any,
    isStreaming: chat.status === "streaming" || chat.status === "submitted",
    stop: chat.stop,
    setError: (message) => {
      stalledRef.current = true;
      setConnection("degraded");
      if (!message) return;
      // A stall is terminal for that turn: the notice must persist until
      // acknowledged and offer the recovery (showStallToast), because
      // chat.error is never set on this path so the SDK's own retry cannot
      // arm and the persistent error card cannot render.
      // RECONNECT, never regenerate. chat.stop() abandons only the CLIENT
      // reader — route.ts calls result.consumeStream?.() and guarantees the
      // turn completes and persists after the client disconnects, and
      // registers it in the active-stream registry for exactly this purpose.
      // So a "Retry" that called regenerate() would start a SECOND execution
      // against a first that is still running: at best two competing assistant
      // turns, at worst a mutating tool fired twice — and this chat can invoke
      // gmail.sendDraft, telegram.send and shop.sendSms (route.ts
      // HIGH_STAKES_MUTATIONS). resumeStream() reattaches to the stream that
      // is already producing the answer. Caught in review on #1471.
      showStallToast(message);
    },
  });

  useEffect(() => {
    if (stallStatus === "stalled" || stallStatus === "warn") {
      setConnection("degraded");
    }
  }, [stallStatus, setConnection]);

  /** A new turn supersedes any stall notice from the previous one. */
  const clearStall = useCallback(() => {
    killedErrorRef.current = null;
    setHeldError(null);
    if (!stalledRef.current) return;
    stalledRef.current = false;
    toast.dismiss("chat-stall");
  }, []);

  // The operator opened another conversation (or a new chat). Called from the operator's own switch
  // only: the id a first message is given from the response header is the SAME turn and must keep its
  // binding, so nothing here reacts to the active conversation id changing by itself.
  //
  // Nothing in flight: the old turn's error, held interruption, trace refs, acknowledged set and
  // outstanding replay belong to that turn and would hold Retry on a clean reply here, so all go.
  //
  // A request in flight (submitted or streaming): the drawer has no streaming guard and a stream keeps
  // running across a load, so that request still owns the trace refs, the acknowledged set, the
  // outstanding-replay record and the private flag. Wiping them made its later error look like "the
  // server never answered" and Retry and the auto retry replayed with no read. They stay, so a later
  // error is judged against its own trace (and fails closed if the active conversation changed).
  // What is safe either way is cleared: the partial re-resume timer, the stall notice and held
  // interruption, the Stop label, the auto-retry count and the SDK error.
  const { clearError } = chat;
  const requestInFlight = chat.status === "submitted" || chat.status === "streaming";
  const resetTurn = useCallback(() => {
    cancelPartialResume();
    clearStall();
    retryCountRef.current = 0;
    setStopped(null);
    clearError();
    if (requestInFlight) return;
    sentPrivateRef.current = false;
    traceAtSendRef.current = null;
    lastTraceIdRef.current = null;
    setLastTraceId(null);
    replayOutstandingRef.current = null;
    acknowledgedTracesRef.current.clear();
  }, [cancelPartialResume, clearStall, clearError, requestInFlight]);

  return {
    messages: chat.messages,
    status: chat.status as "submitted" | "streaming" | "ready" | "error",
    error: chat.error ?? heldError ?? undefined,
    isStreaming,
    sendText: (text: string) => {
      sentPrivateRef.current = privateMode;
      resumingRef.current = false;
      replayOutstandingRef.current = null;
      acknowledgedTracesRef.current.clear();
      traceAtSendRef.current = lastTraceIdRef.current;
      cancelPartialResume();
      clearStall();
      setStopped(null);
      // 2026-08-12 · OPTIONAL TURBO: per-MESSAGE body override (race-free —
      // the option rides this exact send, not the shared bodyRef), consumed
      // and reset in the same tick so it can never stick to a second turn.
      // Regenerate/append deliberately do NOT carry it (no automatic
      // follow-on use, per the turbo contract).
      const turboOpts = turbo
        ? { body: { providerOverride: "anthropic" as const } }
        : undefined;
      if (turbo) setTurbo(false);
      // A new turn gets a fresh partial-resume budget; the cap exists to
      // bound ONE turn's reattachments, not the session's.
      resumeAttemptsRef.current = 0;
      return chat.sendMessage({ text }, turboOpts);
    },
    append: ((...args: Parameters<typeof chat.sendMessage>) => {
      sentPrivateRef.current = privateMode;
      resumingRef.current = false;
      replayOutstandingRef.current = null;
      acknowledgedTracesRef.current.clear();
      traceAtSendRef.current = lastTraceIdRef.current;
      cancelPartialResume();
      clearStall();
      setStopped(null);
      return chat.sendMessage(...args);
    }) as typeof chat.sendMessage,
    stop: () => {
      cancelPartialResume();
      return chat.stop();
    },
    stopTurn,
    stopped,
    regenerate: safeRegenerate,
    resetTurn,
    setMessages: chat.setMessages,
    liveContextBlocks,
    lastTraceId,
  };
}
