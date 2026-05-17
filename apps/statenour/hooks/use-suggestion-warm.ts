"use client";

/**
 * useSuggestionWarm — pre-load /api/ai/chat/suggestions while Nick
 * is still streaming his reply. By the time the stream ends and the
 * <SmartReplies> component mounts, the server-side 60s cache is
 * already primed — its fetch hits cache and renders instantly.
 *
 * The hook fires ONCE per (userId+assistantId) pair when:
 *   • the assistant message is ≥ 40 chars (short replies skip chips)
 *   • streaming has stopped for this message (prevents fighting the
 *     final tokens)
 *   • we haven't warmed this pair already
 *
 * The fetch is `keepalive:true` so it survives rapid UI mounts.
 * Caller pairs this hook with <SmartReplies> — the hook warms, the
 * component consumes.
 *
 * Shape is identical to what SmartReplies requests so the server
 * cache key matches on both calls:
 *   POST /api/ai/chat/suggestions { userMessage, assistantMessage }
 */

import { useEffect, useRef } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface WarmArgs {
  /** Stable id of the assistant message — warming skips on change */
  assistantId: string | null;
  /** The assistant's finished text (trigger once this is complete) */
  assistantMessage: string;
  /** The user message that prompted this reply */
  userMessage: string;
  /** Whether the assistant is currently streaming (skip warm until done) */
  streaming: boolean;
}

const MIN_LEN = 40;
// Prefer firing a little AFTER the stream ends so the full text is
// available — but before SmartReplies mounts its own fetch. 150ms is
// the sweet spot: faster than the 250ms SmartReplies mount delay.
const POST_STREAM_DELAY_MS = 150;

export function useSuggestionWarm({
  assistantId,
  assistantMessage,
  userMessage,
  streaming,
}: WarmArgs) {
  const warmedIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!assistantId) return;
    if (streaming) return;
    if (!assistantMessage || assistantMessage.length < MIN_LEN) return;
    if (warmedIdRef.current === assistantId) return;

    // Mark pre-emptively so rapid re-renders don't double-fire.
    warmedIdRef.current = assistantId;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      authedFetch("/api/ai/chat/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userMessage, assistantMessage }),
        keepalive: true,
      }).catch(() => {});
    }, POST_STREAM_DELAY_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [assistantId, assistantMessage, userMessage, streaming]);
}
