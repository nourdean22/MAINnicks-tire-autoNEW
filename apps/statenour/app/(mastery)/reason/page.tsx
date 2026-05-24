"use client";

/**
 * /reason · Phase H (2026-05-18 PM) · H.2 (2026-05-18 PM) · H.6.3 (2026-05-18 PM)
 *
 * The Charizard surface. Operator drops a hard question, the engine
 * runs a tier-classified multi-step loop, the trace unfolds in the UI
 * (now streaming live via SSE in H.2), the final answer lands.
 *
 * Entry paths:
 *   · /reason             · empty form
 *   · /reason?q=<text>    · legacy URL param (kept for backward-compat
 *                           and operator typing in URL bar directly)
 *   · /reason?h=1         · H.6.3 · sessionStorage handoff · reads
 *                           "reason:pending-q" + clears it · keeps
 *                           sensitive question content out of URLs +
 *                           server access logs + browser history
 *
 * Lives under (mastery) layout so it inherits NourStateProvider +
 * AmbientAura + PageTracker + KeyboardShortcuts like the rest of
 * the mastery surfaces.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NickReasoner } from "@/components/operator/nick-reasoner";

function ReasonPageInner() {
  const searchParams = useSearchParams();
  const queryQ = searchParams?.get("q") ?? null;
  const handoffMode = searchParams?.get("h") === "1";

  // H.6.3 · resolve question · sessionStorage handoff takes priority
  // when ?h=1 is set · falls back to ?q= for legacy + direct URL
  // bar use. Reads once on mount + clears the sessionStorage entry.
  const [initialQuestion, setInitialQuestion] = useState<string | undefined>(
    handoffMode ? undefined : queryQ ?? undefined,
  );
  const [hydrated, setHydrated] = useState(!handoffMode);

  useEffect(() => {
    if (!handoffMode) return;
    try {
      const pending = sessionStorage.getItem("reason:pending-q");
      if (pending) {
        sessionStorage.removeItem("reason:pending-q");
        setInitialQuestion(pending);
      }
    } catch {
      // sessionStorage blocked · fall back to query param if present
      if (queryQ) setInitialQuestion(queryQ);
    } finally {
      setHydrated(true);
    }
  }, [handoffMode, queryQ]);

  // Wait for sessionStorage read to finish before mounting NickReasoner
  // so autoRun fires with the resolved question, not the initial undefined.
  if (!hydrated) {
    return <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white" />;
  }

  const autoRun = Boolean(initialQuestion && initialQuestion.length > 0);

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <NickReasoner initialQuestion={initialQuestion} autoRun={autoRun} />
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
