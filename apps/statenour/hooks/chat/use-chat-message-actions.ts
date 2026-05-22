"use client";

import { useCallback } from "react";
import { haptic } from "@/lib/ui/haptic";
import { logger as rootLogger } from "@/lib/logger";
// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice — every
// call-site here is now typed tRPC, the `authedFetch` import is gone.
//   · onPin          → trpc.brain.{createPin,pinned} (Phase YY)
//   · onDelete       → trpc.chat.deleteMessage (NEW · delegates to the
//     `chat-edit.deleteMessageCascade` service the legacy DELETE
//     /api/ai/chat/edit/[id] route now also calls · drift impossible)
//   · onSaveAsBelief → trpc.brain.harvestBeliefs + trpc.brain.recordMemory
//   · onSaveAsDecision → trpc.brain.recordMemory
// `recordMemory` upserts by (category, key) — the harvest/save-as-*
// paths supply a content-hash key, fixing the pre-existing payload bug
// where the old `POST /api/brain/memories` calls omitted the required
// `key` field (the route 400'd · the failure was masked by a generic
// toast). Every procedure delegates to the SAME service its legacy
// REST route calls · drift structurally impossible.
import { trpc } from "@/lib/trpc/client";

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
 * Stable content-hash key for a save-as-* memory row. `brainMemory
 * .remember` upserts by (category, key) — keying on a hash of the
 * content slice means re-saving the same text reinforces the existing
 * row instead of duplicating it. Cheap djb2-ish hash · base36.
 */
function memoryKey(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

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
  // tRPC handles for onPin · `createPin` throws TRPCError on failure
  // (caught below) · `utils.brain.pinned.fetch` does the 800ms readback
  // verification imperatively.
  const utils = trpc.useUtils();
  const createPinMutation = trpc.brain.createPin.useMutation();
  // tRPC handles for onDelete + the save-as-* paths. Each throws
  // TRPCError on failure, caught by the existing try/catch blocks.
  const deleteMessageMutation = trpc.chat.deleteMessage.useMutation();
  const harvestBeliefsMutation = trpc.brain.harvestBeliefs.useMutation();
  const recordMemoryMutation = trpc.brain.recordMemory.useMutation();

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
      await createPinMutation.mutateAsync({
        content: body,
        source: "pin:longpress",
      });

      // Verification pass — read back within 2s to confirm the
      // write actually landed. Silent failures on POST would
      // otherwise leave Nour thinking the pin worked.
      setTimeout(async () => {
        try {
          const data = (await utils.brain.pinned.fetch({})) as {
            pins?: Array<{ content: string }>;
          };
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
  }, [actionSheetMsg, pins, createPinMutation, utils]);

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
      // `deleteMessage` cascade-deletes the target + every subsequent
      // message · throws TRPCError on a missing id (caught below).
      await deleteMessageMutation.mutateAsync({ messageId: targetId });
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
  }, [actionSheetMsg, messages, setMessages, setError, deleteMessageMutation]);

  const onSaveAsBelief = useCallback(async () => {
    // v10.0.28 — toast feedback. Pre-v10.0.28 this had .catch(() => {})
    // on every fetch which swallowed all failures silently.
    if (!actionSheetMsg) return;
    try {
      // `harvestBeliefs` is the typed equivalent of the legacy PATCH
      // /api/beliefs `{action:"harvest_now"}` branch · `recordMemory`
      // persists the message text as a belief_manual row. The legacy
      // `POST /api/brain/memories` call omitted the route's REQUIRED
      // `key` field (a pre-existing payload bug · the route 400'd · the
      // failure was masked by the generic toast) — `recordMemory`'s
      // typed `.input()` makes that impossible, so we mint a stable
      // content-hash key here. `remember` upserts by (category, key) so
      // re-saving the same text reinforces rather than duplicating.
      await harvestBeliefsMutation.mutateAsync();
      const content = actionSheetMsg.text.slice(0, 500);
      await recordMemoryMutation.mutateAsync({
        category: "belief_manual",
        key: `belief_manual:${memoryKey(content)}`,
        content,
        source: "chat:save-as-belief",
      });
      haptic.success();
    } catch (err) {
      log.error("action.saveAsBelief.failed", { error: err instanceof Error ? err.message : String(err) });
      haptic.error();
      setError("Couldn't save as belief — try again");
      setTimeout(() => setError(null), 3500);
    }
  }, [actionSheetMsg, setError, harvestBeliefsMutation, recordMemoryMutation]);

  const onSaveAsDecision = useCallback(async () => {
    if (!actionSheetMsg) return;
    try {
      // Same fix as onSaveAsBelief — the legacy `POST /api/brain/
      // memories` omitted the required `key`; `recordMemory` mints a
      // stable content-hash key so the row actually lands.
      const content = actionSheetMsg.text.slice(0, 500);
      await recordMemoryMutation.mutateAsync({
        category: "decision_manual",
        key: `decision_manual:${memoryKey(content)}`,
        content,
        source: "chat:save-as-decision",
      });
      haptic.success();
    } catch (err) {
      log.error("action.saveAsDecision.failed", { error: err instanceof Error ? err.message : String(err) });
      haptic.error();
      setError("Couldn't save as decision — try again");
      setTimeout(() => setError(null), 3500);
    }
  }, [actionSheetMsg, setError, recordMemoryMutation]);

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
