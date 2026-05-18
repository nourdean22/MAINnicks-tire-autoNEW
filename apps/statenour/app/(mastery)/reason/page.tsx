"use client";

/**
 * /reason · Phase H (2026-05-18 PM) · H.2 (2026-05-18 PM)
 *
 * The Charizard surface. Operator drops a hard question, the engine
 * runs a tier-classified multi-step loop, the trace unfolds in the UI
 * (now streaming live via SSE in H.2), the final answer lands.
 *
 * H.2 · accepts `?q=<question>` for deep-link entry · when present
 * the engine auto-runs on mount. Used by OperatorPulse + chat
 * deep-mode hint to send the operator straight from the pulse line
 * into a live reasoning run.
 *
 * Lives under (mastery) layout so it inherits NourStateProvider +
 * AmbientAura + PageTracker + KeyboardShortcuts like the rest of the
 * mastery surfaces.
 *
 * See: components/operator/nick-reasoner.tsx · /api/nick/reason ·
 * /api/nick/reason/stream · lib/ai/reasoning/engine.ts
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { NickReasoner } from "@/components/operator/nick-reasoner";

function ReasonPageInner() {
  const searchParams = useSearchParams();
  const initialQuestion = searchParams?.get("q") ?? undefined;
  const autoRun = Boolean(initialQuestion && initialQuestion.length > 0);

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <NickReasoner
        initialQuestion={initialQuestion}
        autoRun={autoRun}
      />
    </main>
  );
}

export default function ReasonPage() {
  return (
    <Suspense fallback={null}>
      <ReasonPageInner />
    </Suspense>
  );
}
