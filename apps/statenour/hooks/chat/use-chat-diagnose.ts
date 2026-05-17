"use client";

/**
 * useChatDiagnose — Diagnose-with-Nick health check state.
 *
 * Extracted from app/(mastery)/chat/page.tsx as part of the v8.15 BATCH A
 * decomposition. When the streaming pipeline is broken, retrying via the
 * normal chat path just fires another failing stream. Diagnose-with-Nick
 * hits a dedicated `/api/ai/diagnose-chat` endpoint that runs synchronous
 * health probes (provider connectivity, last error, env-var presence)
 * and returns a markdown report.
 *
 * No effects — purely imperative. The hook owns the report state +
 * the in-flight flag + a `runDiagnostic` function. Result renders inline
 * under the ErrorCard via the returned `report` value.
 */

import { useCallback, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
export interface ChatDiagnoseState {
  diagnosticReport: string | null;
  diagnosing: boolean;
  /** Trigger the diagnostic run. Idempotent while in flight. */
  runDiagnostic: () => Promise<void>;
  /** Clear the report (e.g. user dismisses the inline card). */
  clearReport: () => void;
}

export function useChatDiagnose(): ChatDiagnoseState {
  const [diagnosticReport, setDiagnosticReport] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);

  const runDiagnostic = useCallback(async (): Promise<void> => {
    if (diagnosing) return;
    setDiagnosing(true);
    setDiagnosticReport(null);
    try {
      const res = await authedFetch("/api/ai/diagnose-chat");
      const raw = (await res.json()) as {
        data?: { report?: string };
        report?: string;
        error?: string;
      };
      // Support both the envelope shape ({ data: { report } }) used by the
      // apiHandler wrapper and the bare ({ report } / { error }) shape that
      // older callers / direct fetches return.
      const report =
        raw?.data?.report ??
        raw?.report ??
        raw?.error ??
        "Diagnostic failed — no report returned.";
      setDiagnosticReport(report);
    } catch (err) {
      setDiagnosticReport(
        `Diagnostic endpoint failed: ${
          err instanceof Error ? err.message : String(err)
        }\n\nThat means the app server itself is down, not just Venice. Try refreshing the page.`,
      );
    } finally {
      setDiagnosing(false);
    }
  }, [diagnosing]);

  const clearReport = useCallback(() => setDiagnosticReport(null), []);

  return {
    diagnosticReport,
    diagnosing,
    runDiagnostic,
    clearReport,
  };
}
