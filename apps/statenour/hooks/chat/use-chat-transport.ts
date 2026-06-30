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
 * We only call setDeeperContext + setLastRunMode here because their
 * changes don't propagate back into the transport deps.
 */

import { useMemo, useCallback, type RefObject, type Dispatch, type SetStateAction } from "react";
import { DefaultChatTransport } from "ai";
import { toast } from "sonner";
import type { UIMessage, UIDataTypes, UITools } from "ai";
import type { ContextBlocks } from "@/components/chat/context-block-badges";
import type { Personality } from "@/lib/chat/types";

export type ChatUIMessage = UIMessage<unknown, UIDataTypes, UITools>;

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
}

export function useChatTransport<TBody extends object = Record<string, unknown>>(
  opts: UseChatTransportOpts<TBody>,
): DefaultChatTransport<ChatUIMessage> {
  const {
    apiPath,
    transportBodyRef,
    liveContextBlocksRef,
    lastPersonaHeaderRef,
    lastTraceIdRef,
    setDeeperContext,
    setLastRunMode,
    onConversationId,
  } = opts;

  const getBody = useCallback(() => transportBodyRef.current, [transportBodyRef]);
  const setLiveContextBlocks = useCallback((blocks: ContextBlocks | null) => {
    liveContextBlocksRef.current = blocks;
  }, [liveContextBlocksRef]);
  const setLastTraceId = useCallback((id: string) => {
    if (lastTraceIdRef) lastTraceIdRef.current = id;
  }, [lastTraceIdRef]);
  const setLastPersonaHeader = useCallback((persona: "master" | "builder" | "friend") => {
    lastPersonaHeaderRef.current = persona;
  }, [lastPersonaHeaderRef]);

  return useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      new DefaultChatTransport({
        api: apiPath,
        body: getBody,
        fetch: async (input, init) => {
          const res = await fetch(input, init);

          // ── Conversation id (CRITICAL — every send before this fix
          //    was creating a new convo because the server-assigned id
          //    never made it back into the client body for the next
          //    send). Fire-and-forget: the callback will no-op if the
          //    id matches what's already active.
          const convId = res.headers.get("X-Conversation-Id");
          if (convId) {
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
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let toastedDecodeError = false;

            const sseStream = new ReadableStream({
              async start(controller) {
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      controller.close();
                      break;
                    }

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    // Keep the last partial line in buffer
                    buffer = lines.pop() || "";

                    let currentEvent = "";
                    for (const line of lines) {
                      const trimmed = line.trim();
                      if (trimmed.startsWith("event:")) {
                        currentEvent = trimmed.slice(6).trim();
                      } else if (trimmed.startsWith("data:")) {
                        const dataVal = trimmed.slice(5).trim();
                        if (currentEvent === "chunk") {
                          try {
                            // The server sends the base64 string serialized as JSON (via JSON.stringify)
                            let base64Str = dataVal;
                            if (dataVal.startsWith('"') && dataVal.endsWith('"')) {
                              try {
                                base64Str = JSON.parse(dataVal);
                              } catch (_) {
                                // fallback to stripping quotes if parsing fails
                                base64Str = dataVal.slice(1, -1);
                              }
                            }
                            // Normalize base64 encoding (e.g. convert URL-safe to standard, correct padding)
                            const cleanBase64 = base64Str.replace(/-/g, "+").replace(/_/g, "/");
                            const paddedBase64 = cleanBase64.padEnd(
                              cleanBase64.length + ((4 - (cleanBase64.length % 4)) % 4),
                              "="
                            );
                            const binaryString = atob(paddedBase64);
                            const len = binaryString.length;
                            const bytes = new Uint8Array(len);
                            for (let i = 0; i < len; i++) {
                              bytes[i] = binaryString.charCodeAt(i);
                            }
                            controller.enqueue(bytes);
                          } catch (err) {
                            console.error("[use-chat-transport] Failed to decode chunk:", err, "dataVal:", dataVal);
                            if (!toastedDecodeError) {
                              toastedDecodeError = true;
                              toast.error("Stream decode error — response may be incomplete", { duration: 4000 });
                            }
                          }
                        } else if (currentEvent) {
                          try {
                            const parsed = JSON.parse(dataVal);
                            const ev = new CustomEvent("cockpit-event", {
                              detail: { type: currentEvent, payload: parsed },
                            });
                            window.dispatchEvent(ev);
                          } catch (e) {
                            console.error("[use-chat-transport] Failed to parse SSE event data:", e);
                          }
                        }
                      } else if (trimmed === "") {
                        currentEvent = "";
                      }
                    }
                  }
                } catch (err) {
                  controller.error(err);
                } finally {
                  reader.releaseLock();
                }
              },
              cancel() {
                reader.cancel().catch(() => {});
              },
            });

            return new Response(sseStream, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
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
