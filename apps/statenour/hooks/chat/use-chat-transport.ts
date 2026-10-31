"use client";

/**
 * useChatTransport — B2 · extract the custom DefaultChatTransport fetch
 * wrapper from app/(mastery)/chat/page.tsx.
 *
 * The chat page needs a transport that can read response HEADERS before
 * the body finishes streaming (so Deeper Context badge / context-blocks
 * pills / mode-pill / persona-inference fire mid-stream, not after).
 * The base transport only exposes the body stream. We wrap fetch to
 * intercept the Response + set refs/state BEFORE returning it.
 *
 * ─── Why a hook, not just a util ───────────────────────────────────
 * The transport has to close over:
 *   · transportBodyRef      — body builder for useChat
 *   · liveContextBlocksRef  — ref written by the wrapper
 *   · lastPersonaHeaderRef  — ref written by the wrapper
 *   · setDeeperContext      — React setter
 *   · setLastRunMode        — React setter
 *
 * To keep the transport stable (useChat re-subscribes on transport
 * change — that's what bit us in commit 5aef1a6), we memoize on apiPath
 * only. Everything else goes through refs so the identity stays fixed.
 *
 * Safety: NEVER call setState inside the fetch wrapper that React
 * subscribes to in a way that could re-trigger the transport memo.
 * We only call render-facing setters/callbacks here because their changes
 * don't propagate back into the transport deps. Refs remain the transport's
 * stable mutation channel; state mirrors exist only so React rerenders metadata UI.
 */

import { useMemo, useCallback, type RefObject, type Dispatch, type SetStateAction } from "react";
import { DefaultChatTransport } from "ai";
import { toast } from "sonner";
import type { UIMessage, UIDataTypes, UITools } from "ai";
import type { ContextBlocks } from "@/components/chat/context-block-badges";
import type { Personality } from "@/lib/chat/types";
import { decodeCockpitSseResponse } from "@/lib/chat/decode-cockpit-sse";
import { withoutOlderInlineFiles } from "@/lib/ai/chat/attachment-cap";

export type ChatUIMessage = UIMessage<unknown, UIDataTypes, UITools>;

/** Messages sent per turn; under the route's 200 cap (lib/ai/chat/gate.ts). */
const SEND_WINDOW = 150;

/** @deprecated alias — import {@link Personality} from `@/lib/chat/types` instead. */
export type PersonaHeader = Personality;

export type DeeperContextState = { count: number; types: string[] } | null;

export type LastRunModeState = {
  mode: "standard" | "deep";
  source: "auto" | "override";
} | null;

export interface UseChatTransportOpts<TBody extends object = Record<string, unknown>> {
  /** API path — typically `/api/ai/chat`. Memo dep. */
  apiPath: string;
  /**
   * Ref whose `.current` holds the body object sent with every message.
   * AI SDK v6 HttpChatTransport calls `body()` on every send, so we
   * resolve the ref on each call — the page can mutate `.current` at
   * any time and the server sees the latest value.
   *
   * Generic over TBody so the caller keeps its strong body type
   * without needing an `as unknown as RefObject<...>` cast at the
   * callsite.
   */
  transportBodyRef: RefObject<TBody>;
  /** Writable ref for live context-blocks (read by streaming message shells). */
  liveContextBlocksRef: RefObject<ContextBlocks | null>;
  /** Optional render-facing mirror. Does not participate in transport identity. */
  onLiveContextBlocks?: (blocks: ContextBlocks | null) => void;
  /** Writable ref for last X-Persona header (read by a persona-sync effect elsewhere). */
  lastPersonaHeaderRef: RefObject<Personality | null>;
  /**
   * v10.0.28 — Writable ref for last X-Trace-Id header. The chat
   * route mints a traceId per turn (v10.0.10) and now exposes it
   * via this header. The page captures it on the most-recent
   * response so a "view trace" link can deep-link to
   * /system/agent-traces?search=<traceId>.
   */
  lastTraceIdRef?: RefObject<string | null>;
  /** Optional render-facing mirror for the latest trace id. */
  onTraceId?: (id: string) => void;
  /** Setter for Deeper Context state. */
  setDeeperContext: Dispatch<SetStateAction<DeeperContextState>>;
  /**
   * Setter for last-run mode state. v10.0.529.xx · made optional ·
   * chat/page.tsx dropped the ModePill mount so the consumer state
   * was deleted. The X-Nick-Mode header is still captured if a
   * future surface passes a setter.
   */
  setLastRunMode?: Dispatch<SetStateAction<LastRunModeState>>;
  /**
   * Called on every response that carries an `X-Conversation-Id` header.
   * Server returns this on both first-message (new convo) and follow-up
   * (existing convo) responses. Client MUST capture this and echo it
   * back on subsequent sends via transportBodyRef.current.conversationId
   * — otherwise every send creates a fresh 2-message conversation, which
   * is what was happening in prod pre-2026-04-22.
   */
  onConversationId?: (id: string) => void;
  /**
   * 2026-08-28 · WP2 review fix. Fired when a resume response carries
   * `X-Resume-Partial: 1` — the server replayed an IN-FLIGHT turn and
   * had to close its tail window before the turn finished.
   *
   * This callback is the whole reason the header is not a dead control.
   * Without a reader, the resume stream ends with a real `finish` chunk,
   * the AI SDK sets status "ready", `isStreaming` flips false, and
   * use-stall-detection tears down — leaving a TRUNCATED reply that
   * looks completed, with no banner and no recovery. That is a worse
   * failure than the 204 this feature replaced.
   */
  onResumePartial?: () => void;
  /**
   * R3-15 (review R3 wave A, finding 2): a resume GET answered 204. ai@6
   * settles that as status "ready" with no error, so the caller decides
   * whether it hid an interrupted turn. A mount-time 204 is normal.
   * `pending`: the server still holds the turn in flight with no bytes yet
   * (`X-Resume-Pending: 1`), so another resume can still find it.
   */
  onResumeEmpty?: (info: { pending: boolean }) => void;
  /**
   * 2026-10-15 · the turn guard (lib/services/chat/turn-guard.ts) REFUSED this send on purpose:
   * the response carries X-Turn-Refusal (turn_in_flight, turn_answered, turn_ran, turn_unreadable).
   * The server ANSWERED, so the caller must not treat the replay as one that may never have
   * arrived. `traceId` is the live run's for turn_in_flight and the newest SAVED reply's for
   * turn_answered and turn_ran (null when the refusal names none).
   */
  onTurnRefused?: (info: { code: string; traceId: string | null }) => void;
  /**
   * 2026-08-28 · escalation provenance. Fired on every turn that carried
   * a depth marker, whether or not the escalation actually happened.
   *
   * THIS CALLBACK IS WHY THE HEADERS ARE NOT A DEAD CONTROL. The chat
   * route sets X-Escalation-* and X-Lane-* and I shipped that claiming a
   * refused escalation was "legible" — while nothing on the client read
   * them, so a blocked escalation looked exactly like never having asked.
   * Same defect class as the modelOverride wiring gap, caught the same
   * way: by grepping for the reader instead of trusting the writer.
   */
  onEscalation?: (info: {
    tier: string;
    applied: boolean;
    blockedBy?: string;
    reason?: string;
    laneModel?: string;
  }) => void;
  /**
   * 2026-10-10 (audit 04-F2) · `event: message.persisted { id, content }`:
   * the DB row id and the STORED text of this turn's reply. `traceId` is
   * the X-Trace-Id of the response it arrived on, so the caller can refuse
   * a payload that belongs to another turn.
   */
  onMessagePersisted?: (persisted: { id: string; content: string; traceId: string | null }) => void;
  /**
   * P2-B6 · the id of the bubble already showing the turn a resume names
   * (`?traceId=`), or undefined when there is none. The replay answers under
   * this id, so the AI SDK replaces that bubble instead of adding a second
   * one (Reconnect after a stall, re-resume after the DB id was bound).
   */
  resumeIntoMessageId?: () => string | undefined;
  /**
   * 2026-10-25 · a first send's reattach: no conversation id yet (it arrives
   * only in the POST's headers), so the resume names the client-minted id of
   * the user message instead (`?clientMessageId=`). Undefined = do not.
   */
  resumeUserMessageId?: () => string | undefined;
}

/**
 * P2-B6 · a bubble rebuilt by a resume. ai@6 starts a resume from an empty
 * message and the route replays text only, so its parts cannot show which
 * tools ran (and the turn may still be running): the Regenerate gate in
 * chat-message-list refuses such a bubble. Set on the `start` chunk below.
 */
export function isResumedMessage(message: { metadata?: unknown }): boolean {
  return (message.metadata as { resumed?: unknown } | undefined)?.resumed === true;
}

export function useChatTransport<TBody extends object = Record<string, unknown>>(
  opts: UseChatTransportOpts<TBody>,
): DefaultChatTransport<ChatUIMessage> {
  const {
    apiPath,
    transportBodyRef,
    liveContextBlocksRef,
    onLiveContextBlocks,
    lastPersonaHeaderRef,
    lastTraceIdRef,
    onTraceId,
    setDeeperContext,
    setLastRunMode,
    onConversationId,
    onResumePartial,
    onResumeEmpty,
    onTurnRefused,
    onEscalation,
    onMessagePersisted,
    resumeIntoMessageId,
    resumeUserMessageId,
  } = opts;

  const getBody = useCallback(() => transportBodyRef.current, [transportBodyRef]);
  const setLiveContextBlocks = useCallback((blocks: ContextBlocks | null) => {
    liveContextBlocksRef.current = blocks;
    onLiveContextBlocks?.(blocks);
  }, [liveContextBlocksRef, onLiveContextBlocks]);
  const setLastTraceId = useCallback((id: string) => {
    if (lastTraceIdRef) lastTraceIdRef.current = id;
    onTraceId?.(id);
  }, [lastTraceIdRef, onTraceId]);
  const setLastPersonaHeader = useCallback((persona: "master" | "builder" | "friend") => {
    lastPersonaHeaderRef.current = persona;
  }, [lastPersonaHeaderRef]);

  return useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      new DefaultChatTransport({
        api: apiPath,
        body: getBody,
        // 04-F15 (2026-10-10): the route refuses more than 200 messages, so a
        // long thread failed on every send. Send the last SEND_WINDOW and say
        // how many older ones were left out; the server's summary cache counts
        // absolute positions and shifts by historyOffset. Same body the
        // default builder sends, plus that one field.
        prepareSendMessagesRequest: ({ id, messages, body, trigger, messageId }) => {
          const historyOffset = Math.max(0, messages.length - SEND_WINDOW);
          return {
            body: {
              ...body,
              id,
              messages: withoutOlderInlineFiles(messages.slice(historyOffset)),
              trigger,
              messageId,
              historyOffset,
            },
          };
        },
        // WP-A (2026-07-29): useChat's id is the STATIC "chat-v2", so the
        // default reconnect URL (`${api}/chat-v2/stream`) is meaningless —
        // the real conversation id lives in the transport body. Point the
        // resume GET at the per-conversation route; "none" is the server's
        // 204 sentinel (no conversation yet, or private mode).
        prepareReconnectToStreamRequest: () => {
          const body = getBody() as
            | { conversationId?: string | null; privateMode?: boolean }
            | undefined;
          const convId =
            body?.conversationId && !body?.privateMode ? body.conversationId : "none";
          const api = `${apiPath}/${encodeURIComponent(convId)}/stream`;
          // 04-F8 · name the turn being waited for. The server answers 204
          // when its record belongs to another turn, instead of replaying
          // the previous reply. No trace yet (fresh load) = the old URL.
          const traceId = lastTraceIdRef?.current;
          if (convId === "none") {
            const userMessageId = body?.privateMode ? undefined : resumeUserMessageId?.();
            return { api: userMessageId ? `${api}?clientMessageId=${encodeURIComponent(userMessageId)}` : api };
          }
          return { api: traceId ? `${api}?traceId=${encodeURIComponent(traceId)}` : api };
        },
        fetch: async (input, init) => {
          // A resume that names its turn merges into that turn's bubble. An
          // unnamed one (mount) keeps the server id: it never replaces a reply.
          const isResume = init?.method === "GET";
          const resumeInto =
            isResume && String(input).includes("traceId=") ? resumeIntoMessageId?.() : undefined;
          const res = await fetch(input, init);
          if (isResume && res.status === 204) onResumeEmpty?.({ pending: res.headers.get("X-Resume-Pending") === "1" });
          const refusal = res.headers.get("X-Turn-Refusal");
          if (refusal && init?.method === "POST") onTurnRefused?.({ code: refusal, traceId: res.headers.get("X-Trace-Id") });

          // ── Conversation id (CRITICAL — every send before this fix
          //    was creating a new convo because the server-assigned id
          //    never made it back into the client body for the next
          //    send). Fire-and-forget: the callback will no-op if the
          //    id matches what's already active.
          // ── Partial resume (2026-08-28) ────────────────────────────
          // Read BEFORE anything else can early-return: a partial resume
          // must never be mistaken for a completed turn.
          if (res.headers.get("X-Resume-Partial") === "1") {
            onResumePartial?.();
          }

          // ── Escalation provenance (2026-08-28) ─────────────────────
          // Read before anything can early-return: the operator asked for
          // depth and must learn whether they got it.
          const escTier = res.headers.get("X-Escalation-Tier");
          if (escTier) {
            onEscalation?.({
              tier: escTier,
              applied: res.headers.get("X-Escalation-Applied") === "1",
              blockedBy: res.headers.get("X-Escalation-Blocked") ?? undefined,
              reason: res.headers.get("X-Escalation-Reason") ?? undefined,
              laneModel: res.headers.get("X-Lane-Model") ?? undefined,
            });
          }

          const convId = res.headers.get("X-Conversation-Id");
          // Guard sentinels defensively (server already blanks them): adopting
          // "private"/"temp" as activeConversationId clobbers the real id and
          // inverts privacy after toggle-off (self-review high #3).
          if (convId && convId !== "private" && convId !== "temp") {
            onConversationId?.(convId);
          }

          // ── Deeper Context ─────────────────────────────────────────
          const count = Number(res.headers.get("X-Deeper-Context-Count") ?? "0");
          if (Number.isFinite(count) && count > 0) {
            const types = (res.headers.get("X-Deeper-Context-Types") ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            setDeeperContext({ count, types });
          } else {
            setDeeperContext(null);
          }

          // ── Context-blocks pills ───────────────────────────────────
          // Type-safe population: only keys that exist on ContextBlocks
          // are assigned. Rogue/future header values are silently dropped
          // instead of leaking through an `as any` cast.
          const fired = (res.headers.get("X-Context-Blocks") ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (fired.length > 0) {
            const blocks: ContextBlocks = {};
            const knownKeys: ReadonlySet<keyof ContextBlocks> = new Set<keyof ContextBlocks>([
              "recall",
              "skills",
              "identity",
              "ghost",
              "qualitative",
              "beliefs",
              "nudges",
              "contradictions",
            ]);
            for (const k of fired) {
              if (knownKeys.has(k as keyof ContextBlocks)) {
                blocks[k as keyof ContextBlocks] = true;
              }
            }
            setLiveContextBlocks(blocks);
          } else {
            setLiveContextBlocks(null);
          }

          // ── Mode pill (predicted vs ran) ───────────────────────────
          if (setLastRunMode) {
            const modeHeader = res.headers.get("X-Nick-Mode");
            const modeSource = res.headers.get("X-Nick-Mode-Source");
            if (modeHeader === "standard" || modeHeader === "deep") {
              setLastRunMode({
                mode: modeHeader,
                source: modeSource === "override" ? "override" : "auto",
              });
            }
          }

          // ── v10.0.28 — Trace-id capture (operator deep-link) ───────
          // Capture the X-Trace-Id header so the page can render a
          // "view trace" link → /system/agent-traces?search=<id>.
          // Ref pattern (not state) so we don't re-subscribe useChat.
          if (lastTraceIdRef) {
            const traceHeader = res.headers.get("X-Trace-Id");
            if (traceHeader) setLastTraceId(traceHeader);
            // P2-B6 · a turn answered with no trace (image, confirmation
            // lanes) must not leave the previous turn's behind: a Reconnect
            // would name that older turn and replay its reply.
            else if (init?.method === "POST") lastTraceIdRef.current = null;
          }

          // ── Persona header (loop-safe pattern) ─────────────────────
          // WRITE to ref here; a separate effect in the page READS the
          // ref and calls setPersonality on the stream true→false edge.
          // Calling setPersonality here triggers useChat re-subscribe
          // mid-stream (bug from commit 5aef1a6).
          const personaHeader = res.headers.get("X-Persona");
          if (
            personaHeader === "master" ||
            personaHeader === "builder" ||
            personaHeader === "friend"
          ) {
            setLastPersonaHeader(personaHeader);
          }
          
          // ── SSE Cockpit Event Parsing ──────────────────────────────────────
          const contentType = res.headers.get("content-type");
          if (contentType?.includes("text/event-stream") && res.body) {
            return decodeCockpitSseResponse(res, {
              isResume,
              resumeInto,
              onMessagePersisted,
              onDecodeError: () => toast.error("Stream decode error — response may be incomplete", { duration: 4000 }),
            });
          }

          return res;
        },
      }),
    // Only apiPath is a memo dep — everything else is a stable ref/setter
    // so the transport identity never changes mid-conversation, which
    // would force useChat to re-subscribe and stomp the streaming message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiPath],
  );
}
