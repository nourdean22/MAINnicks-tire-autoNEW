"use client";

/**
 * ReasonTab · the Reason section of the merged /brain surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/reason/page.tsx — the only
 * change is the outer full-bleed `<main className="min-h-[100dvh] …">`
 * wrapper was dropped (the page-level chrome + dark canvas now come from
 * /brain's StandardPage + the (mastery) layout; NickReasoner already
 * brings its own `mx-auto max-w-[68ch]` centering). The ?q / ?h
 * sessionStorage-handoff question resolution + the hydration gate are
 * unchanged. No Suspense wrapper here — PageTabs already mounts tab
 * content inside its own Suspense boundary, which covers useSearchParams.
 *
 * The Charizard surface. Operator drops a hard question, the engine
 * runs a tier-classified multi-step loop, the trace unfolds live via
 * SSE, the final answer lands.
 *
 * Entry paths (now under /brain?tab=reason):
 *   · ?q=<text>   · legacy URL param (kept for backward-compat +
 *                   operator typing in URL bar directly)
 *   · ?h=1        · sessionStorage handoff · reads "reason:pending-q"
 *                   + clears it · keeps sensitive question content out
 *                   of URLs + server access logs + browser history
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { NickReasoner } from "@/components/operator/nick-reasoner";

export function ReasonTab() {
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
    return <div className="min-h-[40vh]" />;
  }

  const autoRun = Boolean(initialQuestion && initialQuestion.length > 0);

  return <NickReasoner initialQuestion={initialQuestion} autoRun={autoRun} />;
}
