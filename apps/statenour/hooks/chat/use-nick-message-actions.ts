"use client";

import { useCallback } from "react";
import { haptic } from "@/lib/ui/haptic";
import { notifyDataChanged } from "@/lib/events/data-change";
import { logger as rootLogger } from "@/lib/logger";
// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice — every
// call-site here is now typed tRPC, the `authedFetch` import is gone.
//   · onCreateTask  → trpc.task.create   (POST /api/tasks · Phase SS)
//   · onPinToMemory → trpc.brain.createPin (POST /api/brain/pinned · Phase YY)
//   · onSaveToBrain → trpc.brain.recordMemory (`brain-memories.recordMemory`)
// `recordMemory` upserts by (category, key) — supplying a content-hash
// key here FIXES the pre-existing payload bug where the old `POST
// /api/brain/memories` call omitted the route's required `key` field
// (the route 400'd · the failure was masked by a generic toast).
// `postFeedback` below is a module-level (non-hook) function called
// straight from JSX, so it uses the vanilla tRPC client
// (`trpcVanilla.chat.messageFeedback`) — the same imperative non-React
// path `ClientErrorTelemetry` uses. Every procedure delegates to the
// SAME service its legacy REST route calls · drift impossible.
import { trpc } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla-client";

/**
 * Per-message action handlers wired into <NickMessage>'s
 * onCopy / onCreateTask / onSaveToBrain / onPinToMemory / onFeedback
 * props.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~110 LOC of
 * async fetch + haptic + log handling that lived inline in the
 * messages.map JSX block. Lifting them into a hook keeps the per-
 * message render path clean and lets the toast/error semantics live
 * in one place.
 *
 * Two of the callbacks (onCreateTask · onPinToMemory · onSaveToBrain ·
 * onSaveAsBelief) need an error setter so the page can show a quick
 * inline failure message; onFeedback only logs because the UI handles
 * its own pressed-state feedback.
 */
const log = rootLogger.withSurface("chat/nick-message");

/**
 * Stable content-hash key for a save-to-brain memory row. `brainMemory
 * .remember` upserts by (category, key) — keying on a hash of the
 * content slice reinforces an existing row instead of duplicating.
 */
function memoryKey(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Derive a task title from arbitrary message text — first sentence, capped at
 * 120 chars. Pure + exported so the confirm step and its tests share ONE
 * definition (this is the naive split that used to fire silently on one tap).
 */
export function deriveTaskTitle(text: string): string {
  return text.split(/[.!?]\s/)[0]?.slice(0, 120) || text.slice(0, 120);
}

/**
 * Resolve the operator's confirmed title into the value to create, or null to
 * abort. null (cancelled) or a blank/whitespace-only edit ⇒ do NOT create —
 * so the confirm step can never persist an empty task.
 */
export function resolveConfirmedTitle(confirmed: string | null): string | null {
  if (confirmed === null) return null;
  const t = confirmed.trim();
  return t.length > 0 ? t : null;
}

export type NickMessageActions = {
  onCopy: (text: string) => void;
  onCreateTask: (text: string) => Promise<void>;
  onSaveToBrain: (text: string) => Promise<void>;
  onPinToMemory: (text: string) => Promise<void>;
};

export function useNickMessageActions({
  setError,
  confirmTitle,
}: {
  setError: (msg: string | null) => void;
  /**
   * Optional editable-confirm step shown before a task is created from AI text
   * (P9 · prevents one-tap junk tasks). Receives the proposed title; returns the
   * operator's confirmed title, or null to cancel. When omitted, creates directly.
   */
  confirmTitle?: (proposedTitle: string) => Promise<string | null>;
}): NickMessageActions {
  // tRPC mutations · each throws TRPCError on failure, caught by the
  // try/catch below (matching the legacy `!res.ok` branches).
  const createTaskMutation = trpc.task.create.useMutation();
  const createPinMutation = trpc.brain.createPin.useMutation();
  const recordMemoryMutation = trpc.brain.recordMemory.useMutation();

  const onCopy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      // Visual feedback handled by the button itself
    });
  }, []);

  const onCreateTask = useCallback(
    async (text: string) => {
      // v10.0.28 — toast feedback. Pre-v10.0.28
      // failures were silent (only console.error).
      try {
        const proposed = deriveTaskTitle(text);
        // P9 · editable confirm BEFORE persisting — the operator sees and can
        // fix the AI-derived title (this used to fire silently on one tap, so a
        // messy first-sentence split became the task title). Cancel or a blank
        // edit aborts; if no confirm fn is wired the behavior is unchanged.
        let title = proposed;
        if (confirmTitle) {
          const resolved = resolveConfirmedTitle(await confirmTitle(proposed));
          if (resolved === null) return;
          title = resolved;
        }
        // `task.create`'s input is a permissive z.record · the
        // createTaskFromAPI → createTask service re-validates the
        // payload against `taskCreateSchema` (same as the REST route).
        await createTaskMutation.mutateAsync({
          title,
          loopKind: "ONCE",
          nextPhysicalAction: title,
          effort: "M15",
          roiScore: 50,
          frictionScore: 30,
          energyRequired: "MEDIUM",
          context: "ANYWHERE",
        });
        haptic.success();
      } catch (err) {
        log.error("action.createTask.failed", { error: err instanceof Error ? err.message : String(err) });
        haptic.error();
        setError("Couldn't create task — try again");
        setTimeout(() => setError(null), 3500);
      }
    },
    [setError, createTaskMutation, confirmTitle],
  );

  const onSaveToBrain = useCallback(
    async (text: string) => {
      try {
        // `recordMemory` upserts by (category, key) · supplying a
        // content-hash key fixes the pre-existing bug where the old
        // `POST /api/brain/memories` call omitted the route's required
        // `key` and silently 400'd. Throws TRPCError on failure.
        const content = text.slice(0, 500);
        await recordMemoryMutation.mutateAsync({
          category: "nick_advice",
          key: `nick_advice:${memoryKey(content)}`,
          content,
          source: "chat:save-to-brain",
        });
        haptic.success();
      } catch (err) {
        log.error("action.saveToBrain.failed", { error: err instanceof Error ? err.message : String(err) });
        haptic.error();
        setError("Couldn't save to brain — try again");
        setTimeout(() => setError(null), 3500);
      }
    },
    [setError, recordMemoryMutation],
  );

  const onPinToMemory = useCallback(
    async (text: string) => {
      try {
        await createPinMutation.mutateAsync({
          content: text.slice(0, 1200),
          source: "pin:chat",
        });
        // v10.0.529.87 · Wave 31 · audit found this
        // path bypassed the bus while the parallel
        // pinMemory tool path fires "brain" via
        // TOOL_DOMAIN_MAP. /brain page missed
        // refreshes when pins came from the swipe-
        // to-pin gesture vs the tool call.
        notifyDataChanged("brain", {
          source: "pin:chat-action",
          detail: "manual-pin",
        });
        haptic.success();
      } catch (err) {
        log.error("action.pinMemory.failed", { error: err instanceof Error ? err.message : String(err) });
        haptic.error();
      }
    },
    [createPinMutation],
  );

  return {
    onCopy,
    onCreateTask,
    onSaveToBrain,
    onPinToMemory,
  };
}

/**
 * postFeedback — best-effort thumbs feedback send for a given
 * assistant message. Kept separate from useNickMessageActions
 * because the body depends on the message id + snippet which are
 * per-mount values, not stable hook state.
 *
 * v10.0.515 · #6 preference loop · wires the existing
 * /api/ai/chat/feedback endpoint (which writes ChatMessage.feedback
 * Score + BrainMemory) to the thumbs UI. The route's v10.0.515
 * upgrade adds AuditEvent + traceId capture so the nightly preference
 * learner has durable rows to consume.
 *
 * v10.0.517 · also passes conversationId so the route can fall back
 * to the latest assistant message when the SDK-minted msg.id doesn't
 * match the DB cuid (the fresh-stream timing bug we found in the
 * v10.0.516 Chrome smoke test).
 */
export async function postFeedback({
  messageId,
  positive,
  snippet,
  conversationId,
}: {
  messageId: string;
  positive: boolean;
  snippet: string;
  conversationId: string | null;
}): Promise<void> {
  try {
    // `postFeedback` is a module-level function (per-mount values · not
    // stable hook state), so it uses the vanilla tRPC client — the same
    // imperative non-React path ClientErrorTelemetry uses.
    // `chat.messageFeedback` delegates to the `chat-feedback.record
    // MessageFeedback` service the legacy POST /api/ai/chat/feedback
    // route also calls · drift impossible.
    await trpcVanilla.chat.messageFeedback.mutate({
      messageId,
      score: positive ? 1 : -1,
      snippet: snippet.slice(0, 200),
      conversationId: conversationId ?? undefined,
    });
  } catch (err) {
    log.error("action.feedbackSave.failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
