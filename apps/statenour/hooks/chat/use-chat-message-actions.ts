"use client";

import { useCallback } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { haptic } from "@/lib/ui/haptic";
import { logger as rootLogger } from "@/lib/logger";

/**
 * Bundles the long-press MessageActionSheet's six callback bodies
 * (copy / pin / edit / delete / save-as-belief / save-as-decision)
 * + the show-reasoning hook into a single reusable surface.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · the wrapper
 * was ~170 LOC of inline async callbacks living in the JSX of the
 * MessageActionSheet mount. Lifting them into a hook keeps the page
 * focused on render + state · and the callback semantics live next
 * to the only consumer (the action sheet drawer).
 *
 * The hook is intentionally STATELESS — it accepts the target msg +
 * the cross-page state setters as inputs and returns ready-to-wire
 * callbacks. The parent still owns `actionSheetMsg` state · this is
 * just a closure factory.
 */

type ActionSheetMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Pins = {
  pin: (id: string, text: string) => void;
};

export type ChatMessageActions = {
  onCopy: () => void;
  onPin: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onSaveAsBelief: () => Promise<void>;
  onSaveAsDecision: () => Promise<void>;
  onShowReasoning: () => void;
};

const log = rootLogger.withSurface("chat/action-sheet");

/**
 * Generic over the message type so the hook can consume the AI SDK's
 * useChat output without dragging a specific UIMessage shape across
 * the boundary. The page typically passes `messages` and `setMessages`
 * straight from useChat.
 */
export function useChatMessageActions<TMessage extends { id: string }>({
  actionSheetMsg,
  pins,
  messages,
  setMessages,
  setEditingMsgId,
  setEditValue,
  setError,
  setReasoningTraceMsg,
}: {
  actionSheetMsg: ActionSheetMsg | null;
  pins: Pins;
  messages: TMessage[];
  setMessages: (next: TMessage[]) => void;
  setEditingMsgId: (id: string | null) => void;
  setEditValue: (value: string) => void;
  setError: (msg: string | null) => void;
  setReasoningTraceMsg: (id: string | null) => void;
}): ChatMessageActions {
  const onCopy = useCallback(() => {
    if (actionSheetMsg?.text) {
      navigator.clipboard?.writeText(actionSheetMsg.text).catch(() => {});
    }
  }, [actionSheetMsg]);

  const onPin = useCallback(async () => {
    if (!actionSheetMsg) return;
    // Two-tier pin:
    //   • Local session pin (both roles) — shows the chip in the
    //     pinned-messages header for the current session only.
    //   • Permanent BrainMemory pin (ASSISTANT ONLY) — writes to
    //     /api/brain/pinned so Nick reads it every future turn.
    //
    // Role check: user messages are meant for local-only echo/
    // edit. Writing user drafts to pinned_user pollutes the
    // system prompt with things Nour said *to* Nick, not things
    // Nick should carry forward. If Nour wants to pin his own
    // thinking, he types it into the /brain add-new drawer
    // instead (source: pin:manual).
    try {
      pins.pin(actionSheetMsg.id, actionSheetMsg.text);
      if (actionSheetMsg.role !== "assistant") {
        // Ephemeral-only pin for user messages
        haptic.tap();
        return;
      }
      // Enforce route cap; the route truncates too, but be explicit
      const body = actionSheetMsg.text.slice(0, 1200);
      if (body.trim().length < 8) {
        // Too short to be useful permanent context
        haptic.tap();
        return;
      }
      const res = await authedFetch("/api/brain/pinned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: body,
          source: "pin:longpress",
        }),
      });
      if (!res.ok) throw new Error("permanent pin failed");

      // Verification pass — read back within 2s to confirm the
      // write actually landed. Silent failures on POST would
      // otherwise leave Nour thinking the pin worked.
      setTimeout(async () => {
        try {
          const verify = await authedFetch("/api/brain/pinned");
          if (!verify.ok) return;
          const data = (await verify.json()) as { pins?: Array<{ content: string }> };
          const found = (data.pins || []).some(
            (p) => p.content.startsWith(body.slice(0, 40))
          );
          if (!found) {
            haptic.error();
            log.warn("pin.readbackMismatch", { hint: "POST succeeded but row missing on readback" });
          }
        } catch {
          // verification is best-effort
        }
      }, 800);

      haptic.success();
    } catch (err) {
      log.error("pin.longpress.failed", { error: err instanceof Error ? err.message : String(err) });
      haptic.error();
    }
  }, [actionSheetMsg, pins]);

  const onEdit = useCallback(() => {
    if (actionSheetMsg?.role === "user") {
      setEditingMsgId(actionSheetMsg.id);
      setEditValue(actionSheetMsg.text);
    }
  }, [actionSheetMsg, setEditingMsgId, setEditValue]);

  const onDelete = useCallback(async () => {
    // v10.0.28 — server-side delete. Pre-v10.0.28 this only
    // truncated client state, so the messages reappeared on
    // next reload. Now hits DELETE /api/ai/chat/edit/[id]
    // which removes the message + every subsequent message
    // in the same conversation.
    // May 02 — gate lifted: assistant rows can be deleted too.
    // The cascade truncates everything after the target so a
    // bad reply + its downstream context drops in one shot.
    if (!actionSheetMsg) return;
    const targetId = actionSheetMsg.id;
    const idx = messages.findIndex((m) => m.id === targetId);
    if (idx < 0) return;
    // Optimistic truncate; revert on failure.
    const prevMessages = messages;
    setMessages(messages.slice(0, idx));
    haptic.medium();
    try {
      const res = await authedFetch(`/api/ai/chat/edit/${targetId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      haptic.success();
    } catch (err) {
      // Revert + surface failure
      setMessages(prevMessages);
      haptic.error();
      setError(
        `Couldn't delete message · ${err instanceof Error ? err.message : "retry"}`,
      );
      setTimeout(() => setError(null), 3500);
    }
  }, [actionSheetMsg, messages, setMessages, setError]);

  const onSaveAsBelief = useCallback(async () => {
    // v10.0.28 — toast feedback. Pre-v10.0.28 this had .catch(() => {})
    // on every fetch which swallowed all failures silently.
    if (!actionSheetMsg) return;
    try {
      const beliefRes = await authedFetch("/api/beliefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "harvest_now" }),
      });
      const memRes = await authedFetch("/api/brain/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "belief_manual",
          content: actionSheetMsg.text.slice(0, 500),
          confidence: 0.9,
        }),
      });
      if (!beliefRes.ok || !memRes.ok) throw new Error("save failed");
      haptic.success();
    } catch (err) {
      log.error("action.saveAsBelief.failed", { error: err instanceof Error ? err.message : String(err) });
      haptic.error();
      setError("Couldn't save as belief — try again");
      setTimeout(() => setError(null), 3500);
    }
  }, [actionSheetMsg, setError]);

  const onSaveAsDecision = useCallback(async () => {
    if (!actionSheetMsg) return;
    try {
      const res = await authedFetch("/api/brain/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "decision_manual",
          content: actionSheetMsg.text.slice(0, 500),
          confidence: 0.9,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      haptic.success();
    } catch (err) {
      log.error("action.saveAsDecision.failed", { error: err instanceof Error ? err.message : String(err) });
      haptic.error();
      setError("Couldn't save as decision — try again");
      setTimeout(() => setError(null), 3500);
    }
  }, [actionSheetMsg, setError]);

  const onShowReasoning = useCallback(() => {
    if (!actionSheetMsg) return;
    // v10.0.360 · BDI reasoning trace · open the cognitive
    // chain modal for this assistant message.
    setReasoningTraceMsg(actionSheetMsg.id);
  }, [actionSheetMsg, setReasoningTraceMsg]);

  return {
    onCopy,
    onPin,
    onEdit,
    onDelete,
    onSaveAsBelief,
    onSaveAsDecision,
    onShowReasoning,
  };
}
