"use client";

import { ErrorCard } from "@/components/ui/error-card";

/**
 * ErrorDiagnosticPanel — the error + silent-retry + diagnostic
 * report stack that lives below the messages scroll surface when
 * Nick's stream fails.
 *
 * Two visual states:
 *   1. silentRetry.retrying → small "retrying silently" pill
 *   2. silentRetry.exhausted → full ErrorCard + (optional) diagnostic
 *      report block
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~55 LOC of
 * inline conditional JSX bundled into a single panel. The parent
 * still owns the error state and the retry / diagnose handlers.
 */
export function ErrorDiagnosticPanel({
  error,
  retrying,
  retryAttempt,
  retryMax,
  exhausted,
  diagnosing,
  diagnosticReport,
  onRetry,
  onDiagnose,
  onDismiss,
  onCloseReport,
}: {
  error: string | null;
  retrying: boolean;
  retryAttempt: number;
  retryMax: number;
  exhausted: boolean;
  diagnosing: boolean;
  diagnosticReport: string | null;
  onRetry: () => void;
  onDiagnose: () => void;
  onDismiss: () => void;
  onCloseReport: () => void;
}) {
  if (!error) return null;
  return (
    <>
      {/* Apr 19 · Silent retry — swallows up to 3 stream drops with
          exponential backoff (800ms, 1.6s, 3.2s). Only after 3
          consecutive failures does the ErrorCard below surface.
          Transient blips never reach Nour's eye. */}
      {retrying && (
        <div className="mx-3 mb-2 flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] px-3 py-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]/60 animate-pulse" />
          {/* v10.0.28 — was hard-coded "/3" but maxAttempts is 1.
              Stale denominator from before the Apr-27 cap. Use the
              actual configured max so the user isn't misled. */}
          <span>nick paused · retrying silently ({retryAttempt + 1}/{retryMax})</span>
        </div>
      )}
      {exhausted && (
        <div className="mx-3 mb-2 space-y-2">
          <ErrorCard
            title="Chat error"
            message={error}
            domain="chat:stream"
            onRetry={onRetry}
            onDiagnose={onDiagnose}
            onDismiss={onDismiss}
          />
          {diagnosing && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-[11px] text-blue-300 font-mono">
              running checks · pinging AI + DB + reading audit logs…
            </div>
          )}
          {diagnosticReport && (
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)] p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                  Diagnostic report
                </p>
                <button
                  onClick={onCloseReport}
                  className="text-[9px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--gold)]"
                >
                  close
                </button>
              </div>
              <pre className="text-[11px] font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words">
                {diagnosticReport}
              </pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}
