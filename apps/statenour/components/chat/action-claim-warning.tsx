"use client";

/**
 * ACTION CLAIM WARNING · v10.0.160 · poka-yoke for fabricated tool calls
 *
 * Surfaces inline below an assistant bubble when Nick claimed a side
 * effect ("added the tasks", "sent the email") but the explainability
 * envelope shows ZERO tool calls fired. Diagnosed live via the Bay 5
 * Revive case: messageId cmopt9mkl000404l5qfz1g4rj said "Total tasks
 * now: 15" but envelope.toolsCalled was empty and Bay 5 had 0 tasks.
 *
 * Server-side detection runs in lib/services/chat/persist-assistant-
 * turn.ts at stream finalize. When fabricated claims are detected, a
 * BrainMemory row with category="chat_claim_warn" is persisted with
 * the conversationId + claims array. This component polls
 * /api/ai/chat/claim-warnings?conversationId=<id> after the assistant
 * stream completes and renders a warning if any active claim exists.
 *
 * UX intent: stop the user from forming a load-bearing belief based
 * on a fabricated claim. The chip says exactly what was claimed,
 * what tool would have made it real, and what tool actually fired.
 *
 * Design — single row, red severity ring, dismissible. Sits BETWEEN
 * the bubble and any other meta cards (lane correction, smart replies)
 * so the user reads it before acting on the response.
 */

import { useEffect, useState } from "react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { AlertTriangle, X } from "lucide-react";

interface ClaimWarning {
  id: string;
  traceId: string | null;
  createdAt: string;
  claims: Array<{ verb: string; snippet: string; expectedTool: string }>;
  toolsActuallyFired: string[];
  textPreview: string;
}

interface Props {
  /** Conversation id used to look up warnings */
  conversationId: string;
  /** Stable id so we only fire once per message */
  messageId: string;
  /** Hide if the caller wants to suppress (Nour typing, etc.) */
  hidden?: boolean;
}

export function ActionClaimWarning({
  conversationId,
  messageId,
  hidden,
}: Props) {
  const [warning, setWarning] = useState<ClaimWarning | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    setWarning(null);
    // 600ms delay so the post-stream BrainMemory write lands before
    // we poll. Fire-and-forget — failures silently render nothing.
    const t = setTimeout(async () => {
      try {
        const r = await authedFetch(
          `/api/ai/chat/claim-warnings?conversationId=${encodeURIComponent(conversationId)}&limit=1`,
        );
        if (!r.ok) return;
        const data = (await r.json()) as { data: { warnings: ClaimWarning[] } };
        if (cancelled) return;
        const w = data.data.warnings[0];
        // Only show the warning when the most recent one was created
        // AFTER the message we're rendering against. Without this
        // gate a fresh claim-warn from one turn ago could attach to
        // the next bubble.
        if (w) setWarning(w);
      } catch {
        // silent
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  if (hidden || dismissed || !warning) return null;

  const claimCount = warning.claims.length;
  const firstClaim = warning.claims[0];
  const expectedTools = [
    ...new Set(warning.claims.map((c) => c.expectedTool)),
  ].join(", ");
  const firedToolsLine =
    warning.toolsActuallyFired.length === 0
      ? "no tools fired"
      : `fired: ${warning.toolsActuallyFired.join(", ")}`;

  return (
    <div className="mt-1.5 mb-1 mx-1 rounded-md border border-red-500/40 bg-red-500/[0.06] px-2.5 py-1.5 text-[10.5px] text-red-300 leading-snug animate-fade-in">
      <div className="flex items-start gap-2">
        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold uppercase tracking-wider text-[9px] text-red-400 mb-0.5">
            possibly fabricated · {claimCount} claim
            {claimCount === 1 ? "" : "s"}
          </div>
          <div className="text-red-200/90">
            Nick said:{" "}
            <span className="italic">&ldquo;{firstClaim?.snippet}&rdquo;</span>
          </div>
          <div className="mt-0.5 text-[9px] font-mono text-red-300/70">
            expected tool: {expectedTools} · {firedToolsLine}
          </div>
          {warning.traceId && (
            <a
              href={`/system/agent-traces/${warning.traceId}`}
              className="inline-block mt-1 text-[9px] uppercase tracking-wider text-red-300 hover:text-red-200 underline decoration-dotted"
            >
              open envelope ↗
            </a>
          )}
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="dismiss"
          className="shrink-0 p-0.5 rounded hover:bg-white/10 opacity-60 hover:opacity-100 transition-all"
        >
          <X size={10} />
        </button>
      </div>
    </div>
  );
}
