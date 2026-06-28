"use client";

import { logger } from "@/lib/logger";
const log = logger.withContext({ surface: "hooks.chat.auto-fire" });

/**
 * useChatAutoFire — auto-suggest "generate the image" plan after a
 * marketing-shaped assistant reply.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.18
 * decomposition push. The previous flow silently injected "now
 * generate the picture" into the chat after Nick wrote a caption-
 * looking reply. Nour wanted visibility, so v6 replaced the silent
 * inject with a plan-card toast that surfaces:
 *   · The proposed prompt
 *   · A 2.5s countdown
 *   · Go / Edit / Cancel buttons
 *
 * The decision logic lives in `decideAutoFire()` (lib/chat/auto-fire-gate)
 * which checks 6 gates (image attachment present, opinion-question shape,
 * user-intent gate, marketing-content threshold, etc.) and returns
 * `{ fire: boolean, plan?: AutoFirePlan, reason: string }`.
 *
 * The hook owns:
 *   · `autoFiredRef` — Set<messageId> tracking which assistant turns we
 *     have already evaluated, regardless of outcome. Prevents re-firing
 *     the toast on every render.
 *   · `pendingAutoFire` — the {messageId, plan} pair currently surfaced
 *     in the toast, or null when nothing is pending.
 *   · `handleAutoFireProceed` — accepts the (possibly user-edited) prompt
 *     and routes it through the caller's `sendOrQueue`. The actual
 *     "now generate the picture" magic-string is preserved — the chat
 *     interceptor + branded-prompt synth pull the prompt from prior
 *     context server-side.
 *   · `handleAutoFireCancel` — clears the pending toast.
 *
 * The decision useEffect is the heaviest piece: it pulls the latest
 * assistant text + the most recent prior user message (both parts and
 * text) and feeds them to `decideAutoFire`. Runs on every (messages,
 * isStreaming, pendingAutoFire) change but exits cheaply when:
 *   · streaming
 *   · fewer than 2 messages
 *   · last message isn't an assistant turn
 *   · turn already evaluated (in autoFiredRef)
 *   · plan already pending for this turn
 *
 * The hook is "controlled-pattern" — caller passes `sendOrQueue`,
 * receives the `pendingAutoFire` value plus both handlers to wire into
 * `<AutoFirePlanToast>`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { decideAutoFire, type AutoFirePlan } from "@/lib/chat/auto-fire-gate";

interface MessagePart {
  type: string;
  text?: string;
}

interface MessageLike {
  id: string;
  role: string;
  parts?: MessagePart[];
}

interface UseChatAutoFireOpts {
  messages: MessageLike[];
  isStreaming: boolean;
  /** Caller's send-or-queue helper. Used by the proceed handler. */
  sendOrQueue: (text: string) => void;
}

export interface ChatAutoFireState {
  pendingAutoFire: { messageId: string; plan: AutoFirePlan } | null;
  handleAutoFireProceed: (finalPrompt: string) => void;
  handleAutoFireCancel: () => void;
}

export function useChatAutoFire(opts: UseChatAutoFireOpts): ChatAutoFireState {
  const { messages, isStreaming, sendOrQueue } = opts;

  const autoFiredRef = useRef<Set<string>>(new Set());
  const [pendingAutoFire, setPendingAutoFire] = useState<{
    messageId: string;
    plan: AutoFirePlan;
  } | null>(null);

  useEffect(() => {
    if (isStreaming) return;
    if (messages.length < 2) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const id = last.id;
    if (!id || autoFiredRef.current.has(id)) return;
    if (pendingAutoFire?.messageId === id) return; // toast already showing

    const text = (last.parts || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join("\n");
    if (!text) return;

    // Pull the most recent prior user message — both text and parts so
    // image-attachment checks can run on the original prompt.
    const priorUser = [...messages].reverse().find((m) => m.role === "user");
    const priorUserParts: MessagePart[] = priorUser?.parts ?? [];
    const priorUserText = priorUserParts
      .filter((p) => p.type === "text")
      .map((p) => p.text || "")
      .join(" ");

    // Single decision call — runs all 6 gates and returns a plan or
    // bails with a reason. Either way, mark this turn as evaluated so
    // we don't re-decide on every render.
    const decision = decideAutoFire({
      userPrompt: priorUserText,
      userMessageParts: priorUserParts,
      replyText: text,
    });

    if (!decision.fire || !decision.plan) {
      autoFiredRef.current.add(id);
      // v10.0.186 · was console.log; structured so it joins
      // /system/errors when relevant + drops dev-console noise
      log.info("auto_fire_gated", { messageId: id, reason: decision.reason });
      return;
    }

    // Surface the plan toast — the toast itself owns the countdown.
    setTimeout(() => {
      setPendingAutoFire({ messageId: id, plan: decision.plan! });
    }, 0);
    autoFiredRef.current.add(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isStreaming, pendingAutoFire]);

  const handleAutoFireProceed = useCallback(
    (finalPrompt: string) => {
      try {
        // The chat interceptor's typo-tolerant matcher catches "generate"
        // and reuses the user-message context server-side. We send a
        // clean magic-string here — the actual prompt content was
        // captured by the brandedPrompt synth on the user-message turn.
        sendOrQueue("now generate the picture");
        log.info("auto_fire_proceed", { promptPreview: finalPrompt.slice(0, 80) });
      } catch (err) {
        log.warn("auto_fire_proceed_failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      setPendingAutoFire(null);
    },
    [sendOrQueue],
  );

  const handleAutoFireCancel = useCallback(() => {
    log.info("auto_fire_cancelled");
    setPendingAutoFire(null);
  }, []);

  return {
    pendingAutoFire,
    handleAutoFireProceed,
    handleAutoFireCancel,
  };
}
