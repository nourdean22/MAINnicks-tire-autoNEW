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

// hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice · migrated
// off `authedFetch("/api/ai/diagnose-chat")` onto `trpc.system
// .diagnoseChat` · the procedure delegates to the SAME `diagnose-chat
// .runChatDiagnostic` service the legacy REST route also calls · drift
// impossible. The hook fires it imperatively via `utils.system
// .diagnoseChat.fetch()` so the lazy on-demand shape is preserved.
import { trpc } from "@/lib/trpc/client";

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
  const utils = trpc.useUtils();

  const runDiagnostic = useCallback(async (): Promise<void> => {
    if (diagnosing) return;
    setDiagnosing(true);
    setDiagnosticReport(null);
    try {
      const result = await utils.system.diagnoseChat.fetch();
      setDiagnosticReport(
        result.report || "Diagnostic failed — no report returned.",
      );
    } catch (err) {
      setDiagnosticReport(
        `Diagnostic endpoint failed: ${
          err instanceof Error ? err.message : String(err)
        }\n\nThat means the app server itself is down, not just Venice. Try refreshing the page.`,
      );
    } finally {
      setDiagnosing(false);
    }
  }, [diagnosing, utils]);

  const clearReport = useCallback(() => setDiagnosticReport(null), []);

  return {
    diagnosticReport,
    diagnosing,
    runDiagnostic,
    clearReport,
  };
}
