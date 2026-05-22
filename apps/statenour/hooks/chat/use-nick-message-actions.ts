"use client";

import { useCallback } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { haptic } from "@/lib/ui/haptic";
import { notifyDataChanged } from "@/lib/events/data-change";
import { logger as rootLogger } from "@/lib/logger";
// REST→tRPC hooks slice (2026-05-22) · PARTIAL migration.
//   · onCreateTask  → trpc.task.create   (POST /api/tasks · Phase SS)
//   · onPinToMemory → trpc.brain.createPin (POST /api/brain/pinned · Phase YY)
// Both delegate to the SAME service the REST route calls
// (`task-actions.createTaskFromAPI` · `pins.createPin`) · drift
// impossible. `onSaveToBrain` (`POST /api/brain/memories`) is NOT
// migrated — that route requires a `key` field this hook never sent
// (a pre-existing payload bug · the route 400s on it), has no shared
// service, and no tRPC procedure · migrating it would change behavior
// + need a service extraction (out of this hooks-slice's scope · the
// `authedFetch` import stays for it). `postFeedback` below also stays
// on `authedFetch` — it is a module-level (non-hook) function called
// straight from JSX, and there is no vanilla tRPC client in this app.
import { trpc } from "@/lib/trpc/client";

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

export type NickMessageActions = {
  onCopy: (text: string) => void;
  onCreateTask: (text: string) => Promise<void>;
  onSaveToBrain: (text: string) => Promise<void>;
  onPinToMemory: (text: string) => Promise<void>;
};

export function useNickMessageActions({
  setError,
}: {
  setError: (msg: string | null) => void;
}): NickMessageActions {
  // tRPC mutations · both throw TRPCError on failure, caught by the
  // try/catch below (matching the legacy `!res.ok` branches).
  const createTaskMutation = trpc.task.create.useMutation();
  const createPinMutation = trpc.brain.createPin.useMutation();

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
        const firstSentence = text.split(/[.!?]\s/)[0]?.slice(0, 120) || text.slice(0, 120);
        // `task.create`'s input is a permissive z.record · the
        // createTaskFromAPI → createTask service re-validates the
        // payload against `taskCreateSchema` (same as the REST route).
        await createTaskMutation.mutateAsync({
          title: firstSentence,
          loopKind: "ONCE",
          nextPhysicalAction: firstSentence,
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
    [setError, createTaskMutation],
  );

  const onSaveToBrain = useCallback(
    async (text: string) => {
      try {
        const res = await authedFetch("/api/brain/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: "nick_advice",
            content: text.slice(0, 500),
            confidence: 0.8,
          }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        haptic.success();
      } catch (err) {
        log.error("action.saveToBrain.failed", { error: err instanceof Error ? err.message : String(err) });
        haptic.error();
        setError("Couldn't save to brain — try again");
        setTimeout(() => setError(null), 3500);
      }
    },
    [setError],
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
    await authedFetch("/api/ai/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        score: positive ? 1 : -1,
        snippet: snippet.slice(0, 200),
        conversationId,
      }),
    });
  } catch (err) {
    log.error("action.feedbackSave.failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
